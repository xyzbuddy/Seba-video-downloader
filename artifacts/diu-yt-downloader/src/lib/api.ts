import type { Platform } from "./platforms";

export interface MediaFormat {
  id: string;
  label: string;
  kind: "video" | "audio";
  size?: number;
}

export interface MediaInfo {
  platform: Platform;
  title: string;
  author?: string;
  thumbnail?: string;
  duration?: number;
  shape: "landscape" | "portrait";
  formats: MediaFormat[];
}

const API = "/api";

export interface Preview {
  platform: Platform;
  title?: string;
  author?: string;
  thumbnail?: string;
  shape: "landscape" | "portrait";
}

/** Title and thumbnail within about a second; never throws. */
export async function fetchPreview(url: string, signal?: AbortSignal): Promise<Preview | null> {
  try {
    const res = await fetch(`${API}/preview?url=${encodeURIComponent(url)}`, { signal });
    return res.ok ? ((await res.json()) as Preview) : null;
  } catch {
    return null;
  }
}

export async function fetchInfo(url: string, signal?: AbortSignal): Promise<MediaInfo> {
  let res: Response;
  try {
    res = await fetch(`${API}/info?url=${encodeURIComponent(url)}`, { signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new Error("Couldn't reach Seba. Check your internet connection and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error || "Couldn't look up this video. Try again in a minute.");
  }
  return body as MediaInfo;
}

export type DownloadEvent =
  | { state: "progress"; phase: "starting" | "downloading" | "merging" | "sending"; percent: number }
  | { state: "started" }
  | { state: "error"; message: string };

function randomToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

function hasCookie(token: string): boolean {
  return document.cookie.split(";").some((c) => c.trim() === `seba_dl=${token}`);
}

/**
 * Start a download in a hidden iframe so the page keeps its state.
 * The server sets a `seba_dl` cookie when the file starts streaming; if it
 * instead returns an error page, the iframe loads it and we read the message.
 * Returns a cancel function.
 */
export function startDownload(
  params: { url: string; format: string; title?: string },
  onEvent: (e: DownloadEvent) => void,
): () => void {
  const token = randomToken();
  const query = new URLSearchParams({ url: params.url, format: params.format, token });
  if (params.title) query.set("title", params.title.slice(0, 200));

  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;

  let finished = false;
  const finish = (e: DownloadEvent) => {
    if (finished) return;
    finished = true;
    clearInterval(poll);
    clearInterval(progressPoll);
    clearTimeout(timeout);
    document.cookie = "seba_dl=; Path=/; Max-Age=0; SameSite=Lax";
    onEvent(e);
    // Leave the frame alive for a while so the browser can hand the file over.
    setTimeout(() => frame.remove(), e.state === "started" ? 60_000 : 0);
  };

  const poll = setInterval(() => {
    if (hasCookie(token)) finish({ state: "started" });
  }, 400);

  // Server-side preparation progress (YouTube/Facebook download and merge first).
  let lastPercent = -1;
  const progressPoll = setInterval(async () => {
    if (finished) return;
    try {
      const p = await fetch(`${API}/progress?token=${token}`).then((r) => r.json());
      if (!finished && p && (p.percent !== lastPercent || p.phase === "merging")) {
        lastPercent = p.percent;
        onEvent({ state: "progress", phase: p.phase, percent: p.percent });
      }
    } catch {}
  }, 1000);

  const timeout = setTimeout(() => {
    finish({ state: "error", message: "The download took too long to start. Try a lower quality." });
  }, 30 * 60_000);

  frame.addEventListener("load", () => {
    if (hasCookie(token)) {
      finish({ state: "started" });
      return;
    }
    let message = "";
    try {
      const text = frame.contentDocument?.body?.innerText ?? "";
      message = JSON.parse(text)?.error ?? "";
    } catch {}
    finish({ state: "error", message: message || "The download couldn't start. Try again in a minute." });
  });

  frame.src = `${API}/download?${query.toString()}`;
  document.body.appendChild(frame);

  return () => {
    if (!finished) {
      finished = true;
      clearInterval(poll);
      clearInterval(progressPoll);
      clearTimeout(timeout);
      frame.remove();
    }
  };
}
