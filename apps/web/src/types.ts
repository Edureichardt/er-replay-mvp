export type Replay = {
  id: string;
  cameraId: string;
  seconds: number;
  createdAt: string;
  expiresAt?: string;
  filename: string;
  url: string;
  userId?: string;
  arenaId?: string;
  cloudPublicId?: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: "developer" | "admin" | "player";
  createdAt: string;
  licenseExpiresAt?: string;
  licenseDays?: number;
  accessActive?: boolean;
  lastPaymentAt?: string;
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
export type CameraSource = {
  id: string;
  arenaId: string;
  name: string;
  type: "rtsp" | "mjpeg";
  host: string;
  port: number;
  username: string;
  path: string;
  transport: "tcp" | "udp";
  active: boolean;
  status: "untested" | "online" | "offline";
  lastTestedAt?: string;
  lastError?: string;
  hasPassword?: boolean;
};
