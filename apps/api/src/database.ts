import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { loadFromNeon, neonEnabled, saveToNeon } from "./cloudDatabase.js";

export type Role = "developer" | "admin" | "player";
export type User = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
  licenseExpiresAt?: string;
  licenseDays?: number;
  accessActive?: boolean;
  lastPaymentAt?: string;
  arenaId?: string;
};
export type Arena = {
  id: string;
  name: string;
  code: string;
  cameraId: string;
  defaultSeconds: number;
  retentionDays: number;
  watermarkUrl?: string;
  active: boolean;
  ownerId?: string;
};
export type DbReplay = {
  id: string; cameraId: string; arenaId: string; userId: string; seconds: number;
  createdAt: string; expiresAt?: string; filename: string; url: string; cloudPublicId?: string;
};
export type CameraSource = {
  id: string; arenaId: string; name: string; type: "webcam" | "rtsp" | "mjpeg";
  host: string; port: number; username: string; password: string; path: string;
  transport: "tcp" | "udp"; active: boolean; status: "untested" | "online" | "offline";
  lastTestedAt?: string; lastError?: string;
};
type Database = { users: User[]; arenas: Arena[]; replays: DbReplay[]; cameras: CameraSource[] };

const storageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../storage");
const dbPath = path.join(storageRoot, "database.json");
let db: Database = { users: [], arenas: [], replays: [], cameras: [] };

export async function initDatabase() {
  await mkdir(storageRoot, { recursive: true });
  try { db = JSON.parse(await readFile(dbPath, "utf8")); } catch { /* primeira execução */ }
  if (neonEnabled()) {
    const remote = await loadFromNeon();
    if (remote && (remote.users.length || remote.arenas.length)) db = remote;
  }
  db.users ??= []; db.arenas ??= []; db.replays ??= []; db.cameras ??= [];
  for (const arena of db.arenas) arena.retentionDays ??= 7;
  for (const user of db.users) if (user.role === "admin") user.accessActive ??= true;
  // Compatibilidade: jogadores antigos recebem a arena do replay mais recente.
  for (const user of db.users) {
    if (user.role !== "player" || user.arenaId) continue;
    const replay = db.replays.find((item) => item.userId === user.id);
    if (replay) user.arenaId = replay.arenaId;
  }
  if (!db.arenas.length) db.arenas.push({ id: randomUUID(), name: "Quadra 01", code: "QUADRA01", cameraId: "quadra-01", defaultSeconds: 30, retentionDays: 7, active: true });
  if (!db.users.some((user) => user.role === "admin")) db.users.push({ id: randomUUID(), name: "Administrador ER", email: "admin@erreplay.com", passwordHash: await bcrypt.hash("erreplay123", 10), role: "admin", createdAt: new Date().toISOString(), accessActive: true });
  // Compatibilidade com instalações existentes: as quadras antigas passam a
  // pertencer ao primeiro administrador já existente. Novos clientes ficam isolados.
  const legacyAdmin = db.users.find((user) => user.role === "admin");
  if (legacyAdmin) for (const arena of db.arenas) arena.ownerId ??= legacyAdmin.id;
  const developerEmail = process.env.DEV_EMAIL?.trim().toLowerCase();
  const developerPassword = process.env.DEV_PASSWORD;
  if (developerEmail && developerPassword && developerPassword.length >= 8) {
    const developer = db.users.find((user) => user.role === "developer");
    if (developer) {
      const emailOwner = db.users.find((user) => user.email === developerEmail && user.id !== developer.id);
      if (!emailOwner) developer.email = developerEmail;
      if (!(await bcrypt.compare(developerPassword, developer.passwordHash))) developer.passwordHash = await bcrypt.hash(developerPassword, 10);
    } else db.users.push({ id: randomUUID(), name: "Edu Reichardt", email: developerEmail, passwordHash: await bcrypt.hash(developerPassword, 10), role: "developer", createdAt: new Date().toISOString() });
  }
  await saveDatabase();
}

export async function saveDatabase() { await writeFile(dbPath, JSON.stringify(db, null, 2), "utf8"); if (neonEnabled()) await saveToNeon(db); }
export function publicUser(user: User) { const { passwordHash: _, ...safe } = user; return safe; }
export function findUserByEmail(email: string) { return db.users.find((user) => user.email === email.toLowerCase()); }
export function findUserById(id: string) { return db.users.find((user) => user.id === id); }
export function listUsers() { return db.users.map(publicUser); }
export function listUsersForAdmin(adminId: string) {
  const ownedArenaIds = new Set(db.arenas.filter((arena) => arena.active && (!arena.ownerId || arena.ownerId === adminId)).map((arena) => arena.id));
  return db.users
    .filter((user) => {
      if (user.role === "developer") return false;
      if (user.role === "admin") return user.id === adminId;
      if (user.arenaId && ownedArenaIds.has(user.arenaId)) return true;
      // Compatibilidade com jogadores criados antes do vínculo direto com arena.
      return db.replays.some((replay) => replay.userId === user.id && ownedArenaIds.has(replay.arenaId));
    })
    .map(publicUser);
}
export function adminCanManageUser(adminId: string, userId: string) {
  const user = findUserById(userId);
  if (!user || user.role !== "player") return false;
  return listUsersForAdmin(adminId).some((item) => item.id === userId);
}
export function adminLicenseState(user: User) {
  if (user.role !== "admin") return { allowed: true };
  if (user.accessActive === false) return { allowed: false, reason: "blocked" as const };
  if (user.licenseExpiresAt && new Date(user.licenseExpiresAt).getTime() <= Date.now()) return { allowed: false, reason: "expired" as const };
  return { allowed: true };
}
export async function createUser(name: string, email: string, password: string, arenaId?: string) {
  const user: User = { id: randomUUID(), name, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10), role: "player", createdAt: new Date().toISOString(), arenaId };
  db.users.push(user); await saveDatabase(); return user;
}
export async function createAdminClient(name: string, email: string, password: string, licenseDays: number) {
  const now = new Date();
  const user: User = { id: randomUUID(), name, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10), role: "admin", createdAt: now.toISOString(), licenseDays, licenseExpiresAt: new Date(now.getTime() + licenseDays * 86400000).toISOString(), accessActive: true, lastPaymentAt: now.toISOString() };
  db.users.push(user); await saveDatabase(); return publicUser(user);
}
export async function renewAdminLicense(id: string, days?: number) {
  const user = findUserById(id); if (!user || user.role !== "admin") return;
  const cycle = Math.max(1, Math.min(365, Number(days ?? user.licenseDays ?? 30)));
  const now = Date.now(); const current = user.licenseExpiresAt ? new Date(user.licenseExpiresAt).getTime() : 0;
  const base = Math.max(now, current);
  user.licenseDays = cycle; user.licenseExpiresAt = new Date(base + cycle * 86400000).toISOString(); user.lastPaymentAt = new Date(now).toISOString(); user.accessActive = true;
  await saveDatabase(); return publicUser(user);
}
export async function setAdminAccess(id: string, active: boolean) { const user = findUserById(id); if (!user || user.role !== "admin") return; user.accessActive = active; await saveDatabase(); return publicUser(user); }
export async function changeUserPassword(id: string, password: string) { const user = findUserById(id); if (!user) return false; user.passwordHash = await bcrypt.hash(password, 10); await saveDatabase(); return true; }
export async function removeUser(id: string) { const user = findUserById(id); if (!user || user.role !== "player" || db.replays.some((r) => r.userId === id)) return false; db.users = db.users.filter((u) => u.id !== id); await saveDatabase(); return true; }
export function listAdminClients() { return db.users.filter((u) => u.role === "admin").map((u) => ({ ...publicUser(u), arenas: db.arenas.filter((a) => a.active && a.ownerId === u.id).length, cameras: db.cameras.filter((c) => db.arenas.some((a) => a.id === c.arenaId && a.ownerId === u.id)).length, replays: db.replays.filter((r) => db.arenas.some((a) => a.id === r.arenaId && a.ownerId === u.id)).length })); }

export function listArenas(ownerId?: string) { return db.arenas.filter((a) => a.active && (!ownerId || a.ownerId === ownerId)); }
export function findArena(code: string) { return db.arenas.find((a) => a.code.toLowerCase() === code.toLowerCase() && a.active); }
export function findArenaById(id: string) { return db.arenas.find((a) => a.id === id && a.active); }
export function adminOwnsArena(adminId: string, arenaId: string) { const arena = findArenaById(arenaId); return Boolean(arena && (!arena.ownerId || arena.ownerId === adminId)); }
export async function createArena(name: string, code: string, defaultSeconds: number, ownerId?: string) { const arena: Arena = { id: randomUUID(), name, code: code.toUpperCase(), cameraId: "", defaultSeconds, retentionDays: 7, active: true, ownerId }; db.arenas.push(arena); await saveDatabase(); return arena; }
export async function updateArena(id: string, input: Partial<Pick<Arena, "name"|"code"|"defaultSeconds"|"retentionDays"|"watermarkUrl"|"ownerId">>) { const arena = findArenaById(id); if (!arena) return; Object.assign(arena, input); await saveDatabase(); return arena; }
export async function persistReplay(replay: DbReplay) { db.replays.unshift(replay); if (db.replays.length > 500) db.replays.length = 500; await saveDatabase(); }
export function listDbReplays(user: { id: string; role: Role }) { if (user.role === "developer") return db.replays; if (user.role === "admin") { const ids = new Set(db.arenas.filter((a) => !a.ownerId || a.ownerId === user.id).map((a) => a.id)); return db.replays.filter((r) => ids.has(r.arenaId)); } return db.replays.filter((r) => r.userId === user.id); }
export function arenaReplays(arenaId: string) { return db.replays.filter((r) => r.arenaId === arenaId); }
export async function removeArena(id: string) { const arena = findArenaById(id); if (!arena) return false; db.replays = db.replays.filter((r) => r.arenaId !== id); db.cameras = db.cameras.filter((c) => c.arenaId !== id); db.arenas = db.arenas.filter((a) => a.id !== id); await saveDatabase(); return true; }
export function developerOverview() { return { totals: { arenas: db.arenas.filter((a) => a.active).length, cameras: db.cameras.filter((c) => c.type !== "webcam").length, online: db.cameras.filter((c) => c.type !== "webcam" && c.status === "online").length, users: db.users.filter((u) => u.role === "player").length, replays: db.replays.length, clients: db.users.filter((u) => u.role === "admin").length }, arenas: db.arenas.filter((a) => a.active).map((arena) => ({ ...arena, cameras: db.cameras.filter((c) => c.arenaId === arena.id && c.type !== "webcam").length, onlineCameras: db.cameras.filter((c) => c.arenaId === arena.id && c.type !== "webcam" && c.status === "online").length, replays: db.replays.filter((r) => r.arenaId === arena.id).length })) }; }
export function findReplay(id: string) { return db.replays.find((r) => r.id === id); }
export async function removeReplay(id: string) { db.replays = db.replays.filter((r) => r.id !== id); await saveDatabase(); }
export function expiredReplays(now = Date.now()) { return db.replays.filter((r) => r.expiresAt && new Date(r.expiresAt).getTime() <= now); }
export function listCameras(ownerId?: string) { return db.cameras.filter((c) => c.type !== "webcam" && (!ownerId || db.arenas.some((a) => a.id === c.arenaId && (!a.ownerId || a.ownerId === ownerId)))).map(({ password, ...camera }) => ({ ...camera, hasPassword: Boolean(password) })); }
export function findCamera(id: string) { return db.cameras.find((c) => c.id === id); }
export async function createCamera(input: Omit<CameraSource, "id"|"status">) { const camera: CameraSource = { ...input, id: randomUUID(), status: "untested" }; db.cameras.push(camera); await saveDatabase(); return camera; }
export async function updateCameraStatus(id: string, status: CameraSource["status"], error?: string) { const camera = findCamera(id); if (!camera) return; camera.status = status; camera.lastTestedAt = new Date().toISOString(); camera.lastError = error; await saveDatabase(); }
export async function removeCamera(id: string) { db.cameras = db.cameras.filter((c) => c.id !== id); await saveDatabase(); }
export async function activateArenaCamera(arenaId: string, cameraId: string) { const arena = db.arenas.find((a) => a.id === arenaId); if (arena) { arena.cameraId = cameraId; await saveDatabase(); } }
