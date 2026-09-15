import {
  AlertCircle,
  Activity,
  Building2,
  Camera,
  CheckCircle2,
  Copy,
  CircleStop,
  Download,
  ExternalLink,
  Grid2X2,
  Headphones,
  History,
  Image,
  LayoutDashboard,
  LogIn,
  LogOut,
  Maximize2,
  KeyRound,
  Pencil,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Save,
  Share2,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Video,
  Wifi,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { Arena, CameraSource, Replay, User } from "./types";
import erLogo from "./assets/er-logo.png";

const configuredApi = import.meta.env.VITE_API_URL?.trim().replace(/\/$/, "");
const API =
  configuredApi ??
  (import.meta.env.DEV
    ? `${location.protocol}//${location.hostname}:3333`
    : location.origin);
const pageParams = new URLSearchParams(location.search);
const arenaCode = pageParams.get("arena") ?? "QUADRA01";
const requestedCameraId = pageParams.get("camera") ?? "";
type AuthData = { token: string; user: User };

async function api(path: string, options: RequestInit = {}, token?: string) {
  let response: Response;

  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error(
      import.meta.env.DEV
        ? `Não foi possível conectar ao servidor ER Replay (${API}). Verifique se o backend está rodando na porta 3333.`
        : "Não foi possível conectar ao ER Replay. Verifique sua internet ou tente novamente em instantes.",
    );
  }

  const text = await response.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok)
    throw new Error(data.message ?? `Erro ${response.status} ao acessar o servidor.`);
  return data;
}
function Brand() {
  return (
    <div className="brand">
      <img src={erLogo} alt="ER Soluções Digitais" />
      <div>
        <strong>REPLAY</strong>
        <small>Soluções Digitais</small>
      </div>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>ER Replay • Tecnologia para seus melhores momentos</span>
      <a
        href="https://www.instagram.com/devedureichardt/"
        target="_blank"
        rel="noreferrer"
      >
        Desenvolvido por Edu Reichardt <ExternalLink />
      </a>
    </footer>
  );
}

function AuthScreen({ onAuth }: { onAuth: (data: AuthData) => void }) {
  type Mode = "login" | "register" | "forgot" | "reset";
  const resetToken = new URLSearchParams(location.search).get("reset") ?? "";
  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : "login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [developmentLink, setDevelopmentLink] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (mode === "forgot") {
        const data = await api("/api/auth/forgot-password", {
          method: "POST",
          body: JSON.stringify(values),
        });
        setNotice(data.message);
        setDevelopmentLink(data.developmentResetUrl ?? "");
      } else if (mode === "reset") {
        const data = await api("/api/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({ ...values, token: resetToken }),
        });
        setNotice(data.message);
        history.replaceState({}, "", location.pathname);
        setMode("login");
      } else {
        onAuth(
          await api(`/api/auth/${mode}`, {
            method: "POST",
            body: JSON.stringify(mode === "register" ? { ...values, arenaCode } : values),
          }),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao entrar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-pitch">
        <Brand />
        <div>
          <span className="eyebrow">
            <Sparkles size={15} /> SEUS MELHORES LANCES
          </span>
          <h1>
            Jogue. Salve.
            <br />
            <em>Reviva.</em>
          </h1>
          <p>
            Entre para registrar jogadas, assistir aos seus replays e baixar os
            melhores momentos.
          </p>
        </div>
      </section>
      <section className="auth-box">
        <div className="auth-card">
          <div className="auth-icon">
            {mode === "register" ? (
              <UserPlus />
            ) : mode === "forgot" || mode === "reset" ? (
              <KeyRound />
            ) : (
              <LogIn />
            )}
          </div>
          <h2>
            {mode === "register"
              ? "Criar sua conta"
              : mode === "forgot"
                ? "Recuperar senha"
                : mode === "reset"
                  ? "Criar nova senha"
                  : "Acesse o ER Replay"}
          </h2>
          <p>
            {mode === "register"
              ? "Seu histórico de jogadas começa aqui."
              : mode === "forgot"
                ? "Informe seu e-mail para receber o link seguro."
                : mode === "reset"
                  ? "Escolha uma senha nova com pelo menos 8 caracteres."
                  : "Entre para salvar seu próximo lance."}
          </p>
          <form onSubmit={submit}>
            {mode === "register" && (
              <label>
                Nome
                <input name="name" placeholder="Seu nome" required />
              </label>
            )}
            {mode !== "reset" && (
              <label>
                E-mail
                <input
                  name="email"
                  type="email"
                  placeholder="voce@email.com"
                  required
                />
              </label>
            )}
            {mode !== "forgot" && (
              <label>
                {mode === "reset" ? "Nova senha" : "Senha"}
                <input
                  name={mode === "reset" ? "newPassword" : "password"}
                  type="password"
                  placeholder={
                    mode === "reset"
                      ? "Mínimo de 8 caracteres"
                      : "Mínimo de 6 caracteres"
                  }
                  minLength={mode === "reset" ? 8 : 6}
                  required
                />
              </label>
            )}
            {error && <div className="form-error">{error}</div>}
            {notice && <div className="form-success">{notice}</div>}
            {developmentLink && (
              <a className="development-reset" href={developmentLink}>
                Abrir link de teste
              </a>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? "AGUARDE..."
                : mode === "register"
                  ? "CRIAR CONTA"
                  : mode === "forgot"
                    ? "ENVIAR LINK"
                    : mode === "reset"
                      ? "SALVAR NOVA SENHA"
                      : "ENTRAR"}
            </button>
          </form>
          {mode === "login" && (
            <button className="forgot-link" onClick={() => setMode("forgot")}>
              Esqueci minha senha
            </button>
          )}
          <button
            className="switch-auth"
            onClick={() => {
              setMode(
                mode === "register"
                  ? "login"
                  : mode === "login"
                    ? "register"
                    : "login",
              );
              setError("");
              setNotice("");
              setDevelopmentLink("");
            }}
          >
            {mode === "register"
              ? "Já possui conta? Entrar"
              : mode === "login"
                ? "Ainda não tem conta? Cadastre-se"
                : "Voltar para o login"}
          </button>
          <small className="demo-login">
            
          </small>
        </div>
      </section>
    </main>
  );
}

function ReplayGallery({
  replays,
  token,
  onDeleted,
  admin = false,
}: {
  replays: Replay[];
  token: string;
  onDeleted: (id: string) => void;
  admin?: boolean;
}) {
  const videoUrl = (replay: Replay) =>
    replay.url.startsWith("http") ? replay.url : `${API}${replay.url}`;
  async function deleteReplay(replay: Replay) {
    if (!confirm("Apagar este replay permanentemente?")) return;
    const response = await fetch(`${API}/api/replays/${replay.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.ok) onDeleted(replay.id);
    else alert("Não foi possível apagar o replay.");
  }
  async function shareReplay(replay: Replay) {
    const url = videoUrl(replay);
    const title = "Meu replay no ER Replay";
    const text = "Olha esse lance que salvei no ER Replay!";

    // No celular, tenta compartilhar o MP4 de verdade. Isso faz o menu nativo
    // oferecer apps instalados como WhatsApp, Instagram, Facebook e Telegram.
    if (navigator.share) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Não foi possível carregar o vídeo.");

        const blob = await response.blob();
        const file = new File([blob], replay.filename || `er-replay-${replay.id}.mp4`, {
          type: blob.type || "video/mp4",
        });

        const fileShareData: ShareData = { title, text, files: [file] };
        if (!navigator.canShare || navigator.canShare(fileShareData)) {
          await navigator.share(fileShareData);
          return;
        }
      } catch (error) {
        // AbortError = usuário fechou o menu de compartilhamento.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }

      // Se o navegador não aceitar arquivo, compartilha o link do replay.
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    // Fallback para desktop: dá acesso rápido às redes que aceitam URL.
    const encodedUrl = encodeURIComponent(url);
    const encodedText = encodeURIComponent(`${text} ${url}`);
    const choice = prompt(
      "Compartilhar replay:\n1 - WhatsApp\n2 - Facebook\n3 - X (Twitter)\n4 - Copiar link",
      "1",
    );

    if (choice === "1") {
      window.open(`https://wa.me/?text=${encodedText}`, "_blank", "noopener,noreferrer");
      return;
    }
    if (choice === "2") {
      window.open(
        `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }
    if (choice === "3") {
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodedUrl}`,
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }
    if (choice === "4") {
      try {
        await navigator.clipboard.writeText(url);
        alert("Link do replay copiado.");
      } catch {
        prompt("Copie o link do replay:", url);
      }
    }
  }
  return (
    <section className="gallery">
      <div className="section-title">
        <div>
          <span>{admin ? "GERENCIAMENTO" : "MEUS MOMENTOS"}</span>
          <h2>{admin ? "Todos os replays" : "Replays recentes"}</h2>
        </div>
        <History />
      </div>
      {!replays.length ? (
        <div className="empty">
          <Video size={34} />
          <strong>Nenhum replay salvo</strong>
          <span>Use o botão da quadra para registrar seu primeiro lance.</span>
        </div>
      ) : (
        <div className="replay-grid">
          {replays.map((r) => (
            <article key={r.id}>
              <video controls preload="metadata" src={videoUrl(r)} />
              <div>
                <div>
                  <strong>Quadra 01</strong>
                  <span>
                    {r.seconds}s •{" "}
                    {new Date(r.createdAt).toLocaleString("pt-BR")}
                  </span>
                  {r.expiresAt && (
                    <small>
                      Expira em{" "}
                      {new Date(r.expiresAt).toLocaleDateString("pt-BR")}
                    </small>
                  )}
                </div>
                <div className="replay-actions">
                  <a href={videoUrl(r)} download={r.filename}>
                    <Download size={17} />
                    Baixar
                  </a>
                  <button
                    className="share"
                    onClick={() => shareReplay(r)}
                    title="Compartilhar replay"
                  >
                    <Share2 size={17} />
                  </button>
                  <button
                    className="delete"
                    onClick={() => deleteReplay(r)}
                    title="Apagar replay"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function PlayerPage({ auth, logout }: { auth: AuthData; logout: () => void }) {
  const [arena, setArena] = useState<Arena>();
  const [targetCameraId, setTargetCameraId] = useState(requestedCameraId);
  const [replays, setReplays] = useState<Replay[]>([]);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState(
    "Aperte depois de uma jogada incrível",
  );
  const load = useCallback(async () => {
    try {
      const loadedArena = await api(`/api/arenas/${arenaCode}`);
      setArena(loadedArena);
      // A câmera-alvo fica presa à tela aberta. Trocar a câmera ativa no admin
      // não redireciona silenciosamente este botão para outra fonte.
      setTargetCameraId((current) => current || loadedArena.cameraId || "");
      setReplays(await api("/api/replays", {}, auth.token));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro ao carregar.");
    }
  }, [auth.token]);
  useEffect(() => {
    void load();
  }, [load]);
  async function save() {
    setProcessing(true);
    setMessage("Estamos preparando seu replay...");
    try {
      const request = await api(
        "/api/replays",
        {
          method: "POST",
          body: JSON.stringify({
            arenaCode,
            cameraId: targetCameraId,
            seconds: arena?.defaultSeconds ?? 30,
          }),
        },
        auth.token,
      );
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const job = await api(`/api/replay-jobs/${request.jobId}`, {}, auth.token);
        if (job.status === "failed") throw new Error(job.error || "Não foi possível gerar o replay.");
        if (job.status === "done") {
          setReplays(await api("/api/replays", {}, auth.token));
          setMessage("Replay salvo! Já está disponível abaixo.");
          return;
        }
        setMessage(job.status === "processing" ? "ER Capture Agent está gerando seu replay..." : "Solicitação enviada para a arena...");
      }
      throw new Error("O Capture Agent demorou para responder. Verifique o computador da arena.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setProcessing(false);
    }
  }
  return (
    <main>
      <header className="topbar">
        <Brand />
        <div className="user-menu">
          <span>Olá, {auth.user.name.split(" ")[0]}</span>
          <button onClick={logout}>
            <LogOut size={17} />
          </button>
        </div>
      </header>
      <section className="player-hero">
        <div className="court-badge">
          <Radio size={15} /> {arena?.name ?? "Carregando quadra..."}
        </div>
        <h1>
          Esse lance
          <br />
          <span>merece replay.</span>
        </h1>
        <p>
          Ao apertar, salvamos os últimos {arena?.defaultSeconds ?? 30} segundos
          da câmera.
        </p>
        <button
          className="big-replay"
          disabled={processing || !arena}
          onClick={save}
        >
          {processing ? <RotateCcw className="spin" /> : <Save />}
          <strong>{processing ? "PROCESSANDO" : "SALVAR JOGADA"}</strong>
          <small>
            {processing
              ? "Só mais um instante"
              : `Últimos ${arena?.defaultSeconds ?? 30} segundos`}
          </small>
        </button>
        <div className="player-message">{message}</div>
        <div className="player-features">
          <span>
            <ShieldCheck />
            Conta protegida
          </span>
          <span>
            <History />
            Disponível por {arena?.retentionDays ?? 7} dias
          </span>
          <span>
            <Download />
            Download em MP4
          </span>
        </div>
      </section>
      <ReplayGallery
        replays={replays}
        token={auth.token}
        onDeleted={(id) =>
          setReplays((current) => current.filter((item) => item.id !== id))
        }
      />
      <AccountSecurity token={auth.token} />
      <SiteFooter />
    </main>
  );
}

function CourtOverview({ token, webBase }: { token: string; webBase: string }) {
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [cameras, setCameras] = useState<CameraSource[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Arena | null>(null);
  const [notice, setNotice] = useState("");
  const [live, setLive] = useState<Record<string, {running:boolean;bufferedSeconds:number;agentOnline:boolean}>>({});
  const [previews, setPreviews] = useState<Record<string,string>>({});
  const [qrModal, setQrModal] = useState<{name:string;url:string}|null>(null);
  const [cameraModal, setCameraModal] = useState<{name:string;src:string}|null>(null);
  const load = useCallback(() => {
    void Promise.all([
      api("/api/admin/arenas", {}, token),
      api("/api/admin/cameras", {}, token),
    ]).then(async ([a, c]) => {
      setArenas(a);
      setCameras(c);
      try {
        const status = await api("/api/admin/agent-status", {}, token) as {states:{cameraId:string;running:boolean;bufferedSeconds:number;agentOnline:boolean}[]};
        setLive(Object.fromEntries(status.states.map(x => [x.cameraId, x])));
        const entries = await Promise.all((c as CameraSource[]).map(async camera => {
          try {
            const preview = await api(`/api/admin/cameras/${camera.id}/preview`, {}, token) as {dataUrl?:string}|undefined;
            return [camera.id, preview?.dataUrl ?? ""] as const;
          } catch { return [camera.id, ""] as const; }
        }));
        setPreviews(Object.fromEntries(entries));
      } catch {}
    });
  }, [token]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);
  async function addArena(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      await api(
        "/api/admin/arenas",
        { method: "POST", body: JSON.stringify(values) },
        token,
      );
      form.reset();
      setOpen(false);
      setNotice("Quadra criada. Agora cadastre uma câmera para ela.");
      load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Erro ao criar quadra.");
    }
  }
  async function editArena(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      await api(
        `/api/admin/arenas/${editing.id}`,
        { method: "PATCH", body: JSON.stringify(values) },
        token,
      );
      setEditing(null);
      setNotice("Configurações da quadra atualizadas.");
      load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Erro ao atualizar.");
    }
  }
  async function deleteArena(arena: Arena) {
    if (
      !confirm(
        `Excluir ${arena.name}? As câmeras e os replays desta quadra também serão apagados.`,
      )
    )
      return;
    const response = await fetch(`${API}/api/admin/arenas/${arena.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      setEditing(null);
      setNotice("Quadra excluída.");
      load();
    } else {
      const data = await response.json();
      setNotice(data.message ?? "Não foi possível excluir a quadra.");
    }
  }
  return (
    <section className="overview">
      <div className="overview-head">
        <div>
          <span className="eyebrow">
            <Grid2X2 size={15} /> VISÃO GERAL
          </span>
          <h2>Monitoramento das quadras</h2>
          <p>
            Acompanhe todas as fontes e acesse o QR exclusivo de cada quadra.
          </p>
        </div>
        <button onClick={() => setOpen(!open)}>
          <Plus />
          Nova quadra
        </button>
      </div>
      <div className="dashboard-stats">
        <div>
          <Grid2X2 />
          <span>
            <strong>{arenas.length}</strong>
            <small>Quadras cadastradas</small>
          </span>
        </div>
        <div>
          <Camera />
          <span>
            <strong>{cameras.length}</strong>
            <small>Fontes de vídeo</small>
          </span>
        </div>
        <div>
          <CheckCircle2 />
          <span>
            <strong>
              {cameras.filter((camera) => camera.status === "online").length}
            </strong>
            <small>Câmeras conectadas</small>
          </span>
        </div>
        <div>
          <History />
          <span>
            <strong>7 dias</strong>
            <small>Retenção automática</small>
          </span>
        </div>
      </div>
      {open && (
        <form className="arena-form" onSubmit={addArena}>
          <label>
            Nome
            <input name="name" placeholder="Ex.: Quadra 02" required />
          </label>
          <label>
            Código do QR
            <input name="code" placeholder="Ex.: QUADRA02" required />
          </label>
          <label>
            Tempo do replay
            <select name="defaultSeconds" defaultValue="30">
              <option value="15">15 segundos</option>
              <option value="30">30 segundos</option>
              <option value="45">45 segundos</option>
            </select>
          </label>
          <button className="primary">CRIAR QUADRA</button>
        </form>
      )}
      {editing && (
        <form className="arena-form edit-arena" onSubmit={editArena}>
          <label>
            Nome
            <input name="name" defaultValue={editing.name} required />
          </label>
          <label>
            Código do QR
            <input name="code" defaultValue={editing.code} required />
          </label>
          <label>
            Replay
            <select name="defaultSeconds" defaultValue={editing.defaultSeconds}>
              <option value="15">15 segundos</option>
              <option value="30">30 segundos</option>
              <option value="45">45 segundos</option>
            </select>
          </label>
          <label>
            Manter vídeos
            <select
              name="retentionDays"
              defaultValue={editing.retentionDays ?? 7}
            >
              <option value="1">1 dia</option>
              <option value="3">3 dias</option>
              <option value="7">7 dias</option>
              <option value="15">15 dias</option>
              <option value="30">30 dias</option>
            </select>
          </label>
          <div className="edit-actions">
            <button
              type="button"
              className="danger"
              onClick={() => void deleteArena(editing)}
            >
              <Trash2 /> Excluir quadra
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancelar
            </button>
            <button className="primary">SALVAR ALTERAÇÕES</button>
          </div>
        </form>
      )}
      {notice && <div className="camera-notice">{notice}</div>}
      <div className="security-grid">
        {arenas.map((arena) => {
          const camera = cameras.find((item) => item.id === arena.cameraId);
          const state = camera ? live[camera.id] : undefined;
          const preview = camera ? previews[camera.id] ?? "" : "";
          const qr = camera ? `${webBase}/?arena=${encodeURIComponent(arena.code)}&camera=${encodeURIComponent(camera.id)}` : "";
          return (
            <article key={arena.id}>
              <div className="security-feed">
                {preview ? (
                  <button type="button" className="camera-preview-button" onClick={() => setCameraModal({name: `${arena.name} • ${camera?.name ?? "Câmera"}`, src: preview})} title="Clique para ampliar a câmera"><img src={preview} alt={`Preview de ${arena.name}`} /><span><Maximize2 /> Ver câmera</span></button>
                ) : (
                  <div>
                    <Camera />
                    <span>
                      {camera
                        ? camera.type === "rtsp"
                          ? "RTSP cadastrado"
                          : "MJPEG cadastrado"
                        : "Sem câmera cadastrada"}
                    </span>
                  </div>
                )}
                <span className={`feed-status ${state?.running ? "online" : camera ? "untested" : "offline"}`}>
                  <i />
                  {state?.running ? "ONLINE • CAPTURANDO" : state?.agentOnline && camera ? "AGUARDANDO CÂMERA" : camera ? "AGENT OFFLINE" : "SEM CÂMERA"}
                </span>
              </div>
              <div className="court-row">
                <div>
                  <strong>{arena.name}</strong>
                  <small>
                    {camera?.name ?? (arena.cameraId ? "Câmera ativa não encontrada" : "Selecione uma câmera ativa")} • replay de{" "}
                    {arena.defaultSeconds}s{state?.running ? ` • buffer ${state.bufferedSeconds}s` : ""}
                  </small>
                </div>
                {qr ? <button type="button" className="mini-qr qr-button" onClick={() => setQrModal({name: arena.name, url: qr})}>
                  <QRCodeSVG value={qr} size={54} />
                  <span className="qr-tooltip">Ampliar QR {arena.name}</span>
                </button> : null}
              </div>
              <button className="edit-court" onClick={() => setEditing(arena)}>
                <Pencil />
                Editar quadra
              </button>
              {qr ? <div className="court-access-actions">
                <a href={qr} target="_blank" rel="noreferrer">Abrir acesso <ExternalLink /></a>
                <button type="button" onClick={() => { void navigator.clipboard.writeText(qr); setNotice("Link da quadra copiado."); }}><Copy /> Copiar link</button>
                <button type="button" onClick={() => setQrModal({name: arena.name, url: qr})}><Maximize2 /> QR grande</button>
                {typeof navigator.share === "function" ? <button type="button" onClick={() => void navigator.share({title:`ER Replay • ${arena.name}`,url:qr})}><Share2 /> Compartilhar</button> : null}
              </div> : <div className="camera-notice compact">Ative uma câmera para liberar QR e link desta quadra.</div>}
            </article>
          );
        })}
      </div>
      {cameraModal && <div className="camera-view-modal" role="dialog" aria-modal="true" onClick={() => setCameraModal(null)}>
        <div className="camera-view-card" onClick={e => e.stopPropagation()}>
          <button className="qr-close" onClick={() => setCameraModal(null)}><X /></button>
          <div className="camera-view-head"><span><i /> PREVIEW DA CÂMERA</span><strong>{cameraModal.name}</strong><small>Imagem atualizada automaticamente pelo ER Capture Agent</small></div>
          <img src={cameraModal.src} alt={cameraModal.name} />
        </div>
      </div>}
      {qrModal && <div className="qr-modal" role="dialog" aria-modal="true" onClick={() => setQrModal(null)}>
        <div className="qr-modal-card" onClick={e => e.stopPropagation()}>
          <button className="qr-close" onClick={() => setQrModal(null)}><X /></button>
          <span className="eyebrow">ACESSO DO JOGADOR</span>
          <h3>{qrModal.name}</h3>
          <div className="qr-large"><QRCodeSVG value={qrModal.url} size={280} /></div>
          <p>Escaneie para abrir o botão de replay desta quadra.</p>
          <button className="primary" onClick={() => { void navigator.clipboard.writeText(qrModal.url); setNotice("Link da quadra copiado."); }}><Copy /> Copiar link</button>
        </div>
      </div>}
    </section>
  );
}

function CameraManager({
  token,
  onActive,
}: {
  token: string;
  onActive: (camera: CameraSource | null, buffered?: number) => void;
}) {
  const [cameras, setCameras] = useState<CameraSource[]>([]);
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [captureBuffers, setCaptureBuffers] = useState<Record<string, number>>(
    {},
  );
  const load = useCallback(() => {
    void Promise.all([
      api("/api/admin/cameras", {}, token),
      api("/api/admin/arenas", {}, token),
    ]).then(([c, a]) => {
      setCameras(c);
      setArenas(a);
    });
  }, [token]);
  useEffect(load, [load]);
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy("add");
    setNotice("");
    const values = Object.fromEntries(new FormData(form));
    try {
      await api(
        "/api/admin/cameras",
        { method: "POST", body: JSON.stringify(values) },
        token,
      );
      form.reset();
      setOpen(false);
      setNotice("Câmera cadastrada. Agora use Testar conexão.");
      load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Erro ao cadastrar.");
    } finally {
      setBusy("");
    }
  }
  async function test(camera: CameraSource) {
    setBusy(camera.id);
    setNotice("Testando o stream RTSP...");
    try {
      const data = await api(
        `/api/admin/cameras/${camera.id}/test`,
        { method: "POST" },
        token,
      );
      setNotice(data.message);
      load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Falha no teste.");
      load();
    } finally {
      setBusy("");
    }
  }
  async function startCapture(camera: CameraSource) {
    setBusy(camera.id);
    setNotice("Abrindo o vídeo e iniciando o buffer...");
    try {
      const data = await api(
        `/api/admin/cameras/${camera.id}/start`,
        { method: "POST" },
        token,
      );
      setCaptureBuffers((current) => ({ ...current, [camera.id]: 0 }));
      onActive(null, 0);
      setNotice(data.message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Falha ao iniciar.");
    } finally {
      setBusy("");
    }
  }
  async function stopCapture(camera: CameraSource) {
    setBusy(camera.id);
    try {
      const data = await api(
        `/api/admin/cameras/${camera.id}/stop`,
        { method: "POST" },
        token,
      );
      setCaptureBuffers((current) => {
        const next = { ...current };
        delete next[camera.id];
        return next;
      });
      onActive(camera, 0);
      setNotice(data.message);
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    const activeIds = Object.keys(captureBuffers);
    if (!activeIds.length) return;
    const timer = window.setInterval(() => {
      void Promise.all(
        activeIds.map(async (id) => ({
          id,
          data: await api(`/api/admin/cameras/${id}/capture-status`, {}, token),
        })),
      ).then((results) => {
        setCaptureBuffers((current) => {
          const next = { ...current };
          for (const { id, data } of results) {
            if (data.running) next[id] = data.bufferedSeconds;
            else delete next[id];
          }
          return next;
        });
        const latest = results.at(-1);
        if (latest?.data.running)
          onActive(
            cameras.find((item) => item.id === latest.id) ?? null,
            latest.data.bufferedSeconds,
          );
        const failed = results.find((item) => !item.data.running);
        if (failed)
          setNotice(failed.data.error || "Uma captura foi interrompida.");
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [captureBuffers, token, cameras, onActive]);
  async function remove(camera: CameraSource) {
    if (!confirm(`Remover ${camera.name}?`)) return;
    setBusy(camera.id);
    const response = await fetch(`${API}/api/admin/cameras/${camera.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      setNotice("Câmera removida.");
      load();
    } else {
      setNotice("Não foi possível remover.");
    }
    setBusy("");
  }
  return (
    <section className="cameras-section">
      <div className="section-title">
        <div>
          <span>FONTES DE VÍDEO</span>
          <h2>Câmeras da arena</h2>
        </div>
        <button className="add-camera" onClick={() => setOpen(!open)}>
          <Plus />
          Adicionar câmera IP
        </button>
      </div>
      <p className="section-intro">
        Use RTSP em câmeras profissionais ou HTTP/MJPEG para testar com o
        aplicativo IP Webcam.
      </p>
      {open && (
        <form className="camera-form" onSubmit={add}>
          <label>
            Quadra
            <select name="arenaId" required>
              {arenas.map((arena) => (
                <option value={arena.id} key={arena.id}>
                  {arena.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tipo de conexão
            <select name="type" defaultValue="mjpeg">
              <option value="mjpeg">HTTP/MJPEG (IP Webcam)</option>
              <option value="rtsp">RTSP (câmera profissional)</option>
            </select>
          </label>
          <label>
            Nome da câmera
            <input name="name" placeholder="Ex.: Celular de teste" required />
          </label>
          <label>
            Endereço IP
            <input name="host" placeholder="Ex.: 192.168.0.5" required />
          </label>
          <label>
            Porta
            <input name="port" type="number" defaultValue="8080" required />
          </label>
          <label>
            Transporte
            <select name="transport" defaultValue="tcp">
              <option value="tcp">TCP (recomendado)</option>
              <option value="udp">UDP (somente RTSP)</option>
            </select>
          </label>
          <label>
            Usuário
            <input name="username" placeholder="Deixe vazio se não usa" />
          </label>
          <label>
            Senha
            <input
              name="password"
              type="password"
              placeholder="Deixe vazio se não usa"
            />
          </label>
          <label className="wide">
            Caminho do vídeo
            <input
              name="path"
              defaultValue="video"
              placeholder="IP Webcam: video"
              required
            />
            <small>
              No IP Webcam, normalmente use <b>video</b>.
            </small>
          </label>
          <div className="form-actions">
            <button type="button" onClick={() => setOpen(false)}>
              Cancelar
            </button>
            <button className="primary" disabled={busy === "add"}>
              {busy === "add" ? "SALVANDO..." : "SALVAR CÂMERA"}
            </button>
          </div>
        </form>
      )}
      {notice && <div className="camera-notice">{notice}</div>}
      <div className="camera-list">
        {cameras.map((camera) => (
          <article
            key={camera.id}
            className={camera.id in captureBuffers ? "capturing" : ""}
          >
            <div className={`camera-status ${camera.status}`}>
              <Camera />
              {camera.status === "online" ? (
                <CheckCircle2 />
              ) : camera.status === "offline" ? (
                <AlertCircle />
              ) : (
                <Wifi />
              )}
            </div>
            <div className="camera-info">
              <strong>{camera.name}</strong>
              <span>
                {`${camera.type === "mjpeg" ? "http" : "rtsp"}://${camera.host}:${camera.port}/${camera.path}`}
              </span>
              <small>
                {camera.id in captureBuffers
                  ? `CAPTURANDO • ${captureBuffers[camera.id]}s no buffer`
                  : camera.status === "online"
                    ? "Conectada"
                    : camera.status === "offline"
                      ? "Sem conexão"
                      : "Aguardando teste"}
              </small>
            </div>
            <div className="camera-buttons">
              <button
                onClick={() => test(camera)}
                disabled={busy === camera.id}
              >
                {busy === camera.id ? <RotateCcw className="spin" /> : <Wifi />}
                Testar
              </button>
              {camera.id in captureBuffers ? (
                <button className="stop-ip" onClick={() => stopCapture(camera)}>
                  <CircleStop /> Parar
                </button>
              ) : (
                <button
                  className="start-ip"
                  onClick={() => startCapture(camera)}
                >
                  <Play /> Usar no replay
                </button>
              )}
              <button
                className="remove"
                onClick={() => remove(camera)}
                title="Remover câmera"
              >
                <Trash2 />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CameraStatusPanel({ token }: { token: string }) {
  const [cameras, setCameras] = useState<CameraSource[]>([]);
  const [live, setLive] = useState<Record<string, {running:boolean;bufferedSeconds:number;agentOnline:boolean;error?:string}>>({});
  const load = useCallback(() => {
    void Promise.all([api("/api/admin/cameras", {}, token), api("/api/admin/agent-status", {}, token)]).then(([cams, status]) => {
      setCameras(cams as CameraSource[]);
      const states = (status as {states:{cameraId:string;running:boolean;bufferedSeconds:number;agentOnline:boolean;error?:string}[]}).states ?? [];
      setLive(Object.fromEntries(states.map(x => [x.cameraId, x])));
    }).catch(() => {});
  }, [token]);
  useEffect(() => { load(); const timer=setInterval(load,3000); return()=>clearInterval(timer); }, [load]);
  return <section className="camera-health">
    <div className="section-title"><div><span>DIAGNÓSTICO</span><h2>Status das câmeras</h2></div><Activity /></div>
    <div className="health-grid">{cameras.length ? cameras.map(camera => {
      const state=live[camera.id]; const online=Boolean(state?.running); const agent=Boolean(state?.agentOnline);
      return <article key={camera.id} className={online ? "online" : agent ? "untested" : "offline"}>
        <div><Camera /><i /></div><span><strong>{camera.name}</strong><small>{online ? `Capturando • buffer ${state.bufferedSeconds}s` : agent ? (state?.error ?? "Agent online • aguardando captura") : "Capture Agent offline"}</small></span>
        <em>{online ? "ONLINE" : agent ? "AGUARDANDO" : "OFFLINE"}</em>
      </article>;
    }) : <div className="empty compact"><Camera /><strong>Nenhuma câmera cadastrada</strong></div>}</div>
  </section>;
}

function BrandingSettings({ token }: { token: string }) {
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(() => {
    void api("/api/admin/arenas", {}, token).then(setArenas);
  }, []);
  useEffect(load, [load]);
  async function upload(arena: Arena, file?: File) {
    if (!file) return;
    if (file.size > 2_000_000) {
      setNotice("A imagem deve ter no máximo 2 MB.");
      return;
    }
    setBusy(arena.id);
    setNotice("");
    const image = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    try {
      const data = await api(
        `/api/admin/arenas/${arena.id}/watermark`,
        { method: "POST", body: JSON.stringify({ image }) },
        token,
      );
      setNotice(data.message);
      load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Erro no envio.");
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="branding-settings">
      <div className="section-title">
        <div>
          <span>PERSONALIZAÇÃO</span>
          <h2>Marca d'água dos replays</h2>
        </div>
        <Image />
      </div>
      <p className="section-intro">
        Envie a logo da arena ou de um patrocinador. Ela será aplicada no canto
        inferior dos próximos vídeos.
      </p>
      {notice && <div className="camera-notice">{notice}</div>}
      <div className="branding-list">
        {arenas.map((arena) => (
          <article key={arena.id}>
            <div className="brand-preview">
              {arena.watermarkUrl ? (
                <img src={arena.watermarkUrl} alt="Marca d'água" />
              ) : (
                <Image />
              )}
            </div>
            <span>
              <strong>{arena.name}</strong>
              <small>
                {arena.watermarkUrl ? "Marca configurada" : "Sem marca d'água"}
              </small>
            </span>
            <label className={busy === arena.id ? "disabled" : ""}>
              {busy === arena.id ? "ENVIANDO..." : "ESCOLHER IMAGEM"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy === arena.id}
                onChange={(event) =>
                  void upload(arena, event.target.files?.[0])
                }
              />
            </label>
          </article>
        ))}
      </div>
    </section>
  );
}

function PlatformPreferences() {
  const [preferences, setPreferences] = useState(() =>
    JSON.parse(
      localStorage.getItem("er-preferences") ??
        '{"offlineAlerts":true,"compactCards":false,"confirmDeletes":true}',
    ),
  );
  function toggle(key: string) {
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    localStorage.setItem("er-preferences", JSON.stringify(next));
  }
  return (
    <section className="preferences">
      <div className="section-title">
        <div>
          <span>EXPERIÊNCIA</span>
          <h2>Preferências do painel</h2>
        </div>
        <Settings />
      </div>
      {[
        [
          "offlineAlerts",
          "Alertas de câmera offline",
          "Destacar rapidamente falhas de conexão.",
        ],
        [
          "compactCards",
          "Visualização compacta",
          "Reduzir o tamanho dos cards no painel.",
        ],
        [
          "confirmDeletes",
          "Confirmar exclusões",
          "Solicitar confirmação antes de apagar itens.",
        ],
      ].map(([key, title, description]) => (
        <button key={key} onClick={() => toggle(key)}>
          <span>
            <strong>{title}</strong>
            <small>{description}</small>
          </span>
          <i className={preferences[key] ? "on" : ""} />
        </button>
      ))}
    </section>
  );
}

function AccountSecurity({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      const data = await api(
        "/api/auth/change-password",
        { method: "POST", body: JSON.stringify(values) },
        token,
      );
      form.reset();
      setOpen(false);
      setNotice(data.message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Erro ao trocar senha.");
    }
  }
  return (
    <section className="account-security">
      <div>
        <KeyRound />
        <span>
          <strong>Segurança da conta</strong>
          <small>Use uma senha exclusiva com pelo menos 8 caracteres.</small>
        </span>
      </div>
      <button onClick={() => setOpen(!open)}>Trocar senha</button>
      {open && (
        <form onSubmit={submit}>
          <input
            name="currentPassword"
            type="password"
            placeholder="Senha atual"
            required
          />
          <input
            name="newPassword"
            type="password"
            minLength={8}
            placeholder="Nova senha"
            required
          />
          <button className="primary">ATUALIZAR SENHA</button>
        </form>
      )}
      {notice && <p>{notice}</p>}
    </section>
  );
}

function UserManager({ token, developer = false }: { token: string; developer?: boolean }) {
  const [users, setUsers] = useState<User[]>([]);
  const [notice, setNotice] = useState("");
  const load = useCallback(() => {
    void api(developer ? "/api/developer/users" : "/api/admin/users", {}, token).then(setUsers);
  }, [token]);
  useEffect(load, [load]);
  async function remove(user: User) {
    if (!confirm(`Excluir a conta de ${user.name}?`)) return;
    const response = await fetch(`${API}${developer ? "/api/developer/users" : "/api/admin/users"}/${user.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setNotice("Usuário excluído.");
    } else {
      const data = await response.json();
      setNotice(data.message ?? "Não foi possível excluir.");
    }
  }
  return (
    <section className="users-section">
      <div className="section-title">
        <div>
          <span>ACESSOS</span>
          <h2>Usuários cadastrados</h2>
        </div>
        <Users />
      </div>
      {notice && <div className="camera-notice">{notice}</div>}
      <div className="users-table">
        <div className="users-row users-head">
          <span>Usuário</span>
          <span>Perfil</span>
          <span>Cadastro</span>
          <span>Ação</span>
        </div>
        {users.map((user) => (
          <div className="users-row" key={user.id}>
            <span>
              <i>{user.name.slice(0, 1).toUpperCase()}</i>
              <b>
                {user.name}
                <small>{user.email}</small>
              </b>
            </span>
            <span>
              <em>{user.role === "admin" ? "Administrador" : "Jogador"}</em>
            </span>
            <span>{new Date(user.createdAt).toLocaleDateString("pt-BR")}</span>
            <span>
              {user.role !== "admin" && (
                <button onClick={() => remove(user)}>
                  <Trash2 />
                  Excluir
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

type AdminSection = "dashboard" | "courts" | "users" | "settings" | "support";

function AdminPage({ auth, logout }: { auth: AuthData; logout: () => void }) {
  const [section, setSection] = useState<AdminSection>("dashboard");
  const [replays, setReplays] = useState<Replay[]>([]);
  const [webBase, setWebBase] = useState(location.origin);
  const [activeCamera, setActiveCamera] = useState<CameraSource | null>(null);
  const [buffered, setBuffered] = useState(0);

  useEffect(() => {
    void api("/api/admin/replays", {}, auth.token).then(setReplays);
    void api("/api/system/network").then((data) => setWebBase(data.webUrl));
  }, [auth.token]);

  const titles: Record<AdminSection, [string, string]> = {
    dashboard: ["Visão geral", "Acompanhe o funcionamento do ER Replay."],
    courts: [
      "Quadras e câmeras",
      "Cadastre quadras, conecte câmeras IP e gere os QR Codes.",
    ],
    users: ["Usuários", "Gerencie as contas cadastradas na plataforma."],
    settings: [
      "Configurações",
      "Proteja sua conta e prepare as integrações do sistema.",
    ],
    support: [
      "Suporte",
      "Fale diretamente com o responsável técnico do ER Replay.",
    ],
  };

  return (
    <main className="admin-shell">
      <header className="topbar">
        <Brand />
        <div className="user-menu">
          <span>
            <ShieldCheck size={16} /> {auth.user.name}
          </span>
          <button onClick={logout} title="Sair">
            <LogOut size={17} />
          </button>
        </div>
      </header>
      <nav className="admin-nav" aria-label="Navegação administrativa">
        <button
          className={section === "dashboard" ? "active" : ""}
          onClick={() => setSection("dashboard")}
        >
          <LayoutDashboard /> Início
        </button>
        <button
          className={section === "courts" ? "active" : ""}
          onClick={() => setSection("courts")}
        >
          <Grid2X2 /> Quadras
        </button>
        <button
          className={section === "users" ? "active" : ""}
          onClick={() => setSection("users")}
        >
          <Users /> Usuários
        </button>
        <button
          className={section === "settings" ? "active" : ""}
          onClick={() => setSection("settings")}
        >
          <Settings /> Configurações
        </button>
        <button
          className={section === "support" ? "active" : ""}
          onClick={() => setSection("support")}
        >
          <Headphones /> Suporte
        </button>
      </nav>
      <section className="admin-head compact">
        <div>
          <span className="eyebrow">PAINEL ADMINISTRATIVO</span>
          <h1>{titles[section][0]}</h1>
          <p>{titles[section][1]}</p>
        </div>
        <div className={`connection ${activeCamera ? "online" : ""}`}>
          <Radio size={16} />
          {activeCamera ? `${activeCamera.name} ativa` : "Aguardando câmera"}
        </div>
      </section>

      {section === "dashboard" && (
        <>
          <section className="active-source-card">
            <div>
              <Radio />
              <span>
                <small>FONTE ATIVA</small>
                <strong>
                  {activeCamera?.name ?? "Nenhuma câmera capturando"}
                </strong>
                <em>
                  {activeCamera
                    ? `${buffered}s disponíveis no buffer`
                    : "Abra Quadras para iniciar uma câmera IP"}
                </em>
              </span>
            </div>
            <button onClick={() => setSection("courts")}>
              Gerenciar câmeras
            </button>
          </section>
          <CameraStatusPanel token={auth.token} />
          <ReplayGallery
            replays={replays}
            token={auth.token}
            admin
            onDeleted={(id) =>
              setReplays((current) => current.filter((item) => item.id !== id))
            }
          />
        </>
      )}
      {section === "courts" && (
        <>
          <CourtOverview token={auth.token} webBase={webBase} />
          <CameraManager
            token={auth.token}
            onActive={(camera, value = 0) => {
              setActiveCamera(camera);
              setBuffered(value);
            }}
          />
        </>
      )}
      {section === "users" && <UserManager token={auth.token} />}
      {section === "settings" && (
        <section className="settings-page">
          <AccountSecurity token={auth.token} />
          <BrandingSettings token={auth.token} />
          <PlatformPreferences />
        </section>
      )}
      {section === "support" && (
        <section className="support-page">
          <div className="support-icon">
            <Headphones />
          </div>
          <span>SUPORTE ER SOLUÇÕES DIGITAIS</span>
          <h2>Precisa de ajuda com o sistema?</h2>
          <p>
            Entre em contato diretamente com Edu Reichardt para instalação,
            configuração de câmeras ou dúvidas sobre o ER Replay.
          </p>
          <a
            href="https://wa.me/5541991650301?text=Ol%C3%A1%20Edu%2C%20preciso%20de%20suporte%20no%20ER%20Replay"
            target="_blank"
            rel="noreferrer"
          >
            Falar pelo WhatsApp <ExternalLink />
          </a>
        </section>
      )}
      <SiteFooter />
    </main>
  );
}

type DeveloperClient = User & {
  arenas: number;
  cameras: number;
  replays: number;
  licenseExpiresAt?: string;
  licenseDays?: number;
  accessActive?: boolean;
  lastPaymentAt?: string;
};

type DeveloperData = {
  totals: {
    arenas: number;
    cameras: number;
    online: number;
    users: number;
    replays: number;
    clients?: number;
  };
  arenas: Array<
    Arena & { cameras: number; onlineCameras: number; replays: number }
  >;
};

function DeveloperPage({
  auth,
  logout,
}: {
  auth: AuthData;
  logout: () => void;
}) {
  const [data, setData] = useState<DeveloperData>();
  const [clients, setClients] = useState<DeveloperClient[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    Promise.all([
      api("/api/developer/overview", {}, auth.token),
      api("/api/developer/clients", {}, auth.token),
    ])
      .then(([overview, clientList]) => {
        setData(overview);
        setClients(clientList);
        setError("");
      })
      .catch((error) => setError(error.message));
  }, [auth.token]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setBusy("create"); setError(""); setNotice("");
    try {
      await api("/api/developer/clients", {
        method: "POST",
        body: JSON.stringify({
          name: values.name,
          email: values.email,
          password: values.password,
          licenseDays: Number(values.licenseDays || 30),
        }),
      }, auth.token);
      form.reset();
      setNotice("Conta da arena criada e acesso liberado.");
      load();
    } catch (error) { setError(error instanceof Error ? error.message : "Erro ao criar cliente."); }
    finally { setBusy(""); }
  }

  async function renew(client: DeveloperClient) {
    const answer = window.prompt("Quantos dias deseja adicionar à licença?", String(client.licenseDays ?? 30));
    if (!answer) return;
    const days = Number(answer);
    if (!Number.isFinite(days) || days < 1 || days > 365) return setError("Informe um período entre 1 e 365 dias.");
    setBusy(client.id); setError(""); setNotice("");
    try {
      await api(`/api/developer/clients/${client.id}/renew`, { method: "POST", body: JSON.stringify({ days }) }, auth.token);
      setNotice(`Pagamento de ${client.name} confirmado. Licença renovada por ${days} dias.`);
      load();
    } catch (error) { setError(error instanceof Error ? error.message : "Erro ao renovar licença."); }
    finally { setBusy(""); }
  }

  async function toggleAccess(client: DeveloperClient) {
    const active = client.accessActive === false;
    setBusy(client.id); setError(""); setNotice("");
    try {
      await api(`/api/developer/clients/${client.id}/access`, { method: "PATCH", body: JSON.stringify({ active }) }, auth.token);
      setNotice(active ? "Acesso desbloqueado." : "Acesso bloqueado manualmente.");
      load();
    } catch (error) { setError(error instanceof Error ? error.message : "Erro ao alterar acesso."); }
    finally { setBusy(""); }
  }

  async function resetClientPassword(client: DeveloperClient) {
    const password = window.prompt(`Digite a nova senha de ${client.name} (mínimo 8 caracteres):`);
    if (!password) return;
    setBusy(client.id); setError(""); setNotice("");
    try {
      await api(`/api/developer/clients/${client.id}/reset-password`, { method: "POST", body: JSON.stringify({ password }) }, auth.token);
      setNotice(`Nova senha definida para ${client.name}. Agora você pode repassá-la ao cliente.`);
    } catch (error) { setError(error instanceof Error ? error.message : "Erro ao redefinir senha."); }
    finally { setBusy(""); }
  }

  function licenseStatus(client: DeveloperClient) {
    if (client.accessActive === false) return { label: "BLOQUEADO", className: "blocked" };
    if (!client.licenseExpiresAt) return { label: "SEM VENCIMENTO", className: "legacy" };
    const ms = new Date(client.licenseExpiresAt).getTime() - Date.now();
    if (ms <= 0) return { label: "VENCIDO", className: "expired" };
    const days = Math.ceil(ms / 86400000);
    return { label: `${days} DIA${days === 1 ? "" : "S"}`, className: days <= 5 ? "warning" : "active" };
  }

  return (
    <main className="developer-shell">
      <header className="topbar">
        <Brand />
        <div className="user-menu">
          <span><ShieldCheck /> Painel do desenvolvedor</span>
          <button onClick={logout}><LogOut /></button>
        </div>
      </header>
      <section className="admin-head">
        <div>
          <span className="eyebrow">ER SOLUÇÕES DIGITAIS</span>
          <h1>Clientes e licenças</h1>
          <p>Crie acessos para arenas, acompanhe vencimentos e confirme renovações.</p>
        </div>
        <div className="connection online"><Activity /> Controle central</div>
      </section>
      {error && <div className="camera-notice dev-notice">{error}</div>}
      {notice && <div className="camera-notice dev-notice success">{notice}</div>}

      <section className="developer-stats">
        <article><Users /><span><strong>{clients.length}</strong><small>Clientes</small></span></article>
        <article><Building2 /><span><strong>{data?.totals.arenas ?? 0}</strong><small>Quadras</small></span></article>
        <article><Camera /><span><strong>{data?.totals.cameras ?? 0}</strong><small>Câmeras</small></span></article>
        <article><Activity /><span><strong>{data?.totals.online ?? 0}</strong><small>Online</small></span></article>
        <article><Video /><span><strong>{data?.totals.replays ?? 0}</strong><small>Replays</small></span></article>
      </section>

      <section className="license-manager">
        <div className="section-title">
          <div><span>NOVO CLIENTE</span><h2>Liberar acesso para uma arena</h2></div>
          <UserPlus />
        </div>
        <form className="license-create" onSubmit={createClient}>
          <label><span>Nome do responsável / arena</span><input name="name" placeholder="Arena do Centro" required /></label>
          <label><span>E-mail de acesso</span><input name="email" type="email" placeholder="arena@email.com" required /></label>
          <label><span>Senha inicial</span><input name="password" type="text" minLength={8} placeholder="Mínimo 8 caracteres" required /></label>
          <label><span>Duração inicial</span><select name="licenseDays" defaultValue="30"><option value="7">7 dias</option><option value="15">15 dias</option><option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option><option value="180">180 dias</option><option value="365">1 ano</option></select></label>
          <button disabled={busy === "create"}><Plus /> {busy === "create" ? "CRIANDO..." : "CRIAR CONTA"}</button>
        </form>
      </section>

      <section className="license-manager">
        <div className="section-title">
          <div><span>ASSINATURAS</span><h2>Acessos das arenas</h2></div>
          <KeyRound />
        </div>
        <div className="license-grid">
          {clients.map((client) => {
            const status = licenseStatus(client);
            return (
              <article className="license-card" key={client.id}>
                <div className="license-card-head">
                  <div><strong>{client.name}</strong><small>{client.email}</small></div>
                  <em className={status.className}>{status.label}</em>
                </div>
                <div className="license-info">
                  <span><Building2 /> <b>{client.arenas}</b> quadras</span>
                  <span><Camera /> <b>{client.cameras}</b> câmeras</span>
                  <span><Video /> <b>{client.replays}</b> replays</span>
                </div>
                <div className="license-dates">
                  <span><small>Vencimento</small><strong>{client.licenseExpiresAt ? new Date(client.licenseExpiresAt).toLocaleDateString("pt-BR") : "Sem limite"}</strong></span>
                  <span><small>Último pagamento</small><strong>{client.lastPaymentAt ? new Date(client.lastPaymentAt).toLocaleDateString("pt-BR") : "—"}</strong></span>
                  <span><small>Ciclo</small><strong>{client.licenseDays ? `${client.licenseDays} dias` : "Legado"}</strong></span>
                </div>
                <div className="license-actions">
                  <button className="pay" disabled={busy === client.id} onClick={() => void renew(client)}><CheckCircle2 /> CONFIRMAR PAGAMENTO</button>
                  <button disabled={busy === client.id} onClick={() => void resetClientPassword(client)}><KeyRound /> NOVA SENHA</button>
                  <button className={client.accessActive === false ? "unlock" : "block"} disabled={busy === client.id} onClick={() => void toggleAccess(client)}>{client.accessActive === false ? <Play /> : <CircleStop />} {client.accessActive === false ? "DESBLOQUEAR" : "BLOQUEAR"}</button>
                </div>
              </article>
            );
          })}
          {!clients.length && <div className="empty-license">Nenhuma conta de arena criada ainda.</div>}
        </div>
      </section>

      <section className="client-overview">
        <div className="section-title"><div><span>OPERAÇÃO</span><h2>Quadras conectadas</h2></div><Building2 /></div>
        <div className="client-grid">
          {data?.arenas.map((arena) => (
            <article key={arena.id}>
              <div className="client-title"><span><strong>{arena.name}</strong><small>{arena.code}</small></span><em className={arena.onlineCameras ? "online" : ""}>{arena.onlineCameras ? "OPERANDO" : "SEM SINAL"}</em></div>
              <div><span><Camera /> {arena.onlineCameras}/{arena.cameras} câmeras</span><span><Video /> {arena.replays} replays</span><span><History /> {arena.retentionDays} dias</span></div>
              {arena.watermarkUrl && <img src={arena.watermarkUrl} alt={`Logo ${arena.name}`} />}
            </article>
          ))}
        </div>
      </section>
      <UserManager token={auth.token} developer />
      <AccountSecurity token={auth.token} />
      <SiteFooter />
    </main>
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthData | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("er-auth") ?? "null");
    } catch {
      return null;
    }
  });
  function login(data: AuthData) {
    localStorage.setItem("er-auth", JSON.stringify(data));
    setAuth(data);
  }
  function logout() {
    localStorage.removeItem("er-auth");
    setAuth(null);
  }
  if (!auth) return <AuthScreen onAuth={login} />;
  return auth.user.role === "developer" ? (
    <DeveloperPage auth={auth} logout={logout} />
  ) : auth.user.role === "admin" ? (
    <AdminPage auth={auth} logout={logout} />
  ) : (
    <PlayerPage auth={auth} logout={logout} />
  );
}
