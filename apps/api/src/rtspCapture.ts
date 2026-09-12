import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CameraSource } from "./database.js";
import { addSegment, bufferStatus } from "./store.js";

type Capture = {
  process: ChildProcessWithoutNullStreams;
  timer?: NodeJS.Timeout;
  files: Set<string>;
  startedAt: string;
  error?: string;
};
const captures = new Map<string, Capture>();

function streamUrl(camera: CameraSource) {
  const credentials = camera.username
    ? `${encodeURIComponent(camera.username)}:${encodeURIComponent(camera.password)}@`
    : "";
  const protocol = camera.type === "mjpeg" ? "http" : "rtsp";
  return `${protocol}://${credentials}${camera.host}:${camera.port}/${camera.path}`;
}

export async function startRtspCapture(
  camera: CameraSource,
  segmentsRoot: string,
) {
  stopRtspCapture(camera.id);
  const folder = path.join(segmentsRoot, camera.id, String(Date.now()));
  await mkdir(folder, { recursive: true });
  const files = new Set<string>();
  const inputArgs =
    camera.type === "rtsp" ? ["-rtsp_transport", camera.transport] : [];
  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "warning",
    ...inputArgs,
    "-i",
    streamUrl(camera),
    "-map",
    "0:v:0",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-g",
    "30",
    "-f",
    "segment",
    "-segment_time",
    "2",
    "-reset_timestamps",
    "1",
    "-segment_format",
    "matroska",
    path.join(folder, "ip-%09d.mkv"),
  ]);
  const capture: Capture = {
    process: ffmpeg,
    files,
    startedAt: new Date().toISOString(),
  };
  captures.set(camera.id, capture);
  let stderr = "";
  ffmpeg.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-1500);
  });
  ffmpeg.on("error", (error) => {
    capture.error = error.message;
  });
  ffmpeg.on("close", (code) => {
    if (code && code !== 255)
      capture.error = stderr.trim() || `FFmpeg encerrou com código ${code}`;
  });
  capture.timer = setInterval(async () => {
    try {
      const names = (await readdir(folder))
        .filter((name) => name.endsWith(".mkv"))
        .sort();
      for (const name of names.slice(0, -1)) {
        const fullPath = path.join(folder, name);
        if (files.has(fullPath)) continue;
        const info = await stat(fullPath);
        if (info.size < 1000) continue;
        files.add(fullPath);
        await addSegment({
          id: randomUUID(),
          cameraId: camera.id,
          path: fullPath,
          durationMs: 2_000,
          createdAt: info.mtimeMs,
        });
      }
    } catch {
      /* próxima leitura tentará novamente */
    }
  }, 1_000);
  return captureStatus(camera.id);
}

export function stopRtspCapture(cameraId: string) {
  const capture = captures.get(cameraId);
  if (!capture) return;
  if (capture.timer) clearInterval(capture.timer);
  capture.process.kill("SIGTERM");
  captures.delete(cameraId);
}
export function stopAllRtspCaptures(exceptId?: string) {
  for (const id of captures.keys()) if (id !== exceptId) stopRtspCapture(id);
}
export function captureStatus(cameraId: string) {
  const capture = captures.get(cameraId);
  return {
    running: Boolean(capture) && !capture?.error,
    startedAt: capture?.startedAt,
    error: capture?.error,
    ...bufferStatus(cameraId),
  };
}
