import { unlink } from "node:fs/promises";
import type { Replay, Segment } from "./types.js";

const MAX_BUFFER_MS = 90_000;
const buffers = new Map<string, Segment[]>();
const replays: Replay[] = [];

export async function addSegment(segment: Segment) {
  const current = buffers.get(segment.cameraId) ?? [];
  current.push(segment);

  let duration = current.reduce((total, item) => total + item.durationMs, 0);
  const expired: Segment[] = [];

  while (duration > MAX_BUFFER_MS && current.length > 1) {
    const removed = current.shift();
    if (!removed) break;
    duration -= removed.durationMs;
    expired.push(removed);
  }

  buffers.set(segment.cameraId, current);
  await Promise.all(
    expired.map((item) => unlink(item.path).catch(() => undefined)),
  );
  return { segmentCount: current.length, bufferedMs: duration };
}

export function getRecentSegments(cameraId: string, seconds: number) {
  const current = buffers.get(cameraId) ?? [];
  const selected: Segment[] = [];
  let duration = 0;

  for (let index = current.length - 1; index >= 0; index -= 1) {
    const item = current[index];
    if (!item) continue;
    selected.unshift(item);
    duration += item.durationMs;
    if (duration >= seconds * 1000) break;
  }

  return { segments: selected, durationMs: duration };
}

export function addReplay(replay: Replay) {
  replays.unshift(replay);
  if (replays.length > 50) replays.length = 50;
}

export function listReplays() {
  return replays;
}

export function bufferStatus(cameraId: string) {
  const current = buffers.get(cameraId) ?? [];
  return {
    cameraId,
    segmentCount: current.length,
    bufferedSeconds: Math.round(
      current.reduce((total, item) => total + item.durationMs, 0) / 1000,
    ),
  };
}
