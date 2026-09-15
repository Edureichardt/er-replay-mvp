import "dotenv/config";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readdir, stat, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

const API = (process.env.API_URL ?? "").replace(/\/$/, "");
const EMAIL = process.env.ADMIN_EMAIL ?? "";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const ROOT = path.resolve(process.env.STORAGE_ROOT ?? "./storage");
if (!API || !EMAIL || !PASSWORD) throw new Error("Configure API_URL, ADMIN_EMAIL e ADMIN_PASSWORD no apps/agent/.env");
await mkdir(ROOT, { recursive: true });

type Camera = {id:string;arenaId:string;name:string;type:"rtsp"|"mjpeg";host:string;port:number;username:string;password?:string;hasPassword?:boolean;path:string;transport:"tcp"|"udp";active:boolean};
type Arena = {id:string;name:string;code:string;cameraId:string;watermarkUrl?:string};
type Job = {id:string;arenaId:string;cameraId:string;seconds:number};
type Capture = {proc:ChildProcessWithoutNullStreams;folder:string;startedAt:number};
const captures = new Map<string,Capture>();
const captureErrors = new Map<string,string>();
let token = "";
const lastPreviewAt = new Map<string, number>();

async function api<T>(route:string, init:RequestInit={}):Promise<T> {
  const r=await fetch(`${API}${route}`,{...init,headers:{...(init.body && typeof init.body === "string"?{"content-type":"application/json"}:{}),...(token?{authorization:`Bearer ${token}`}:{}) ,...(init.headers??{})}});
  if(!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (r.status===204?undefined:await r.json()) as T;
}
async function login(){const data=await api<{token:string}>("/api/auth/login",{method:"POST",body:JSON.stringify({email:EMAIL,password:PASSWORD})});token=data.token;console.log("[agent] autenticado na API");}
function url(c:Camera){const cred=c.username?`${encodeURIComponent(c.username)}:${encodeURIComponent(c.password??"")}@`:"";return `${c.type==="mjpeg"?"http":"rtsp"}://${cred}${c.host}:${c.port}/${c.path.replace(/^\/+/,"")}`;}
function start(c:Camera){if(captures.has(c.id))return;const folder=path.join(ROOT,c.id,String(Date.now()));void mkdir(folder,{recursive:true});const args=["-hide_banner","-loglevel","warning",...(c.type==="rtsp"?["-rtsp_transport",c.transport]:[]),"-i",url(c),"-map","0:v:0","-an","-c:v","libx264","-preset","veryfast","-g","30","-f","segment","-segment_time","2","-reset_timestamps","1","-segment_format","matroska",path.join(folder,"ip-%09d.mkv")];const proc=spawn("ffmpeg",args);let err="";proc.stderr.on("data",x=>err=(err+x.toString()).slice(-1200));proc.on("close",code=>{captures.delete(c.id);captureErrors.set(c.id,err || `FFmpeg encerrou com código ${code}`);console.error(`[agent] câmera ${c.name} encerrou (${code}): ${err}`)});captures.set(c.id,{proc,folder,startedAt:Date.now()});captureErrors.delete(c.id);console.log(`[agent] capturando ${c.name} (${c.host})`);}
async function runFfmpeg(args:string[]){return new Promise<void>((ok,bad)=>{const p=spawn("ffmpeg",args);let e="";p.stderr.on("data",x=>e=(e+x.toString()).slice(-800));p.on("close",c=>c===0?ok():bad(new Error(e||`FFmpeg ${c}`)));});}
async function sendPreview(c:Camera,cap:Capture){
  const now=Date.now(); if(now-(lastPreviewAt.get(c.id)??0)<5000)return; lastPreviewAt.set(c.id,now);
  try{
    const names=(await readdir(cap.folder)).filter(n=>n.endsWith(".mkv")).sort(); const latest=names.at(-2)??names.at(-1); if(!latest)return;
    const jpg=path.join(ROOT,`preview-${c.id}.jpg`);
    await runFfmpeg(["-hide_banner","-loglevel","error","-i",path.join(cap.folder,latest),"-frames:v","1","-vf","scale=640:-2","-q:v","6","-y",jpg]);
    const body=await import("node:fs/promises").then(m=>m.readFile(jpg));
    await api(`/api/agent/cameras/${c.id}/preview`,{method:"POST",headers:{"content-type":"image/jpeg"},body});
    await unlink(jpg).catch(()=>{});
  }catch(e){console.error(`[agent] preview ${c.name}:`,e instanceof Error?e.message:e);}
}
async function heartbeat(cams:Camera[]){
  const states=[] as {id:string;running:boolean;bufferedSeconds:number;error?:string}[];
  for(const c of cams){
    const cap=captures.get(c.id);
    let bufferedSeconds=0;
    if(cap){
      try{const names=(await readdir(cap.folder)).filter(n=>n.endsWith(".mkv"));bufferedSeconds=Math.min(90,Math.max(0,(names.length-1)*2));}catch{}
    }
    states.push({id:c.id,running:Boolean(cap),bufferedSeconds,error:captureErrors.get(c.id)});
    if(cap) void sendPreview(c,cap);
  }
  await api("/api/agent/heartbeat",{method:"POST",body:JSON.stringify({cameras:states})});
}
async function sync(){const config=await api<{cameras:Camera[];arenas:Arena[]}>("/api/agent/config");const cams=config.cameras,arenas=config.arenas;const wanted=new Set(arenas.map(a=>a.cameraId).filter(Boolean));for(const c of cams)if(c.active&&wanted.has(c.id))start(c);for(const [id,x] of captures)if(!wanted.has(id)){x.proc.kill("SIGTERM");captures.delete(id);}await heartbeat(cams);return {cams,arenas};}
async function makeReplay(job:Job, arena:Arena){const cap=captures.get(job.cameraId);if(!cap)throw new Error("Câmera ainda não está sendo capturada pelo Agent.");const names=(await readdir(cap.folder)).filter(n=>n.endsWith(".mkv")).sort();const files=[] as {p:string;t:number}[];for(const n of names.slice(0,-1)){const p=path.join(cap.folder,n);const st=await stat(p);files.push({p,t:st.mtimeMs});}const count=Math.ceil(job.seconds/2);const chosen=files.slice(-count);if(chosen.length<2)throw new Error("Buffer ainda não possui vídeo suficiente.");const list=path.join(ROOT,`${job.id}.txt`), out=path.join(ROOT,`${job.id}.mp4`);await writeFile(list,chosen.map(x=>`file '${x.p.replaceAll("'","'\\''")}'`).join("\n"));let wm:string|undefined;if(arena.watermarkUrl){try{const r=await fetch(arena.watermarkUrl);if(r.ok){wm=path.join(ROOT,`${job.id}-wm`);await writeFile(wm,Buffer.from(await r.arrayBuffer()));}}catch{}}
const args=wm?["-f","concat","-safe","0","-i",list,"-i",wm,"-filter_complex","[1:v]scale=90:-1,format=rgba,colorchannelmixer=aa=0.40[wm];[0:v][wm]overlay=W-w-16:H-h-16","-c:v","libx264","-preset","veryfast","-movflags","+faststart","-an","-y",out]:["-f","concat","-safe","0","-i",list,"-c:v","libx264","-preset","veryfast","-movflags","+faststart","-an","-y",out];await new Promise<void>((ok,bad)=>{const p=spawn("ffmpeg",args);let e="";p.stderr.on("data",x=>e=(e+x.toString()).slice(-1500));p.on("close",c=>c===0?ok():bad(new Error(e||`FFmpeg ${c}`)));});await unlink(list).catch(()=>{});if(wm)await unlink(wm).catch(()=>{});return out;}
async function work(){let state=await sync();try{const job=await api<Job|undefined>("/api/agent/jobs/next");if(!job)return;console.log(`[agent] replay solicitado: ${job.seconds}s`);const arena=state.arenas.find(a=>a.id===job.arenaId);if(!arena)throw new Error("Quadra do replay não encontrada.");const out=await makeReplay(job,arena);const body=await import("node:fs/promises").then(m=>m.readFile(out));await api(`/api/agent/jobs/${job.id}/complete`,{method:"POST",headers:{"content-type":"application/octet-stream"},body});await unlink(out).catch(()=>{});console.log("[agent] replay enviado com sucesso");}catch(e){if(String(e).startsWith("Error: 204"))return;console.error("[agent]",e instanceof Error?e.message:e);}}
await login();await sync();setInterval(()=>void work().catch(async e=>{console.error(e);try{await login()}catch{}}),2000);console.log("[agent] ER Capture Agent online. Deixe esta janela aberta.");
process.on("SIGINT",()=>{for(const x of captures.values())x.proc.kill("SIGTERM");process.exit(0)});
