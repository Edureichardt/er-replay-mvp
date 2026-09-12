export type Segment = {
  id: string;
  cameraId: string;
  path: string;
  durationMs: number;
  createdAt: number;
};

export type Replay = {
  id: string;
  cameraId: string;
  seconds: number;
  createdAt: string;
  filename: string;
  url: string;
};
