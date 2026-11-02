import "dotenv/config";

import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";

import {
  mkdir,
  readdir,
  stat,
  writeFile,
  unlink,
  readFile,
  rm,
} from "node:fs/promises";

import os from "node:os";
import path from "node:path";

const API = (process.env.API_URL ?? "").replace(/\/$/, "");
const PAIRING_CODE = process.env.PAIRING_CODE ?? "";

const ROOT = path.resolve(
  process.env.STORAGE_ROOT ?? "./storage"
);

const CREDENTIALS = path.resolve(
  process.env.AGENT_CREDENTIALS ??
    "./agent-credentials.json"
);

if (!API) {
  throw new Error(
    "Configure API_URL no apps/agent/.env"
  );
}

await mkdir(ROOT, { recursive: true });

type Camera = {
  id: string;
  arenaId: string;
  name: string;
  type: "rtsp" | "mjpeg";
  host: string;
  port: number;
  username: string;
  password?: string;
  hasPassword?: boolean;
  path: string;
  transport: "tcp" | "udp";
  active: boolean;
};

type Arena = {
  id: string;
  name: string;
  code: string;
  cameraId: string;
  watermarkUrl?: string;
};

type Job = {
  id: string;
  arenaId: string;
  cameraId: string;
  seconds: number;
};

type Capture = {
  proc: ChildProcessWithoutNullStreams;
  folder: string;
  startedAt: number;
};

const captures = new Map<string, Capture>();

const captureErrors = new Map<
  string,
  string
>();

const lastPreviewAt = new Map<
  string,
  number
>();

let token = "";

/*
=========================================
CONFIGURAÇÃO
=========================================
*/

const API_TIMEOUT_MS = 15_000;
const WORK_INTERVAL_MS = 2_000;
const STARTUP_RETRY_MS = 5_000;

let shuttingDown = false;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/*
=========================================
API
=========================================
*/

async function api<T>(
  route: string,
  init: RequestInit = {}
): Promise<T> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${API}${route}`,
      {
        ...init,

        signal: controller.signal,

        headers: {
          ...(init.body &&
          typeof init.body === "string"
            ? {
                "content-type":
                  "application/json",
              }
            : {}),

          ...(token
            ? {
                authorization:
                  `Bearer ${token}`,
              }
            : {}),

          ...(init.headers ?? {}),
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `${response.status} ${await response.text()}`
      );
    }

    return (
      response.status === 204
        ? undefined
        : await response.json()
    ) as T;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new Error(
        `Timeout da API após ${
          API_TIMEOUT_MS / 1000
        }s em ${route}`
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/*
=========================================
AUTENTICAÇÃO / PAREAMENTO
=========================================
*/

async function loadCredentials() {
  try {
    const saved = JSON.parse(
      await readFile(
        CREDENTIALS,
        "utf8"
      )
    );

    token = String(
      saved.token ?? ""
    );
  } catch {
    // Agent ainda não possui credencial.
  }
}

async function pair() {
  if (!PAIRING_CODE) {
    throw new Error(
      "Agent ainda não pareado. " +
        "Gere um código no painel Developer " +
        "e configure PAIRING_CODE uma única vez."
    );
  }

  const data = await api<{
    token: string;
    agentId: string;
  }>("/api/agent/pair", {
    method: "POST",

    body: JSON.stringify({
      code: PAIRING_CODE,
      machineName: os.hostname(),
    }),
  });

  token = data.token;

  await writeFile(
    CREDENTIALS,

    JSON.stringify(
      {
        token: data.token,
        agentId: data.agentId,
        apiUrl: API,
        pairedAt:
          new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log(
    `[agent] pareado com sucesso (${os.hostname()})`
  );
}

async function authenticate() {
  await loadCredentials();

  if (!token) {
    await pair();
  }

  console.log(
    "[agent] credencial própria carregada"
  );
}

/*
=========================================
URL DA CÂMERA
=========================================
*/

function url(c: Camera) {
  const credentials = c.username
    ? `${encodeURIComponent(
        c.username
      )}:${encodeURIComponent(
        c.password ?? ""
      )}@`
    : "";

  return `${
    c.type === "mjpeg"
      ? "http"
      : "rtsp"
  }://${credentials}${c.host}:${
    c.port
  }/${c.path.replace(/^\/+/, "")}`;
}

/*
=========================================
CAPTURA CONTÍNUA
=========================================
*/

function start(c: Camera) {
  if (captures.has(c.id)) {
    return;
  }

  const folder = path.join(
    ROOT,
    c.id,
    String(Date.now())
  );

  void mkdir(folder, {
    recursive: true,
  });

  const args = [
    "-hide_banner",
    "-loglevel",
    "warning",

    ...(c.type === "rtsp"
      ? [
          "-rtsp_transport",
          c.transport,
        ]
      : []),

    "-i",
    url(c),

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

    path.join(
      folder,
      "ip-%09d.mkv"
    ),
  ];

  const proc = spawn(
    "ffmpeg",
    args
  );

  let error = "";

  proc.stderr.on(
    "data",
    (chunk) => {
      error = (
        error + chunk.toString()
      ).slice(-1200);
    }
  );

  proc.on(
    "close",
    (code) => {
      captures.delete(c.id);

      captureErrors.set(
        c.id,
        error ||
          `FFmpeg encerrou com código ${code}`
      );

      console.error(
        `[agent] câmera ${c.name} encerrou (${code}): ${error}`
      );
    }
  );

  captures.set(c.id, {
    proc,
    folder,
    startedAt: Date.now(),
  });

  captureErrors.delete(c.id);

  console.log(
    `[agent] capturando ${c.name} (${c.host})`
  );
}

/*
=========================================
EXECUTAR FFMPEG
=========================================
*/

async function runFfmpeg(
  args: string[]
) {
  return new Promise<void>(
    (resolve, reject) => {
      const proc = spawn(
        "ffmpeg",
        args
      );

      let error = "";

      proc.stderr.on(
        "data",
        (chunk) => {
          error = (
            error +
            chunk.toString()
          ).slice(-800);
        }
      );

      proc.on(
        "close",
        (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(
              new Error(
                error ||
                  `FFmpeg ${code}`
              )
            );
          }
        }
      );
    }
  );
}

/*
=========================================
PREVIEW
=========================================
*/

async function sendPreview(
  c: Camera,
  cap: Capture
) {
  const now = Date.now();

  /*
   * Preview no máximo a cada 5 segundos.
   */
  if (
    now -
      (lastPreviewAt.get(
        c.id
      ) ?? 0) <
    5000
  ) {
    return;
  }

  /*
   * Evita tentar acessar a pasta/segmentos
   * enquanto o FFmpeg ainda está iniciando.
   */
  if (
    now - cap.startedAt <
    6000
  ) {
    return;
  }

  try {
    /*
     * Caso a pasta ainda não esteja disponível,
     * aguardamos o próximo ciclo.
     */
    const names = (
      await readdir(
        cap.folder
      ).catch(() => [])
    )
      .filter((name) =>
        name.endsWith(".mkv")
      )
      .sort();

    /*
     * Precisamos de pelo menos dois arquivos.
     *
     * O último .mkv pode estar sendo escrito
     * pelo FFmpeg neste exato momento.
     */
    if (names.length < 2) {
      return;
    }

    let selected:
      | string
      | undefined;

    /*
     * Nunca utilizamos o último segmento.
     *
     * Começamos pelo penúltimo e procuramos
     * um arquivo que já esteja estável.
     */
    for (
      const name of names
        .slice(0, -1)
        .reverse()
    ) {
      const file = path.join(
        cap.folder,
        name
      );

      const info =
        await stat(file).catch(
          () => null
        );

      if (!info) {
        continue;
      }

      if (info.size < 1024) {
        continue;
      }

      if (
        now - info.mtimeMs <
        1000
      ) {
        continue;
      }

      selected = file;

      break;
    }

    if (!selected) {
      return;
    }

    /*
     * Só marca o horário depois que realmente
     * encontramos um segmento utilizável.
     */
    lastPreviewAt.set(
      c.id,
      now
    );

    const jpg = path.join(
      ROOT,
      `preview-${c.id}.jpg`
    );

    try {
      await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",

        "-i",
        selected,

        "-frames:v",
        "1",

        "-vf",
        "scale=640:-2",

        "-q:v",
        "6",

        "-y",
        jpg,
      ]);

      const body =
        await readFile(jpg);

      await api(
        `/api/agent/cameras/${c.id}/preview`,
        {
          method: "POST",

          headers: {
            "content-type":
              "image/jpeg",
          },

          body,
        }
      );
    } finally {
      await unlink(jpg).catch(
        () => {}
      );
    }
  } catch (error) {
    console.error(
      `[agent] preview ${c.name}:`,
      error instanceof Error
        ? error.message
        : error
    );
  }
}

/*
=========================================
LIMPEZA DO BUFFER
=========================================
*/

async function cleanupBuffer(
  c: Camera,
  cap: Capture
) {
  try {
    const names = (
      await readdir(cap.folder)
    )
      .filter((name) =>
        name.endsWith(".mkv")
      )
      .sort();

    /*
     * Mantém aproximadamente 2 minutos.
     *
     * Replay máximo = 60 segundos,
     * portanto temos margem suficiente.
     */
    const removable =
      names.slice(
        0,
        Math.max(
          0,
          names.length - 61
        )
      );

    for (
      const name of removable
    ) {
      await unlink(
        path.join(
          cap.folder,
          name
        )
      ).catch(() => {});
    }
  } catch {
    // Próximo ciclo tenta novamente.
  }
}

/*
=========================================
LIMPEZA DE CAPTURAS ANTIGAS
=========================================
*/

async function cleanupOldCaptureFolders() {
  try {
    const cameraDirs =
      await readdir(ROOT, {
        withFileTypes: true,
      });

    const activeFolders =
      new Set(
        [
          ...captures.values(),
        ].map((capture) =>
          path.resolve(
            capture.folder
          )
        )
      );

    const cutoff =
      Date.now() -
      6 * 60 * 60 * 1000;

    for (
      const cameraDir of cameraDirs
    ) {
      if (
        !cameraDir.isDirectory()
      ) {
        continue;
      }

      const cameraPath =
        path.join(
          ROOT,
          cameraDir.name
        );

      const folders =
        await readdir(
          cameraPath,
          {
            withFileTypes: true,
          }
        ).catch(() => []);

      for (
        const folder of folders
      ) {
        if (
          !folder.isDirectory()
        ) {
          continue;
        }

        const full =
          path.resolve(
            cameraPath,
            folder.name
          );

        if (
          activeFolders.has(full)
        ) {
          continue;
        }

        const info =
          await stat(full).catch(
            () => null
          );

        if (
          info &&
          info.mtimeMs < cutoff
        ) {
          await rm(full, {
            recursive: true,
            force: true,
          }).catch(() => {});
        }
      }
    }
  } catch {
    // Limpeza será tentada novamente.
  }
}

/*
=========================================
HEARTBEAT
=========================================
*/

async function heartbeat(
  cams: Camera[]
) {
  const states: {
    id: string;
    running: boolean;
    bufferedSeconds: number;
    error?: string;
  }[] = [];

  for (const c of cams) {
    const cap =
      captures.get(c.id);

    let bufferedSeconds = 0;

    if (cap) {
      try {
        const names = (
          await readdir(
            cap.folder
          )
        ).filter((name) =>
          name.endsWith(".mkv")
        );

        /*
         * Ignora o último arquivo,
         * pois ainda pode estar sendo escrito.
         */
        bufferedSeconds =
          Math.min(
            90,
            Math.max(
              0,
              (names.length -
                1) *
                2
            )
          );
      } catch {
        // Buffer ainda iniciando.
      }
    }

    states.push({
      id: c.id,

      running:
        Boolean(cap),

      bufferedSeconds,

      error:
        captureErrors.get(
          c.id
        ),
    });

    if (cap) {
      void sendPreview(
        c,
        cap
      );

      void cleanupBuffer(
        c,
        cap
      );
    }
  }

  await api(
    "/api/agent/heartbeat",
    {
      method: "POST",

      body: JSON.stringify({
        cameras: states,
      }),
    }
  );
}

/*
=========================================
SINCRONIZAÇÃO
=========================================
*/

async function sync() {
  const config =
    await api<{
      cameras: Camera[];
      arenas: Arena[];
    }>("/api/agent/config");

  const cams =
    config.cameras;

  const arenas =
    config.arenas;

  const wanted =
    new Set(
      arenas
        .map(
          (arena) =>
            arena.cameraId
        )
        .filter(Boolean)
    );

  for (const c of cams) {
    if (
      c.active &&
      wanted.has(c.id)
    ) {
      start(c);
    }
  }

  for (
    const [id, capture]
    of captures
  ) {
    if (
      !wanted.has(id)
    ) {
      capture.proc.kill(
        "SIGTERM"
      );

      captures.delete(id);
    }
  }

  await heartbeat(cams);

  return {
    cams,
    arenas,
  };
}

/*
=========================================
GERAR REPLAY
=========================================
*/

async function makeReplay(
  job: Job,
  arena: Arena
) {
  const cap =
    captures.get(
      job.cameraId
    );

  if (!cap) {
    throw new Error(
      "Câmera ainda não está sendo capturada pelo Agent."
    );
  }

  const names = (
    await readdir(
      cap.folder
    )
  )
    .filter((name) =>
      name.endsWith(".mkv")
    )
    .sort();

  const files: {
    p: string;
    t: number;
  }[] = [];

  /*
   * Ignora o último segmento,
   * porque ele ainda pode estar sendo gravado.
   */
  for (
    const name of names.slice(
      0,
      -1
    )
  ) {
    const file = path.join(
      cap.folder,
      name
    );

    const info =
      await stat(file);

    files.push({
      p: file,
      t: info.mtimeMs,
    });
  }

  const count =
    Math.ceil(
      job.seconds / 2
    );

  const chosen =
    files.slice(-count);

  if (
    chosen.length < 2
  ) {
    throw new Error(
      "Buffer ainda não possui vídeo suficiente."
    );
  }

  const list = path.join(
    ROOT,
    `${job.id}.txt`
  );

  const out = path.join(
    ROOT,
    `${job.id}.mp4`
  );

  await writeFile(
    list,

    chosen
      .map(
        (item) =>
          `file '${item.p.replaceAll(
            "'",
            "'\\''"
          )}'`
      )
      .join("\n")
  );

  let watermark:
    | string
    | undefined;

  /*
   * Baixa a marca d'água configurada
   * para a arena, se existir.
   */
  if (arena.watermarkUrl) {
    try {
      const response =
        await fetch(
          arena.watermarkUrl
        );

      if (response.ok) {
        watermark =
          path.join(
            ROOT,
            `${job.id}-wm`
          );

        await writeFile(
          watermark,

          Buffer.from(
            await response.arrayBuffer()
          )
        );
      }
    } catch {
      // Replay continua mesmo sem watermark.
    }
  }

  const args = watermark
    ? [
        "-f",
        "concat",

        "-safe",
        "0",

        "-i",
        list,

        "-i",
        watermark,

        "-filter_complex",

        "[1:v]scale=90:-1,format=rgba,colorchannelmixer=aa=0.40[wm];[0:v][wm]overlay=W-w-16:H-h-16",

        "-c:v",
        "libx264",

        "-preset",
        "veryfast",

        "-movflags",
        "+faststart",

        "-an",

        "-y",
        out,
      ]
    : [
        "-f",
        "concat",

        "-safe",
        "0",

        "-i",
        list,

        "-c:v",
        "libx264",

        "-preset",
        "veryfast",

        "-movflags",
        "+faststart",

        "-an",

        "-y",
        out,
      ];

  await new Promise<void>(
    (resolve, reject) => {
      const proc = spawn(
        "ffmpeg",
        args
      );

      let error = "";

      proc.stderr.on(
        "data",
        (chunk) => {
          error = (
            error +
            chunk.toString()
          ).slice(-1500);
        }
      );

      proc.on(
        "close",
        (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(
              new Error(
                error ||
                  `FFmpeg ${code}`
              )
            );
          }
        }
      );
    }
  );

  await unlink(
    list
  ).catch(() => {});

  if (watermark) {
    await unlink(
      watermark
    ).catch(() => {});
  }

  return out;
}

/*
=========================================
PROCESSAR JOB
=========================================
*/

async function work() {
  /*
   * O sync atualiza configuração,
   * mantém as capturas e envia heartbeat.
   *
   * Este work nunca será executado
   * simultaneamente com outro work.
   */
  const state =
    await sync();

  let job:
    | Job
    | undefined;

  try {
    job =
      await api<
        Job | undefined
      >(
        "/api/agent/jobs/next"
      );

    if (!job) {
      return;
    }

    console.log(
      `[agent] replay solicitado: ${job.seconds}s`
    );

    const arena =
      state.arenas.find(
        (item) =>
          item.id ===
          job!.arenaId
      );

    if (!arena) {
      throw new Error(
        "Quadra do replay não encontrada."
      );
    }

    const out =
      await makeReplay(
        job,
        arena
      );

    const body =
      await readFile(out);

    await api(
      `/api/agent/jobs/${job.id}/complete`,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/octet-stream",
        },

        body,
      }
    );

    await unlink(
      out
    ).catch(() => {});

    console.log(
      "[agent] replay enviado com sucesso"
    );
  } catch (error) {
    /*
     * Mantido para compatibilidade
     * com respostas sem conteúdo.
     */
    if (
      String(error).startsWith(
        "Error: 204"
      )
    ) {
      return;
    }

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "[agent]",
      message
    );

    if (job) {
      await api(
        `/api/agent/jobs/${job.id}/fail`,
        {
          method: "POST",

          body: JSON.stringify({
            message,
          }),
        }
      ).catch(() => {});
    }
  }
}

/*
=========================================
INICIALIZAÇÃO RESILIENTE
=========================================
*/

async function startAgent() {
  /*
   * O Agent não deve morrer se o Windows
   * iniciar antes da internet/rede.
   */
  while (!shuttingDown) {
    try {
      await authenticate();
      break;
    } catch (error) {
      console.error(
        "[agent] falha ao iniciar:",
        error instanceof Error
          ? error.message
          : error
      );

      console.log(
        `[agent] nova tentativa em ${
          STARTUP_RETRY_MS / 1000
        }s`
      );

      await sleep(
        STARTUP_RETRY_MS
      );
    }
  }

  if (shuttingDown) {
    return;
  }

  /*
   * Tentamos a primeira sincronização,
   * mas uma falha aqui não encerra o Agent.
   */
  try {
    await sync();
  } catch (error) {
    console.error(
      "[agent] sincronização inicial:",
      error instanceof Error
        ? error.message
        : error
    );
  }

  void cleanupOldCaptureFolders();

  setInterval(
    () => {
      void cleanupOldCaptureFolders();
    },
    30 * 60 * 1000
  );

  console.log(
    "[agent] ER Capture Agent online. Deixe esta janela aberta."
  );

  /*
   * LOOP PRINCIPAL
   *
   * Não usamos setInterval para work().
   *
   * Um ciclo precisa terminar antes
   * de o próximo começar.
   */
  while (!shuttingDown) {
    try {
      await work();
    } catch (error) {
      console.error(
        "[agent] comunicação com API:",
        error instanceof Error
          ? error.message
          : error
      );
    }

    if (!shuttingDown) {
      await sleep(
        WORK_INTERVAL_MS
      );
    }
  }
}

void startAgent().catch(
  (error) => {
    console.error(
      "[agent] erro inesperado:",
      error instanceof Error
        ? error.message
        : error
    );
  }
);

/*
=========================================
ENCERRAMENTO
=========================================
*/

function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    "[agent] encerrando..."
  );

  for (
    const capture
    of captures.values()
  ) {
    capture.proc.kill(
      "SIGTERM"
    );
  }

  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

process.on(
  "SIGINT",
  shutdown
);

process.on(
  "SIGTERM",
  shutdown
);