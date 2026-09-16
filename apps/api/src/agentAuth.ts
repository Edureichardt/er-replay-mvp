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
    CREATE TABLE IF NOT EXISTS "ReplayJob" (
      "id" text PRIMARY KEY,
      "ownerId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "arenaId" text NOT NULL REFERENCES "Arena"("id") ON DELETE CASCADE,
      "arenaCode" text NOT NULL,
      "cameraId" text NOT NULL REFERENCES "Camera"("id") ON DELETE CASCADE,
      "userId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "seconds" integer NOT NULL,
      "status" text NOT NULL DEFAULT 'pending',
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "claimedAt" timestamptz,
      "finishedAt" timestamptz,
      "replayId" text,
      "error" text
    );
    CREATE INDEX IF NOT EXISTS "ReplayJob_owner_status_created_idx" ON "ReplayJob"("ownerId","status","createdAt");
    CREATE INDEX IF NOT EXISTS "ReplayJob_user_created_idx" ON "ReplayJob"("userId","createdAt");
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


export type PersistentReplayJob = {
  id:string; ownerId:string; arenaId:string; arenaCode:string; cameraId:string; userId:string;
  seconds:number; status:"pending"|"processing"|"done"|"failed"; createdAt:string;
  claimedAt?:string; finishedAt?:string; replayId?:string; error?:string;
};
function mapReplayJob(r:any):PersistentReplayJob{return {id:r.id,ownerId:r.ownerId,arenaId:r.arenaId,arenaCode:r.arenaCode,cameraId:r.cameraId,userId:r.userId,seconds:r.seconds,status:r.status,createdAt:new Date(r.createdAt).toISOString(),claimedAt:r.claimedAt?new Date(r.claimedAt).toISOString():undefined,finishedAt:r.finishedAt?new Date(r.finishedAt).toISOString():undefined,replayId:r.replayId??undefined,error:r.error??undefined};}
export async function createReplayJob(job:{id:string;ownerId:string;arenaId:string;arenaCode:string;cameraId:string;userId:string;seconds:number}){
  const r=await pool.query(`INSERT INTO "ReplayJob" ("id","ownerId","arenaId","arenaCode","cameraId","userId","seconds") VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[job.id,job.ownerId,job.arenaId,job.arenaCode,job.cameraId,job.userId,job.seconds]); return mapReplayJob(r.rows[0]);
}
export async function claimNextReplayJob(ownerId:string){
  await pool.query(`UPDATE "ReplayJob" SET "status"='pending',"claimedAt"=NULL,"error"=NULL WHERE "ownerId"=$1 AND "status"='processing' AND "claimedAt" < now()-interval '90 seconds'`,[ownerId]);
  const r=await pool.query(`WITH next AS (SELECT "id" FROM "ReplayJob" WHERE "ownerId"=$1 AND "status"='pending' ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE "ReplayJob" j SET "status"='processing',"claimedAt"=now() FROM next WHERE j."id"=next."id" RETURNING j.*`,[ownerId]); return r.rows[0]?mapReplayJob(r.rows[0]):null;
}
export async function getReplayJob(id:string){const r=await pool.query(`SELECT * FROM "ReplayJob" WHERE "id"=$1 LIMIT 1`,[id]);return r.rows[0]?mapReplayJob(r.rows[0]):null;}
export async function finishReplayJob(id:string,replayId:string){await pool.query(`UPDATE "ReplayJob" SET "status"='done',"replayId"=$2,"finishedAt"=now(),"error"=NULL WHERE "id"=$1`,[id,replayId]);}
export async function failReplayJob(id:string,message:string){await pool.query(`UPDATE "ReplayJob" SET "status"='failed',"error"=$2,"finishedAt"=now() WHERE "id"=$1`,[id,message.slice(0,500)]);}
export async function expirePendingReplayJobs(){await pool.query(`UPDATE "ReplayJob" SET "status"='failed',"error"='ER Capture Agent offline ou sem resposta.',"finishedAt"=now() WHERE "status"='pending' AND "createdAt" < now()-interval '45 seconds'`);}
