import { Pool } from "pg";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function ensureAgentTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "AgentPairingCode" (
      "id" text PRIMARY KEY,
      "ownerId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "codeHash" text NOT NULL UNIQUE,
      "expiresAt" timestamptz NOT NULL,
      "usedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "AgentPairingCode_ownerId_idx" ON "AgentPairingCode"("ownerId");
    CREATE TABLE IF NOT EXISTS "CaptureAgent" (
      "id" text PRIMARY KEY,
      "ownerId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "machineName" text,
      "tokenHash" text NOT NULL UNIQUE,
      "active" boolean NOT NULL DEFAULT true,
      "lastSeenAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "CaptureAgent_ownerId_idx" ON "CaptureAgent"("ownerId");
  `);
}

function formatCode(raw: string) {
  return `ER-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}`;
}

export async function createPairingCode(ownerId: string) {
  const raw = randomBytes(9).toString("base64url").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 12).padEnd(12, "X");
  const code = formatCode(raw);
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  await pool.query(`DELETE FROM "AgentPairingCode" WHERE "ownerId"=$1 AND "usedAt" IS NULL`, [ownerId]);
  await pool.query(`INSERT INTO "AgentPairingCode" ("id","ownerId","codeHash","expiresAt") VALUES ($1,$2,$3,$4)`, [randomUUID(), ownerId, hash(code), expiresAt]);
  return { code, expiresAt: expiresAt.toISOString() };
}

export async function pairAgent(code: string, machineName: string) {
  const result = await pool.query(`SELECT * FROM "AgentPairingCode" WHERE "codeHash"=$1 AND "usedAt" IS NULL AND "expiresAt">now() LIMIT 1`, [hash(code.trim().toUpperCase())]);
  const pairing = result.rows[0];
  if (!pairing) return null;
  const token = `era_${randomBytes(32).toString("base64url")}`;
  const id = randomUUID();
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const consumed = await db.query(`UPDATE "AgentPairingCode" SET "usedAt"=now() WHERE "id"=$1 AND "usedAt" IS NULL RETURNING "id"`, [pairing.id]);
    if (!consumed.rowCount) throw new Error("Código de pareamento já utilizado.");
    await db.query(`INSERT INTO "CaptureAgent" ("id","ownerId","name","machineName","tokenHash","lastSeenAt") VALUES ($1,$2,$3,$4,$5,now())`, [id, pairing.ownerId, machineName || "PC da arena", machineName || null, hash(token)]);
    await db.query("COMMIT");
  } catch (e) { await db.query("ROLLBACK"); throw e; }
  finally { db.release(); }
  return { token, agentId: id, ownerId: pairing.ownerId };
}

export async function authenticateAgent(token: string) {
  if (!token) return null;
  const result = await pool.query(`SELECT "id","ownerId","name","machineName","active" FROM "CaptureAgent" WHERE "tokenHash"=$1 LIMIT 1`, [hash(token)]);
  const agent = result.rows[0];
  if (!agent || !agent.active) return null;
  await pool.query(`UPDATE "CaptureAgent" SET "lastSeenAt"=now() WHERE "id"=$1`, [agent.id]);
  return { id: agent.id as string, ownerId: agent.ownerId as string, name: agent.name as string, machineName: agent.machineName as string | null };
}

export async function listAgents(ownerId?: string) {
  const result = ownerId
    ? await pool.query(`SELECT "id","ownerId","name","machineName","active","lastSeenAt","createdAt" FROM "CaptureAgent" WHERE "ownerId"=$1 ORDER BY "createdAt" DESC`, [ownerId])
    : await pool.query(`SELECT "id","ownerId","name","machineName","active","lastSeenAt","createdAt" FROM "CaptureAgent" ORDER BY "createdAt" DESC`);
  return result.rows.map(r => ({...r, online: Boolean(r.active && r.lastSeenAt && Date.now()-new Date(r.lastSeenAt).getTime()<15000)}));
}

export async function revokeAgent(id: string) {
  const result = await pool.query(`UPDATE "CaptureAgent" SET "active"=false WHERE "id"=$1 RETURNING "id"`, [id]);
  return Boolean(result.rowCount);
}
