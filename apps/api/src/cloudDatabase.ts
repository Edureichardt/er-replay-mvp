import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import type { Arena, CameraSource, DbReplay, User } from "./database.js";

type Snapshot = {
  users: User[];
  arenas: Arena[];
  cameras: CameraSource[];
  replays: DbReplay[];
};
let prisma: PrismaClient | null = null;

export function neonEnabled() {
  const url = process.env.DATABASE_URL ?? "";
  return url.startsWith("postgresql://") && !url.includes("placeholder");
}
function client() {
  if (!prisma)
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    });
  return prisma;
}

export async function loadFromNeon(): Promise<Snapshot | null> {
  if (!neonEnabled()) return null;
  const db = client();
  const [users, arenas, cameras, replays] = await Promise.all([
    db.user.findMany(),
    db.arena.findMany(),
    db.camera.findMany(),
    db.replay.findMany({ orderBy: { createdAt: "desc" } }),
  ]);
  if (!users.length && !arenas.length)
    return { users: [], arenas: [], cameras: [], replays: [] };
  return {
    users: users.map((rawItem) => {
      const item = rawItem as typeof rawItem & {
        licenseExpiresAt?: Date | null; licenseDays?: number | null;
        accessActive?: boolean; lastPaymentAt?: Date | null; arenaId?: string | null;
      };
      return ({
      id: item.id,
      name: item.name,
      email: item.email,
      passwordHash: item.passwordHash,
      role:
        item.role === "DEVELOPER"
          ? "developer"
          : item.role === "ADMIN"
            ? "admin"
            : "player",
      createdAt: item.createdAt.toISOString(),
      licenseExpiresAt: item.licenseExpiresAt?.toISOString(),
      licenseDays: item.licenseDays ?? undefined,
      accessActive: item.accessActive,
      lastPaymentAt: item.lastPaymentAt?.toISOString(),
      arenaId: item.arenaId ?? undefined,
    });
    }),
    arenas: arenas.map((rawItem) => {
      const item = rawItem as typeof rawItem & { ownerId?: string | null };
      return ({
      id: item.id,
      name: item.name,
      code: item.code,
      cameraId:
        (item as typeof item & { activeCameraId?: string | null })
          .activeCameraId ?? "",
      defaultSeconds: item.defaultSeconds,
      retentionDays: item.retentionDays,
      watermarkUrl: item.watermarkUrl ?? undefined,
      active: item.active,
      ownerId: item.ownerId ?? undefined,
    });
    }),
    cameras: cameras.map((item) => ({
      id: item.id,
      arenaId: item.arenaId,
      name: item.name,
      type: item.type.toLowerCase() as CameraSource["type"],
      host: item.host,
      port: item.port,
      username: item.username ?? "",
      password: item.password ?? "",
      path: item.path,
      transport: item.transport as "tcp" | "udp",
      active: item.active,
      status: item.status.toLowerCase() as CameraSource["status"],
      lastTestedAt: item.lastTestedAt?.toISOString(),
      lastError: item.lastError ?? undefined,
    })),
    replays: replays.map((item) => ({
      id: item.id,
      cameraId: item.cameraId,
      arenaId: item.arenaId,
      userId: item.userId,
      seconds: item.seconds,
      createdAt: item.createdAt.toISOString(),
      expiresAt: item.expiresAt.toISOString(),
      filename: item.filename,
      url: item.url,
      cloudPublicId: item.cloudPublicId ?? undefined,
    })),
  };
}

export async function saveToNeon(data: Snapshot) {
  if (!neonEnabled()) return;
  const db = client();
  await db.$transaction(async (tx) => {
    for (const user of data.users) {
      const role =
        user.role === "developer"
          ? "DEVELOPER"
          : user.role === "admin"
            ? "ADMIN"
            : "PLAYER";
      await tx.user.upsert({
        where: { id: user.id },
        update: {
          name: user.name,
          email: user.email,
          passwordHash: user.passwordHash,
          role,
          licenseExpiresAt: user.licenseExpiresAt ? new Date(user.licenseExpiresAt) : null,
          licenseDays: user.licenseDays ?? null,
          accessActive: user.accessActive ?? true,
          lastPaymentAt: user.lastPaymentAt ? new Date(user.lastPaymentAt) : null,
        } as never,
        create: {
          id: user.id,
          name: user.name,
          email: user.email,
          passwordHash: user.passwordHash,
          role,
          createdAt: new Date(user.createdAt),
          licenseExpiresAt: user.licenseExpiresAt ? new Date(user.licenseExpiresAt) : null,
          licenseDays: user.licenseDays ?? null,
          accessActive: user.accessActive ?? true,
          lastPaymentAt: user.lastPaymentAt ? new Date(user.lastPaymentAt) : null,
        } as never,
      });
    }
    for (const arena of data.arenas)
      await tx.arena.upsert({
        where: { id: arena.id },
        update: {
          name: arena.name,
          code: arena.code,
          defaultSeconds: arena.defaultSeconds,
          retentionDays: arena.retentionDays,
          watermarkUrl: arena.watermarkUrl ?? null,
          activeCameraId: arena.cameraId || null,
          active: arena.active,
          ownerId: arena.ownerId ?? null,
        } as never,
        create: {
          id: arena.id,
          name: arena.name,
          code: arena.code,
          defaultSeconds: arena.defaultSeconds,
          retentionDays: arena.retentionDays,
          watermarkUrl: arena.watermarkUrl ?? null,
          activeCameraId: arena.cameraId || null,
          active: arena.active,
          ownerId: arena.ownerId ?? null,
        } as never,
      });
    // O jogador referencia a arena, então o vínculo é aplicado somente depois
    // que todas as arenas já existem no Neon. Isso evita FK em banco novo.
    for (const user of data.users) {
      if (user.role !== "player") continue;
      await tx.user.update({
        where: { id: user.id },
        data: { arenaId: user.arenaId ?? null } as never,
      });
    }
    for (const camera of data.cameras)
      await tx.camera.upsert({
        where: { id: camera.id },
        update: {
          arenaId: camera.arenaId,
          name: camera.name,
          type: camera.type.toUpperCase() as "WEBCAM" | "RTSP" | "MJPEG",
          host: camera.host,
          port: camera.port,
          username: camera.username || null,
          password: camera.password || null,
          path: camera.path,
          transport: camera.transport,
          active: camera.active,
          status: camera.status.toUpperCase() as
            "UNTESTED" | "ONLINE" | "OFFLINE",
          lastTestedAt: camera.lastTestedAt
            ? new Date(camera.lastTestedAt)
            : null,
          lastError: camera.lastError ?? null,
        },
        create: {
          id: camera.id,
          arenaId: camera.arenaId,
          name: camera.name,
          type: camera.type.toUpperCase() as "WEBCAM" | "RTSP" | "MJPEG",
          host: camera.host,
          port: camera.port,
          username: camera.username || null,
          password: camera.password || null,
          path: camera.path,
          transport: camera.transport,
          active: camera.active,
          status: camera.status.toUpperCase() as
            "UNTESTED" | "ONLINE" | "OFFLINE",
          lastTestedAt: camera.lastTestedAt
            ? new Date(camera.lastTestedAt)
            : null,
          lastError: camera.lastError ?? null,
        },
      });
    for (const replay of data.replays)
      await tx.replay.upsert({
        where: { id: replay.id },
        update: {
          cameraId: replay.cameraId,
          arenaId: replay.arenaId,
          userId: replay.userId,
          seconds: replay.seconds,
          filename: replay.filename,
          url: replay.url,
          cloudPublicId: replay.cloudPublicId ?? null,
          expiresAt: new Date(replay.expiresAt ?? Date.now() + 604800000),
        },
        create: {
          id: replay.id,
          cameraId: replay.cameraId,
          arenaId: replay.arenaId,
          userId: replay.userId,
          seconds: replay.seconds,
          filename: replay.filename,
          url: replay.url,
          cloudPublicId: replay.cloudPublicId ?? null,
          createdAt: new Date(replay.createdAt),
          expiresAt: new Date(replay.expiresAt ?? Date.now() + 604800000),
        },
      });
    await tx.replay.deleteMany({
      where: { id: { notIn: data.replays.map((item) => item.id) } },
    });

    // Replays históricos mantêm referências para câmera, arena e usuário.
    // Não podemos apagar esses registros-pai enquanto algum replay salvo ainda
    // depender deles, senão o PostgreSQL bloqueia a operação por foreign key.
    const replayCameraIds = [...new Set(data.replays.map((item) => item.cameraId))];
    const replayArenaIds = [...new Set(data.replays.map((item) => item.arenaId))];
    const replayUserIds = [...new Set(data.replays.map((item) => item.userId))];
    const currentCameraArenaIds = [
      ...new Set(data.cameras.map((item) => item.arenaId)),
    ];

    await tx.camera.deleteMany({
      where: {
        id: {
          notIn: [
            ...data.cameras.map((item) => item.id),
            ...replayCameraIds,
          ],
        },
      },
    });

    await tx.arena.deleteMany({
      where: {
        id: {
          notIn: [
            ...data.arenas.map((item) => item.id),
            ...replayArenaIds,
            ...currentCameraArenaIds,
          ],
        },
      },
    });

    await tx.user.deleteMany({
      where: {
        id: {
          notIn: [...data.users.map((item) => item.id), ...replayUserIds],
        },
        role: "PLAYER",
      },
    });
  });
}
