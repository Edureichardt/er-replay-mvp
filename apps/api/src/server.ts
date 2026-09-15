import "dotenv/config";
import cors from "cors";
import express from "express";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import { authenticateAgent, createPairingCode, ensureAgentTables, listAgents, pairAgent, revokeAgent } from "./agentAuth.js";
import {
  addReplay,
  addSegment,
  bufferStatus,
  getRecentSegments,
} from "./store.js";
import { createReplayVideo, testVideoStream } from "./ffmpeg.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import {
  activateArenaCamera,
  adminLicenseState,
  adminOwnsArena,
  arenaReplays,
  changeUserPassword,
  createAdminClient,
  createArena,
  createCamera,
  createUser,
  developerOverview,
  expiredReplays,
  findArena,
  findArenaById,
  findCamera,
  findReplay,
  findUserByEmail,
  findUserById,
  initDatabase,
  listAdminClients,
  listArenas,
  listCameras,
  listDbReplays,
  listUsers,
  listUsersForAdmin,
  adminCanManageUser,
  persistReplay,
  publicUser,
  renewAdminLicense,
  setAdminAccess,
  removeArena,
  removeCamera,
  removeReplay,
  removeUser,
  updateArena,
  updateCameraStatus,
  type Role,
} from "./database.js";
import {
  captureStatus,
  startRtspCapture,
  stopAllRtspCaptures,
  stopRtspCapture,
} from "./rtspCapture.js";
import {
  cloudStorageEnabled,
  deleteCloudReplay,
  uploadBrandImage,
  uploadReplay,
} from "./cloudStorage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const storageRoot = process.env.STORAGE_ROOT
  ? path.resolve(process.env.STORAGE_ROOT)
  : path.join(projectRoot, "storage");
const segmentsRoot = path.join(storageRoot, "segments");
const replaysRoot = path.join(storageRoot, "replays");
await mkdir(segmentsRoot, { recursive: true });
await mkdir(replaysRoot, { recursive: true });
await initDatabase();
await ensureAgentTables();

const app = express();
const port = Number(process.env.PORT ?? 3333);
const isProduction = process.env.NODE_ENV === "production";
const publicWebUrl = process.env.PUBLIC_WEB_URL?.trim().replace(/\/$/, "");

if (isProduction) {
  const required = [
    ["JWT_SECRET", process.env.JWT_SECRET],
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["CLOUDINARY_URL", process.env.CLOUDINARY_URL],
    ["WEB_ORIGIN", process.env.WEB_ORIGIN],
    ["PUBLIC_WEB_URL", publicWebUrl],
  ].filter(([, value]) => !value);

  if (required.length) {
    throw new Error(
      `Configuração de produção incompleta: ${required.map(([name]) => name).join(", ")}.`,
    );
  }
  if ((process.env.JWT_SECRET ?? "").length < 32) {
    throw new Error("JWT_SECRET deve ter pelo menos 32 caracteres em produção.");
  }
}

if (process.env.TRUST_PROXY === "1" || isProduction) {
  app.set("trust proxy", 1);
}

const configuredOrigins = (process.env.WEB_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedWebOrigin(origin: string) {
  if (configuredOrigins.includes(origin)) return true;

  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;

    const hostname = url.hostname;
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
    const isPrivateIpv4 =
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname);

    return !isProduction && (isLocalhost || isPrivateIpv4) && url.port === "5173";
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, callback) {
      // Requisições sem Origin (curl, ffmpeg, apps locais) continuam permitidas.
      if (!origin || isAllowedWebOrigin(origin)) return callback(null, true);
      return callback(new Error(`Origem não autorizada pelo CORS: ${origin}`));
    },
  }),
);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "4mb" }));
app.use("/replays", express.static(replaysRoot));
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Muitas tentativas. Aguarde alguns minutos." },
});

const jwtSecret = process.env.JWT_SECRET ?? "er-replay-mude-esta-chave";
type AuthRequest = express.Request & { auth?: { id: string; role: Role }; agent?: { id: string; ownerId: string; machineName?: string | null } };
function auth(requiredRole?: Role) {
  return (
    req: AuthRequest,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    try {
      if (!token) throw new Error();
      const payload = jwt.verify(token, jwtSecret) as {
        sub: string;
        role: Role;
      };
      const currentUser = findUserById(payload.sub);
      if (!currentUser) throw new Error();
      req.auth = { id: currentUser.id, role: currentUser.role };
      if (currentUser.role === "admin") {
        const license = adminLicenseState(currentUser);
        if (!license.allowed) {
          return res.status(403).json({
            code: license.reason === "expired" ? "LICENSE_EXPIRED" : "ACCESS_BLOCKED",
            message:
              license.reason === "expired"
                ? "Seu acesso ao ER Replay expirou. Entre em contato com a ER Soluções Digitais para renovar sua licença."
                : "Seu acesso ao ER Replay está bloqueado. Entre em contato com a ER Soluções Digitais.",
          });
        }
      }
      if (requiredRole && currentUser.role !== requiredRole)
        return res.status(403).json({ message: "Acesso não autorizado." });
      next();
    } catch {
      res.status(401).json({ message: "Faça login para continuar." });
    }
  };
}

async function agentAuth(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const agent = await authenticateAgent(token);
  if (!agent) return res.status(401).json({ message: "Capture Agent não autorizado. Faça o pareamento novamente." });
  const owner = findUserById(agent.ownerId);
  if (!owner || owner.role !== "admin") return res.status(401).json({ message: "Cliente do Agent não encontrado." });
  const license = adminLicenseState(owner);
  if (!license.allowed) return res.status(403).json({ message: "Licença da arena bloqueada ou expirada." });
  req.agent = agent;
  req.auth = { id: owner.id, role: "admin" };
  next();
}

function issueToken(id: string, role: Role) {
  return jwt.sign({ role }, jwtSecret, { subject: id, expiresIn: "7d" });
}
function resetSecret(passwordHash: string) {
  return createHash("sha256")
    .update(`${jwtSecret}:${passwordHash}`)
    .digest("hex");
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character]!,
  );
}

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const name = String(req.body.name ?? "").trim();
  const email = String(req.body.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(req.body.password ?? "");
  if (name.length < 2 || !email.includes("@") || password.length < 6)
    return res.status(400).json({
      message:
        "Preencha nome, e-mail válido e senha com pelo menos 6 caracteres.",
    });
  if (findUserByEmail(email))
    return res.status(409).json({ message: "Este e-mail já está cadastrado." });
  const requestedArena = findArena(String(req.body.arenaCode ?? "QUADRA01"));
  if (!requestedArena)
    return res.status(404).json({ message: "Arena não encontrada para este cadastro." });
  const user = await createUser(name, email, password, requestedArena.id);
  res
    .status(201)
    .json({ token: issueToken(user.id, user.role), user: publicUser(user) });
});
app.post("/api/auth/login", authLimiter, async (req, res) => {
  const user = findUserByEmail(String(req.body.email ?? ""));
  if (
    !user ||
    !(await bcrypt.compare(String(req.body.password ?? ""), user.passwordHash))
  )
    return res.status(401).json({ message: "E-mail ou senha incorretos." });
  if (user.role === "admin") {
    const license = adminLicenseState(user);
    if (!license.allowed)
      return res.status(403).json({
        code: license.reason === "expired" ? "LICENSE_EXPIRED" : "ACCESS_BLOCKED",
        message:
          license.reason === "expired"
            ? "Sua licença do ER Replay expirou. Entre em contato com a ER Soluções Digitais para renovar o acesso."
            : "Seu acesso está bloqueado. Entre em contato com a ER Soluções Digitais.",
      });
  }
  res.json({ token: issueToken(user.id, user.role), user: publicUser(user) });
});
app.get("/api/auth/me", auth(), (req: AuthRequest, res) => {
  const user = findUserById(req.auth!.id);
  user
    ? res.json(publicUser(user))
    : res.status(404).json({ message: "Usuário não encontrado." });
});
app.get("/api/developer/overview", auth("developer"), (_req, res) =>
  res.json(developerOverview()),
);
app.get("/api/developer/clients", auth("developer"), (_req, res) =>
  res.json(listAdminClients()),
);
app.post("/api/developer/clients/:id/agent-pairing", auth("developer"), async (req, res) => {
  const user = findUserById(String(req.params.id));
  if (!user || user.role !== "admin") return res.status(404).json({ message: "Cliente não encontrado." });
  res.status(201).json(await createPairingCode(user.id));
});
app.get("/api/developer/agents", auth("developer"), async (_req, res) => res.json(await listAgents()));
app.post("/api/developer/agents/:id/revoke", auth("developer"), async (req, res) => {
  const ok = await revokeAgent(String(req.params.id));
  if (!ok) return res.status(404).json({ message: "Agent não encontrado." });
  res.json({ ok: true });
});
app.post("/api/agent/pair", authLimiter, async (req, res) => {
  const code = String(req.body?.code ?? "").trim();
  const machineName = String(req.body?.machineName ?? "PC da arena").trim().slice(0, 100);
  const paired = await pairAgent(code, machineName);
  if (!paired) return res.status(400).json({ message: "Código inválido, expirado ou já utilizado." });
  res.status(201).json({ token: paired.token, agentId: paired.agentId });
});
app.post("/api/developer/clients", auth("developer"), async (req, res) => {
  const name = String(req.body.name ?? "").trim();
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const password = String(req.body.password ?? "");
  const licenseDays = Math.max(1, Math.min(365, Number(req.body.licenseDays ?? 30)));
  if (name.length < 2 || !email.includes("@") || password.length < 8)
    return res.status(400).json({ message: "Informe nome, e-mail válido e senha de pelo menos 8 caracteres." });
  if (findUserByEmail(email)) return res.status(409).json({ message: "Este e-mail já está cadastrado." });
  res.status(201).json(await createAdminClient(name, email, password, licenseDays));
});
app.post("/api/developer/clients/:id/renew", auth("developer"), async (req, res) => {
  const updated = await renewAdminLicense(String(req.params.id), Number(req.body.days || 0) || undefined);
  if (!updated) return res.status(404).json({ message: "Cliente não encontrado." });
  res.json({ client: updated, message: "Pagamento confirmado e licença renovada." });
});
app.patch("/api/developer/clients/:id/access", auth("developer"), async (req, res) => {
  const updated = await setAdminAccess(String(req.params.id), Boolean(req.body.active));
  if (!updated) return res.status(404).json({ message: "Cliente não encontrado." });
  res.json(updated);
});
app.post("/api/developer/clients/:id/reset-password", auth("developer"), async (req, res) => {
  const password = String(req.body.password ?? "");
  const user = findUserById(String(req.params.id));
  if (!user || user.role !== "admin") return res.status(404).json({ message: "Cliente não encontrado." });
  if (password.length < 8) return res.status(400).json({ message: "A nova senha precisa ter pelo menos 8 caracteres." });
  await changeUserPassword(user.id, password);
  res.json({ ok: true, message: "Nova senha definida para o cliente." });
});
app.post("/api/auth/change-password", auth(), async (req: AuthRequest, res) => {
  const user = findUserById(req.auth!.id);
  const current = String(req.body.currentPassword ?? "");
  const next = String(req.body.newPassword ?? "");
  if (!user || !(await bcrypt.compare(current, user.passwordHash)))
    return res.status(401).json({ message: "Senha atual incorreta." });
  if (next.length < 8)
    return res
      .status(400)
      .json({ message: "A nova senha precisa ter pelo menos 8 caracteres." });
  await changeUserPassword(user.id, next);
  res.json({ ok: true, message: "Senha atualizada." });
});
app.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
  const email = String(req.body.email ?? "")
    .trim()
    .toLowerCase();
  const user = findUserByEmail(email);
  const genericMessage =
    "Se o e-mail estiver cadastrado, você receberá as instruções para redefinir a senha.";
  if (!user) return res.json({ message: genericMessage });
  const token = jwt.sign(
    { type: "password-reset" },
    resetSecret(user.passwordHash),
    { subject: user.id, expiresIn: "20m" },
  );
  const webOrigin = (process.env.WEB_ORIGIN ?? "http://localhost:5173")
    .split(",")[0]!
    .trim();
  const resetUrl = `${webOrigin}/?reset=${encodeURIComponent(token)}`;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESET_FROM_EMAIL;
  if (apiKey && from) {
    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [user.email],
        subject: "Redefinição de senha — ER Replay",
        html: `<p>Olá, ${escapeHtml(user.name)}.</p><p>Use o link abaixo para criar uma nova senha. Ele expira em 20 minutos.</p><p><a href="${resetUrl}">Redefinir minha senha</a></p><p>Se você não solicitou, ignore este e-mail.</p>`,
      }),
    });
    if (!sent.ok)
      console.error("Falha ao enviar recuperação de senha:", await sent.text());
  }
  res.json({
    message: genericMessage,
    ...(process.env.NODE_ENV !== "production" && !apiKey
      ? { developmentResetUrl: resetUrl }
      : {}),
  });
});
app.post("/api/auth/reset-password", authLimiter, async (req, res) => {
  const token = String(req.body.token ?? "");
  const newPassword = String(req.body.newPassword ?? "");
  if (newPassword.length < 8)
    return res
      .status(400)
      .json({ message: "A nova senha precisa ter pelo menos 8 caracteres." });
  const decoded = jwt.decode(token) as { sub?: string } | null;
  const user = decoded?.sub ? findUserById(decoded.sub) : undefined;
  if (!user)
    return res.status(400).json({ message: "Link inválido ou expirado." });
  try {
    const payload = jwt.verify(token, resetSecret(user.passwordHash)) as {
      type?: string;
    };
    if (payload.type !== "password-reset") throw new Error();
    await changeUserPassword(user.id, newPassword);
    res.json({ message: "Senha redefinida. Você já pode entrar." });
  } catch {
    res
      .status(400)
      .json({ message: "Link inválido ou expirado. Solicite um novo." });
  }
});
app.get("/api/arenas", (_req, res) => res.json(listArenas()));
app.get("/api/admin/arenas", auth("admin"), (req: AuthRequest, res) => res.json(listArenas(req.auth!.id)));
app.get("/api/arenas/:code", (req, res) => {
  const arena = findArena(req.params.code);
  arena
    ? res.json(arena)
    : res.status(404).json({ message: "Quadra não encontrada." });
});
app.post("/api/admin/arenas", auth("admin"), async (req: AuthRequest, res) => {
  const name = String(req.body.name ?? "").trim();
  const code = String(req.body.code ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
  const seconds = Math.max(
    10,
    Math.min(60, Number(req.body.defaultSeconds ?? 30)),
  );
  if (name.length < 2 || code.length < 3)
    return res.status(400).json({
      message: "Informe o nome e um código com pelo menos 3 caracteres.",
    });
  if (findArena(code))
    return res
      .status(409)
      .json({ message: "Esse código de quadra já existe." });
  res.status(201).json(await createArena(name, code, seconds, req.auth!.id));
});
app.patch("/api/admin/arenas/:id", auth("admin"), async (req: AuthRequest, res) => {
  const arena = findArenaById(String(req.params.id));
  if (arena && !adminOwnsArena(req.auth!.id, arena.id)) return res.status(403).json({ message: "Esta quadra pertence a outro cliente." });
  if (!arena)
    return res.status(404).json({ message: "Quadra não encontrada." });
  const name = String(req.body.name ?? arena.name).trim();
  const code = String(req.body.code ?? arena.code)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
  const existing = findArena(code);
  if (existing && existing.id !== arena.id)
    return res.status(409).json({ message: "Esse código já está em uso." });
  const updated = await updateArena(arena.id, {
    name,
    code,
    defaultSeconds: Math.max(
      10,
      Math.min(60, Number(req.body.defaultSeconds ?? arena.defaultSeconds)),
    ),
    retentionDays: Math.max(
      1,
      Math.min(30, Number(req.body.retentionDays ?? arena.retentionDays)),
    ),
  });
  res.json(updated);
});
app.post("/api/admin/arenas/:id/watermark", auth("admin"), async (req: AuthRequest, res) => {
  const arena = findArenaById(String(req.params.id));
  if (arena && !adminOwnsArena(req.auth!.id, arena.id)) return res.status(403).json({ message: "Esta quadra pertence a outro cliente." });
  const image = String(req.body.image ?? "");
  if (!arena)
    return res.status(404).json({ message: "Quadra não encontrada." });
  if (
    !/^data:image\/(png|jpeg|webp);base64,/i.test(image) ||
    image.length > 3_000_000
  )
    return res
      .status(400)
      .json({ message: "Envie uma imagem PNG, JPG ou WebP de até 2 MB." });
  const watermarkUrl = await uploadBrandImage(image, arena.id);
  await updateArena(arena.id, { watermarkUrl });
  res.json({ watermarkUrl, message: "Marca d'água atualizada." });
});
app.delete("/api/admin/arenas/:id", auth("admin"), async (req: AuthRequest, res) => {
  const arena = findArenaById(String(req.params.id));
  if (arena && !adminOwnsArena(req.auth!.id, arena.id)) return res.status(403).json({ message: "Esta quadra pertence a outro cliente." });
  if (!arena)
    return res.status(404).json({ message: "Quadra não encontrada." });
  for (const camera of listCameras().filter(
    (item) => item.arenaId === arena.id,
  ))
    stopRtspCapture(camera.id);
  for (const replay of arenaReplays(arena.id)) {
    await unlink(path.join(replaysRoot, replay.filename)).catch(
      () => undefined,
    );
    await deleteCloudReplay(replay.cloudPublicId).catch(() => undefined);
  }
  await removeArena(arena.id);
  res.status(204).send();
});
app.get("/api/admin/users", auth("admin"), (req: AuthRequest, res) =>
  res.json(listUsersForAdmin(req.auth!.id)),
);
app.delete("/api/admin/users/:id", auth("admin"), async (req: AuthRequest, res) => {
  const id = String(req.params.id);
  if (!adminCanManageUser(req.auth!.id, id))
    return res.status(403).json({ message: "Este usuário não pertence à sua arena." });
  const ok = await removeUser(id);
  if (!ok)
    return res.status(409).json({
      message: "Não é possível excluir usuário que possui replays.",
    });
  res.status(204).send();
});
app.get("/api/developer/users", auth("developer"), (_req, res) =>
  res.json(listUsers().filter((user) => user.role !== "developer")),
);
app.delete("/api/developer/users/:id", auth("developer"), async (req, res) => {
  const ok = await removeUser(String(req.params.id));
  if (!ok)
    return res.status(409).json({ message: "Não é possível excluir administrador ou usuário que possui replays." });
  res.status(204).send();
});
app.get("/api/admin/cameras", auth("admin"), (req: AuthRequest, res) =>
  res.json(listCameras(req.auth!.id)),
);
type AgentCameraHeartbeat = { running: boolean; bufferedSeconds: number; error?: string; updatedAt: number };
const agentHeartbeats = new Map<string, { updatedAt: number; cameras: Map<string, AgentCameraHeartbeat> }>();
const AGENT_HEARTBEAT_TTL_MS = 8_000;
const agentPreviews = new Map<string, { data: Buffer; updatedAt: number }>();

app.post("/api/agent/heartbeat", agentAuth, async (req: AuthRequest, res) => {
  const now = Date.now();
  const states = Array.isArray(req.body?.cameras) ? req.body.cameras : [];
  const cameras = new Map<string, AgentCameraHeartbeat>();
  for (const item of states) {
    const id = String(item?.id ?? "");
    const camera = findCamera(id);
    if (!camera || !adminOwnsArena(req.auth!.id, camera.arenaId)) continue;
    const running = Boolean(item?.running);
    const error = item?.error ? String(item.error).slice(0, 500) : undefined;
    cameras.set(id, {
      running,
      bufferedSeconds: Math.max(0, Math.min(90, Number(item?.bufferedSeconds ?? 0))),
      error,
      updatedAt: now,
    });
    // O heartbeat do Agent é a fonte real do estado da câmera. Persistimos
    // apenas quando muda para não gravar no banco a cada 2 segundos.
    const nextStatus = running ? "online" : error ? "offline" : camera.status;
    if (nextStatus !== camera.status) await updateCameraStatus(camera.id, nextStatus, error);
  }
  agentHeartbeats.set(req.auth!.id, { updatedAt: now, cameras });
  res.json({ ok: true, receivedAt: new Date(now).toISOString() });
});


app.post(
  "/api/agent/cameras/:id/preview",
  agentAuth,
  express.raw({ type: "image/jpeg", limit: "512kb" }),
  (req: AuthRequest, res) => {
    const camera = findCamera(String(req.params.id));
    if (!camera || !adminOwnsArena(req.auth!.id, camera.arenaId))
      return res.status(404).json({ message: "Câmera não encontrada." });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0)
      return res.status(400).json({ message: "Preview inválido." });
    agentPreviews.set(camera.id, { data: req.body, updatedAt: Date.now() });
    res.json({ ok: true });
  },
);

app.get("/api/admin/cameras/:id/preview", auth("admin"), (req: AuthRequest, res) => {
  const camera = findCamera(String(req.params.id));
  if (!camera || !adminOwnsArena(req.auth!.id, camera.arenaId))
    return res.status(404).json({ message: "Câmera não encontrada." });
  const preview = agentPreviews.get(camera.id);
  if (!preview || Date.now() - preview.updatedAt > 15_000)
    return res.status(204).send();
  res.json({
    updatedAt: new Date(preview.updatedAt).toISOString(),
    dataUrl: `data:image/jpeg;base64,${preview.data.toString("base64")}`,
  });
});

app.get("/api/admin/agent-status", auth("admin"), (req: AuthRequest, res) => {
  const agent = agentHeartbeats.get(req.auth!.id);
  const agentOnline = Boolean(agent && Date.now() - agent.updatedAt <= AGENT_HEARTBEAT_TTL_MS);
  const states = listCameras(req.auth!.id).map((camera) => {
    const state = agent?.cameras.get(camera.id);
    const fresh = Boolean(state && Date.now() - state.updatedAt <= AGENT_HEARTBEAT_TTL_MS);
    return {
      cameraId: camera.id,
      agentOnline,
      running: Boolean(agentOnline && fresh && state?.running),
      bufferedSeconds: agentOnline && fresh ? state?.bufferedSeconds ?? 0 : 0,
      error: agentOnline && fresh ? state?.error : undefined,
    };
  });
  res.json({ agentOnline, states });
});

app.get("/api/agent/config", agentAuth, (req: AuthRequest, res) => {
  const arenas = listArenas(req.auth!.id);
  const arenaIds = new Set(arenas.map((arena) => arena.id));
  const cameras = listCameras(req.auth!.id)
    .map((safe) => findCamera(safe.id))
    .filter((camera) => camera && arenaIds.has(camera.arenaId));
  res.json({ arenas, cameras });
});
app.post("/api/admin/cameras", auth("admin"), async (req: AuthRequest, res) => {
  const arena =
    findArenaById(String(req.body.arenaId ?? "")) ??
    findArena(String(req.body.arenaCode ?? "QUADRA01"));
  if (arena && !adminOwnsArena(req.auth!.id, arena.id))
    return res.status(403).json({ message: "Esta quadra pertence a outro cliente." });
  const name = String(req.body.name ?? "").trim();
  const host = String(req.body.host ?? "").trim();
  if (!arena || name.length < 2 || !host || !/^[a-zA-Z0-9.-]+$/.test(host))
    return res
      .status(400)
      .json({ message: "Informe nome e endereço IP válidos." });
  const type = req.body.type === "mjpeg" ? "mjpeg" : "rtsp";
  const camera = await createCamera({
    arenaId: arena.id,
    name,
    type,
    host,
    port: Math.max(
      1,
      Math.min(65535, Number(req.body.port ?? (type === "mjpeg" ? 8080 : 554))),
    ),
    username: String(req.body.username ?? ""),
    password: String(req.body.password ?? ""),
    path: String(req.body.path ?? "").replace(/^\/+/, ""),
    transport: req.body.transport === "udp" ? "udp" : "tcp",
    active: true,
  });
  const { password: _, ...safe } = camera;
  res.status(201).json({ ...safe, hasPassword: Boolean(camera.password) });
});
app.post("/api/admin/cameras/:id/test", auth("admin"), async (req: AuthRequest, res) => {
  const camera = findCamera(String(req.params.id));
  if (camera && !adminOwnsArena(req.auth!.id, camera.arenaId))
    return res.status(403).json({ message: "Esta câmera pertence a outro cliente." });
  if (!camera)
    return res.status(404).json({ message: "Câmera não encontrada." });

  // Em produção a câmera está na LAN da arena. O Render não consegue testar
  // 192.168.x.x diretamente; quem valida/captura é o ER Capture Agent local.
  await updateCameraStatus(camera.id, "untested");
  res.json({
    ok: true,
    delegatedToAgent: true,
    message: "Câmera cadastrada. O teste/captura será feito pelo ER Capture Agent da arena.",
  });
});
app.post("/api/admin/cameras/:id/start", auth("admin"), async (req: AuthRequest, res) => {
  const camera = findCamera(String(req.params.id));
  if (camera && !adminOwnsArena(req.auth!.id, camera.arenaId))
    return res.status(403).json({ message: "Esta câmera pertence a outro cliente." });
  if (!camera || camera.type === "webcam")
    return res.status(404).json({ message: "Câmera IP não encontrada." });

  // Apenas seleciona a câmera na API. O Agent consulta /api/agent/config a cada
  // poucos segundos e inicia o FFmpeg dentro da rede local da arena.
  await activateArenaCamera(camera.arenaId, camera.id);
  await updateCameraStatus(camera.id, "untested");
  res.json({
    ok: true,
    delegatedToAgent: true,
    cameraId: camera.id,
    message: "Câmera ativada. Aguardando o ER Capture Agent iniciar a captura local.",
  });
});
app.post("/api/admin/cameras/:id/stop", auth("admin"), async (req: AuthRequest, res) => {
  const camera = findCamera(String(req.params.id));
  if (camera && !adminOwnsArena(req.auth!.id, camera.arenaId)) return res.status(403).json({ message: "Esta câmera pertence a outro cliente." });
  if (!camera) return res.status(404).json({ message: "Câmera não encontrada." });
  await activateArenaCamera(camera.arenaId, "");
  res.json({ ok: true, message: "Parada solicitada ao ER Capture Agent." });
});
app.get("/api/admin/cameras/:id/capture-status", auth("admin"), (req: AuthRequest, res) => {
  const camera = findCamera(String(req.params.id));
  if (camera && !adminOwnsArena(req.auth!.id, camera.arenaId)) return res.status(403).json({ message: "Esta câmera pertence a outro cliente." });
  if (!camera) return res.status(404).json({ message: "Câmera não encontrada." });
  const agent = agentHeartbeats.get(req.auth!.id);
  const state = agent?.cameras.get(camera.id);
  const agentOnline = Boolean(agent && Date.now() - agent.updatedAt <= AGENT_HEARTBEAT_TTL_MS);
  const fresh = Boolean(state && Date.now() - state.updatedAt <= AGENT_HEARTBEAT_TTL_MS);
  res.json({
    cameraId: camera.id,
    running: Boolean(agentOnline && fresh && state?.running),
    bufferedSeconds: agentOnline && fresh ? state?.bufferedSeconds ?? 0 : 0,
    agentOnline,
    error: agentOnline && fresh ? state?.error : "ER Capture Agent offline ou sem heartbeat recente.",
  });
});
app.post("/api/admin/cameras/:id/activate", auth("admin"), async (req: AuthRequest, res) => {
  const camera = findCamera(String(req.params.id));
  if (camera && !adminOwnsArena(req.auth!.id, camera.arenaId)) return res.status(403).json({ message: "Esta câmera pertence a outro cliente." });
  if (!camera)
    return res.status(404).json({ message: "Câmera não encontrada." });
  await activateArenaCamera(camera.arenaId, camera.id);
  res.json({ ok: true });
});
app.delete("/api/admin/cameras/:id", auth("admin"), async (req: AuthRequest, res) => {
  const camera = findCamera(String(req.params.id));
  if (camera && !adminOwnsArena(req.auth!.id, camera.arenaId)) return res.status(403).json({ message: "Esta câmera pertence a outro cliente." });
  if (!camera || camera.type === "webcam")
    return res.status(404).json({ message: "Câmera IP não encontrada." });
  stopRtspCapture(camera.id);
  await removeCamera(camera.id);
  res.status(204).send();
});

app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    service: "ER Replay API",
    environment: isProduction ? "production" : "development",
    cloudStorage: cloudStorageEnabled(),
    timestamp: new Date().toISOString(),
  }),
);
app.get("/api/system/network", (_req, res) => {
  const address = Object.values(os.networkInterfaces())
    .flat()
    .find((item) => item?.family === "IPv4" && !item.internal)?.address;
  const localWebUrl = `http://${address ?? "localhost"}:5173`;
  res.json({
    address: address ?? "localhost",
    localWebUrl,
    webUrl: publicWebUrl ?? localWebUrl,
    online: Boolean(publicWebUrl),
  });
});

app.post(
  "/api/stream/segments",
  auth("admin"),
  express.raw({
    type: ["video/webm", "application/octet-stream"],
    limit: "20mb",
  }),
  async (req, res, next) => {
    try {
      const cameraId = String(req.header("x-camera-id") ?? "quadra-01").replace(
        /[^a-zA-Z0-9_-]/g,
        "",
      );
      const durationMs = Math.max(
        500,
        Math.min(10_000, Number(req.header("x-duration-ms") ?? 2000)),
      );
      if (!Buffer.isBuffer(req.body) || req.body.length === 0)
        return res.status(400).json({ message: "Segmento vazio." });

      const cameraFolder = path.join(segmentsRoot, cameraId);
      await mkdir(cameraFolder, { recursive: true });
      const id = randomUUID();
      const segmentPath = path.join(cameraFolder, `${Date.now()}-${id}.webm`);
      await writeFile(segmentPath, req.body);
      const status = await addSegment({
        id,
        cameraId,
        path: segmentPath,
        durationMs,
        createdAt: Date.now(),
      });
      res.status(201).json(status);
    } catch (error) {
      next(error);
    }
  },
);

app.get("/api/stream/status/:cameraId", (req, res) =>
  res.json(bufferStatus(req.params.cameraId)),
);

type AgentReplayJob = {
  id: string;
  arenaId: string;
  arenaCode: string;
  cameraId: string;
  userId: string;
  seconds: number;
  status: "pending" | "processing" | "done" | "failed";
  createdAt: string;
  claimedAt?: string;
  replayId?: string;
  error?: string;
};
const agentReplayJobs = new Map<string, AgentReplayJob>();

app.get("/api/agent/jobs/next", agentAuth, (req: AuthRequest, res) => {
  const job = [...agentReplayJobs.values()].find((item) =>
    item.status === "pending" && adminOwnsArena(req.auth!.id, item.arenaId),
  );
  if (!job) return res.status(204).send();
  job.status = "processing";
  job.claimedAt = new Date().toISOString();
  res.json(job);
});

app.post(
  "/api/agent/jobs/:id/complete",
  agentAuth,
  express.raw({ type: "application/octet-stream", limit: "250mb" }),
  async (req: AuthRequest, res, next) => {
    try {
      const job = agentReplayJobs.get(String(req.params.id));
      if (!job || !adminOwnsArena(req.auth!.id, job.arenaId))
        return res.status(404).json({ message: "Solicitação de replay não encontrada." });
      if (!Buffer.isBuffer(req.body) || req.body.length < 1000)
        return res.status(400).json({ message: "Vídeo do replay vazio." });
      const arena = findArenaById(job.arenaId);
      if (!arena) return res.status(404).json({ message: "Quadra não encontrada." });
      const id = randomUUID();
      const filename = `replay-${job.cameraId}-${Date.now()}.mp4`;
      const outputPath = path.join(replaysRoot, filename);
      await writeFile(outputPath, req.body);
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + arena.retentionDays * 86400000).toISOString();
      let url = `/replays/${filename}`;
      let cloudPublicId: string | undefined;
      if (cloudStorageEnabled()) {
        const cloud = await uploadReplay(outputPath, `replay-${id}`);
        url = cloud.url;
        cloudPublicId = cloud.cloudPublicId;
        await unlink(outputPath).catch(() => undefined);
      }
      const replay = {
        id, cameraId: job.cameraId, arenaId: job.arenaId, userId: job.userId,
        seconds: job.seconds, createdAt: createdAt.toISOString(), expiresAt,
        filename, url, cloudPublicId,
      };
      addReplay(replay);
      await persistReplay(replay);
      job.status = "done";
      job.replayId = id;
      res.status(201).json(replay);
    } catch (error) { next(error); }
  },
);

app.post("/api/agent/jobs/:id/fail", agentAuth, (req: AuthRequest, res) => {
  const job = agentReplayJobs.get(String(req.params.id));
  if (!job || !adminOwnsArena(req.auth!.id, job.arenaId))
    return res.status(404).json({ message: "Solicitação não encontrada." });
  job.status = "failed";
  job.error = String(req.body?.message ?? "Falha ao gerar replay.").slice(0, 500);
  res.json({ ok: true });
});

app.get("/api/replay-jobs/:id", auth(), (req: AuthRequest, res) => {
  const job = agentReplayJobs.get(String(req.params.id));
  if (!job || (req.auth!.role === "player" && job.userId !== req.auth!.id))
    return res.status(404).json({ message: "Solicitação não encontrada." });
  res.json(job);
});

app.post("/api/replays", auth(), async (req: AuthRequest, res) => {
  const arena = findArena(String(req.body.arenaCode ?? "QUADRA01"));
  if (!arena) return res.status(404).json({ message: "Quadra não encontrada." });
  const cameraId = String(req.body.cameraId ?? "").trim();
  if (!cameraId) return res.status(400).json({ message: "Este botão não está vinculado a uma câmera." });
  const camera = findCamera(cameraId);
  if (!camera || camera.arenaId !== arena.id)
    return res.status(404).json({ message: "A câmera vinculada não pertence a esta quadra." });
  if (arena.cameraId !== cameraId)
    return res.status(409).json({ message: "Esta câmera não está mais ativa nesta quadra. Abra novamente o botão da quadra." });
  const seconds = Math.max(6, Math.min(60, Number(req.body.seconds ?? arena.defaultSeconds)));
  const job: AgentReplayJob = {
    id: randomUUID(), arenaId: arena.id, arenaCode: arena.code, cameraId,
    userId: req.auth!.id, seconds, status: "pending", createdAt: new Date().toISOString(),
  };
  agentReplayJobs.set(job.id, job);
  setTimeout(() => {
    const current = agentReplayJobs.get(job.id);
    if (current && current.status === "pending") { current.status = "failed"; current.error = "ER Capture Agent offline ou sem resposta."; }
  }, 45_000).unref();
  res.status(202).json({ jobId: job.id, status: job.status });
});

app.get("/api/replays", auth(), (req: AuthRequest, res) =>
  res.json(listDbReplays(req.auth!)),
);
app.get("/api/admin/replays", auth("admin"), (req: AuthRequest, res) =>
  res.json(listDbReplays(req.auth!)),
);
app.delete("/api/replays/:id", auth(), async (req: AuthRequest, res) => {
  const replay = findReplay(String(req.params.id));
  if (!replay)
    return res.status(404).json({ message: "Replay não encontrado." });
  if (req.auth!.role === "admin" && !adminOwnsArena(req.auth!.id, replay.arenaId))
    return res.status(403).json({ message: "Este replay pertence a outro cliente." });
  if (req.auth!.role !== "admin" && req.auth!.role !== "developer" && replay.userId !== req.auth!.id)
    return res.status(403).json({ message: "Você não pode apagar este replay." });
  await unlink(path.join(replaysRoot, replay.filename)).catch(() => undefined);
  await deleteCloudReplay(replay.cloudPublicId).catch(() => undefined);
  await removeReplay(replay.id);
  res.status(204).send();
});

setInterval(
  async () => {
    for (const replay of expiredReplays()) {
      await unlink(path.join(replaysRoot, replay.filename)).catch(
        () => undefined,
      );
      await deleteCloudReplay(replay.cloudPublicId).catch(() => undefined);
      await removeReplay(replay.id);
    }
  },
  60 * 60 * 1000,
).unref();

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(error);
    res.status(500).json({
      message: error instanceof Error ? error.message : "Erro inesperado.",
    });
  },
);

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`ER Replay API ativa na porta ${port}`);
  if (publicWebUrl) console.log(`ER Replay Web: ${publicWebUrl}`);
});

function shutdown(signal: string) {
  console.log(`${signal} recebido. Encerrando capturas...`);
  stopAllRtspCaptures();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
