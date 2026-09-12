import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Segment } from "./types.js";

function escapeConcatPath(value: string) {
  return value.replaceAll("'", "'\\''");
}

export async function createReplayVideo(
  segments: Segment[],
  listPath: string,
  outputPath: string,
  watermarkPath?: string,
) {
  const concatFile = segments
    .map((segment) => `file '${escapeConcatPath(path.resolve(segment.path))}'`)
    .join("\n");
  await writeFile(listPath, concatFile, "utf8");

  await new Promise<void>((resolve, reject) => {
    const watermarkArgs = watermarkPath
      ? [
          "-i",
          watermarkPath,
          "-filter_complex",
          "[1:v]scale=90:-1,format=rgba,colorchannelmixer=aa=0.40[wm];[0:v][wm]overlay=W-w-16:H-h-16",
        ]
      : [];
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      ...watermarkArgs,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "24",
      "-pix_fmt",
      "yuv420p",
      "-an",
      "-movflags",
      "+faststart",
      outputPath,
    ]);

    let error = "";
    ffmpeg.stderr.on("data", (chunk) => {
      error += chunk.toString();
    });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(error || `FFmpeg finalizou com código ${code}`)),
    );
  });
}

export async function testVideoStream(url: string, transport?: "tcp" | "udp") {
  await new Promise<void>((resolve, reject) => {
    const inputArgs = transport ? ["-rtsp_transport", transport] : [];
    const probe = spawn("ffprobe", [
      "-v",
      "error",
      ...inputArgs,
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,r_frame_rate",
      "-of",
      "json",
      url,
    ]);
    let output = "";
    let error = "";
    const timer = setTimeout(() => {
      probe.kill();
      reject(new Error("Tempo limite: a câmera não respondeu em 8 segundos."));
    }, 8_000);
    probe.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    probe.stderr.on("data", (chunk) => {
      error += chunk.toString();
    });
    probe.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    probe.on("close", (code) => {
      clearTimeout(timer);
      code === 0 && output.includes("codec_name")
        ? resolve()
        : reject(
            new Error(error.trim() || "Não foi encontrado um stream de vídeo."),
          );
    });
  });
}
