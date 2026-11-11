import { execFile, execFileSync, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";
import https from "https";
import http from "http";
import type { Request, Response } from "express";
import ffmpegStatic from "ffmpeg-static";
import { workerLookup } from "./ytdlp-worker";

const execFileAsync = promisify(execFile);

// ── binaries ──────────────────────────────────────────────────────────────────
function which(name: string): string | null {
  try {
    const out = execFileSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8" }).trim();
    return out ? out.split(/\r?\n/)[0].trim() : null;
  } catch {
    return null;
  }
}

/** yt-dlp next to the bundle (downloaded by postinstall), else on PATH. */
export const YT_DLP: string = (() => {
  const beside = path.join(__dirname, "..", "yt-dlp" + (process.platform === "win32" ? ".exe" : ""));
  if (fs.existsSync(beside)) return beside;
  return which("yt-dlp") ?? "yt-dlp";
})();

/** ffmpeg-static when its binary was actually installed, else system ffmpeg. */
export const FFMPEG: string = (() => {
  const bundled = ffmpegStatic as unknown as string | null;
  if (bundled && fs.existsSync(bundled)) return bundled;
  return which("ffmpeg") ?? "ffmpeg";
})();

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── shared types ──────────────────────────────────────────────────────────────
export type Platform = "youtube" | "facebook" | "instagram" | "tiktok";

export interface MediaFormat {
  /** Opaque id the client sends back to /api/download */
  id: string;
  /** Short label, e.g. "1080p" or "Audio only" */
  label: string;
  /** "video" (mp4) or "audio" (m4a) */
  kind: "video" | "audio";
  /** Approximate size in bytes when known */
  size?: number;
}

export interface MediaInfo {
  platform: Platform;
  title: string;
  author?: string;
  thumbnail?: string;
  /** seconds */
  duration?: number;
  /** "landscape" for 16:9 players, "portrait" for reels/shorts */
  shape: "landscape" | "portrait";
  formats: MediaFormat[];
}

/** Facebook prefixes titles with "70K views · 1.1K reactions | ". */
export function cleanFacebookTitle(title: string): string {
  return title
    .replace(/^(?:[\d.,]+[KMB]?\s+(?:views?|reactions?|comments?|shares?)\s*(?:·|\||-)\s*)+/i, "")
    .replace(/^\|\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Thrown for problems the user can act on; message is shown as-is. */
export class UserFacingError extends Error {
  constructor(message: string, public status = 422) {
    super(message);
  }
}

// ── URL validation ────────────────────────────────────────────────────────────
const PLATFORM_DOMAINS: Record<Platform, string[]> = {
  youtube: ["youtube.com", "youtu.be"],
  facebook: ["facebook.com", "fb.watch", "fb.com"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
};

// Facebook's link-shim hosts redirect to arbitrary external sites.
const BLOCKED_HOSTS = new Set(["l.facebook.com", "lm.facebook.com"]);

/** Parse a user-supplied link into an http(s) URL, adding https:// if missing. */
export function parseMediaUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

/** Detect the platform from the URL's real hostname (not a substring match). */
export function detectPlatform(raw: string): Platform | null {
  const u = parseMediaUrl(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return null;
  for (const [platform, domains] of Object.entries(PLATFORM_DOMAINS) as [Platform, string[]][]) {
    if (domains.some((d) => host === d || host.endsWith("." + d))) return platform;
  }
  return null;
}

// ── yt-dlp ────────────────────────────────────────────────────────────────────
const YTDLP_BASE_ARGS = ["--no-playlist", "--no-warnings", "--ignore-config", "--no-cache-dir"];

export async function ytDlpJson(url: string, extraArgs: string[] = [], timeoutMs = 45000): Promise<any> {
  try {
    const { stdout } = await execFileAsync(
      YT_DLP,
      [...YTDLP_BASE_ARGS, ...extraArgs, "--dump-single-json", "--", url],
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
    );
    return JSON.parse(stdout);
  } catch (err: any) {
    throw classifyYtDlpError(`${err?.stderr || ""} ${err?.message || ""}`, err);
  }
}

function classifyYtDlpError(message: string, original: unknown): unknown {
  const text = message.toLowerCase();
  if (/private|login|sign in|log in|cookies|age-restricted|confirm your age/.test(text)) {
    return new UserFacingError("This video is private, age-restricted or needs a login, so it can't be downloaded.");
  }
  if (/unavailable|not available|removed|does not exist|404/.test(text)) {
    return new UserFacingError("This video isn't available. It may have been deleted, or the link is incomplete.");
  }
  return original;
}

/**
 * yt-dlp info JSON for a URL. Uses the warm background worker when it's
 * available (no startup cost) and the yt-dlp executable otherwise.
 * `client` picks a YouTube player client (e.g. "web_embedded").
 */
export async function lookupInfo(url: string, client: string | null = null): Promise<any> {
  try {
    const info = await workerLookup(url, client, FFMPEG);
    if (info) return info;
  } catch (err: any) {
    const classified = classifyYtDlpError(String(err?.message ?? err), null);
    if (classified) throw classified;
    // other worker errors: retry once with the executable below
  }
  return ytDlpJson(url, client ? ["--extractor-args", `youtube:player_client=${client};skip=hls`] : []);
}

// ── downloads ─────────────────────────────────────────────────────────────────
export interface DownloadTarget {
  filename: string;
  contentType: string;
  /** client token echoed back in a cookie once the file starts streaming */
  token?: string;
}

function asciiFallback(name: string): string {
  return name.replace(/[^\x20-\x7E]/g, "").replace(/["\\]/g, "").trim() || "video";
}

/** Build a safe filename from a title; keeps non-Latin scripts (e.g. Bangla). */
export function filenameFrom(title: string | undefined, suffix: string, ext: string): string {
  const base = (title || "video")
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "video";
  return `${base} (${suffix}).${ext}`;
}

/** Commit the response to a file download. Only call once data is flowing. */
export function commitDownload(res: Response, target: DownloadTarget, contentLength?: string | number) {
  const ascii = asciiFallback(target.filename);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(target.filename)}`,
  );
  res.setHeader("Content-Type", target.contentType);
  res.setHeader("Cache-Control", "no-store");
  if (contentLength) res.setHeader("Content-Length", String(contentLength));
  if (target.token) {
    res.setHeader("Set-Cookie", `seba_dl=${target.token}; Path=/; Max-Age=120; SameSite=Lax`);
  }
}

/**
 * GET a direct media URL and stream it to the client. Resolves `true` once the
 * remote server answers 2xx and streaming has begun; `false` with the response
 * untouched otherwise, so the caller can try another source.
 */
export function proxyDownload(
  url: string,
  headers: Record<string, string>,
  req: Request,
  res: Response,
  target: DownloadTarget,
  redirectsLeft = 5,
): Promise<boolean> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve(false);
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      resolve(false);
      return;
    }
    const proto = parsed.protocol === "https:" ? https : http;
    const out = proto.get(parsed, { headers: { "User-Agent": BROWSER_UA, Accept: "*/*", ...headers } }, (upstream) => {
      const status = upstream.statusCode ?? 0;
      if (status >= 300 && status < 400 && upstream.headers.location && redirectsLeft > 0) {
        upstream.resume();
        proxyDownload(new URL(upstream.headers.location, parsed).toString(), headers, req, res, target, redirectsLeft - 1)
          .then(resolve);
        return;
      }
      if (status < 200 || status >= 300 || res.headersSent) {
        upstream.resume();
        resolve(false);
        return;
      }
      commitDownload(res, target, upstream.headers["content-length"]);
      upstream.pipe(res);
      upstream.on("error", () => res.destroy());
      req.on("close", () => out.destroy());
      resolve(true);
    });
    out.setTimeout(20000, () => out.destroy());
    out.on("error", () => resolve(false));
  });
}

function ffmpegHeaderArgs(headers: Record<string, string> | undefined): string[] {
  if (!headers) return ["-user_agent", BROWSER_UA];
  const lines = Object.entries(headers)
    .filter(([k]) => !/^(accept-encoding|range)$/i.test(k))
    .map(([k, v]) => `${k}: ${v}\r\n`)
    .join("");
  return lines ? ["-headers", lines] : ["-user_agent", BROWSER_UA];
}

/**
 * Mux a separate video and audio stream into fragmented MP4 and stream it.
 * Nothing is sent until ffmpeg produces its first bytes.
 */
export function muxDownload(
  video: { url: string; headers?: Record<string, string> },
  audio: { url: string; headers?: Record<string, string> },
  req: Request,
  res: Response,
  target: DownloadTarget,
  firstByteTimeoutMs = 30000,
): Promise<boolean> {
  const ff = spawn(
    FFMPEG,
    [
      "-hide_banner", "-loglevel", "error",
      ...ffmpegHeaderArgs(video.headers), "-i", video.url,
      ...ffmpegHeaderArgs(audio.headers), "-i", audio.url,
      "-map", "0:v:0", "-map", "1:a:0",
      "-c", "copy",
      "-f", "mp4",
      "-movflags", "frag_keyframe+empty_moov",
      "pipe:1",
    ],
    { windowsHide: true },
  );

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const kill = () => {
      if (ff.exitCode === null && !ff.killed) ff.kill();
    };
    const timer = setTimeout(() => {
      kill();
      finish(false);
    }, firstByteTimeoutMs);

    ff.stderr.resume();
    ff.on("error", () => finish(false));
    ff.on("close", () => finish(false)); // no-op once streaming started

    ff.stdout.once("data", (chunk: Buffer) => {
      if (settled || res.headersSent) {
        kill();
        finish(false);
        return;
      }
      commitDownload(res, target);
      res.write(chunk);
      ff.stdout.pipe(res);
      req.on("close", kill);
      finish(true);
    });
  });
}

// ── server-side preparation progress, polled by the page ──────────────────────
export interface PrepProgress {
  phase: "starting" | "downloading" | "merging" | "sending";
  percent: number;
  updated: number;
}

const progress = new Map<string, PrepProgress>();

function setProgress(token: string | undefined, phase: PrepProgress["phase"], percent: number) {
  if (!token) return;
  progress.set(token, { phase, percent: Math.max(0, Math.min(100, Math.round(percent))), updated: Date.now() });
}

export function getProgress(token: string): PrepProgress | undefined {
  return progress.get(token);
}

setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [k, v] of progress) if (v.updated < cutoff) progress.delete(k);
}, 60_000).unref();

/**
 * Let yt-dlp download (and, if needed, merge) the selected streams into a
 * temporary folder using its fast chunked downloader, then send the finished
 * file with a real Content-Length and delete it.
 *
 * Each entry in `attempts` is a set of extra yt-dlp args (e.g. a different
 * YouTube player client); the next one is tried if the previous fails.
 * Resolves `true` once the file has started sending.
 */
export async function downloadWithYtDlp(
  url: string,
  selectionArgs: string[],
  req: Request,
  res: Response,
  target: DownloadTarget,
  attempts: string[][] = [[]],
): Promise<boolean> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "seba-"));
  const cleanup = () => fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  let clientGone = false;
  req.on("close", () => {
    clientGone = true;
  });

  try {
    setProgress(target.token, "starting", 0);
    for (const extra of attempts) {
      if (clientGone) return false;
      const ok = await runYtDlpToDir(url, [...selectionArgs, ...extra], dir, target.token, () => clientGone);
      if (!ok) {
        // clear partial files before the next attempt
        for (const f of await fs.promises.readdir(dir)) await fs.promises.rm(path.join(dir, f), { force: true });
        continue;
      }
      const file = (await fs.promises.readdir(dir)).find((f) => !/\.(part|ytdl|temp)$|\.f\d+\./.test(f));
      if (!file || clientGone || res.headersSent) return false;

      const full = path.join(dir, file);
      const { size } = await fs.promises.stat(full);
      if (size === 0) continue;
      setProgress(target.token, "sending", 100);
      commitDownload(res, target, size);
      const stream = fs.createReadStream(full);
      stream.pipe(res);
      stream.on("error", () => res.destroy());
      res.on("close", () => {
        stream.destroy();
        void cleanup();
      });
      return true;
    }
    return false;
  } finally {
    if (!res.headersSent) void cleanup();
  }
}

function runYtDlpToDir(
  url: string,
  args: string[],
  dir: string,
  token: string | undefined,
  cancelled: () => boolean,
): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpegArgs = path.isAbsolute(FFMPEG) ? ["--ffmpeg-location", FFMPEG] : [];
    const proc = spawn(
      YT_DLP,
      [
        ...YTDLP_BASE_ARGS,
        ...args,
        ...ffmpegArgs,
        "--merge-output-format", "mp4",
        "--concurrent-fragments", "4",
        "--newline",
        "--no-mtime",
        "--paths", dir,
        "--output", "media.%(ext)s",
        "--",
        url,
      ],
      { windowsHide: true },
    );

    let files = 1;
    let index = 0;
    const onLine = (line: string) => {
      const fmt = line.match(/Downloading \d+ format\(s\): (\S+)/);
      if (fmt) files = fmt[1].split("+").length;
      if (/\[download\] Destination:/.test(line)) index++;
      const pct = line.match(/\[download\]\s+([\d.]+)%/);
      if (pct) setProgress(token, "downloading", ((Math.max(index, 1) - 1 + Number(pct[1]) / 100) / files) * 100);
      if (/^\[Merger\]|^\[VideoRemuxer\]|^\[FixupM3u8\]/.test(line)) setProgress(token, "merging", 100);
    };
    let buf = "";
    const feed = (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n|\r/);
      buf = lines.pop() ?? "";
      lines.forEach(onLine);
    };
    proc.stdout.on("data", feed);
    proc.stderr.on("data", feed);

    const watchdog = setInterval(() => {
      if (cancelled() && proc.exitCode === null) proc.kill();
    }, 500);
    const timeout = setTimeout(() => proc.kill(), 30 * 60_000);

    proc.on("error", () => resolve(false));
    proc.on("close", (code) => {
      clearInterval(watchdog);
      clearTimeout(timeout);
      resolve(code === 0 && !cancelled());
    });
  });
}

// ── yt-dlp formats → our format list ─────────────────────────────────────────
const STANDARD_HEIGHTS = [2160, 1440, 1080, 720, 480, 360];
const HEIGHT_LABEL: Record<number, string> = { 2160: "4K", 1440: "1440p" };

function sizeOf(f: any): number | undefined {
  const n = f?.filesize ?? f?.filesize_approx;
  return typeof n === "number" && n > 0 ? n : undefined;
}

/** Pick standard resolution tiers that actually exist in a yt-dlp format list. */
export function videoTiersFromYtDlp(formats: any[], includeAudio: boolean): MediaFormat[] {
  const videos = formats.filter((f) => f.vcodec && f.vcodec !== "none" && typeof f.height === "number");
  const audios = formats
    .filter((f) => (!f.vcodec || f.vcodec === "none") && f.acodec && f.acodec !== "none")
    .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0));
  const bestAudio = audios.find((a) => a.ext === "m4a") ?? audios[0];

  const tiers: MediaFormat[] = [];
  for (const h of STANDARD_HEIGHTS) {
    // a tier exists if some stream is within ~10% of it (handles 1072p, 1920x1080 portrait, etc.)
    const candidates = videos.filter((f) => {
      const edge = typeof f.width === "number" ? Math.min(f.height, f.width) : f.height;
      return Math.abs(edge - h) <= h * 0.1;
    });
    if (!candidates.length) continue;
    const pick =
      candidates.find((f) => f.ext === "mp4" && f.acodec && f.acodec !== "none") ??
      candidates.find((f) => f.ext === "mp4") ??
      candidates[0];
    const muxed = pick.acodec && pick.acodec !== "none";
    const size = sizeOf(pick) !== undefined ? (sizeOf(pick)! + (muxed ? 0 : sizeOf(bestAudio) ?? 0)) : undefined;
    tiers.push({ id: `v${h}`, label: HEIGHT_LABEL[h] ?? `${h}p`, kind: "video", size });
  }

  if (!tiers.length && videos.length) {
    tiers.push({ id: "best", label: "Best available", kind: "video" });
  }
  if (includeAudio && bestAudio) {
    tiers.push({ id: "audio", label: "Audio only", kind: "audio", size: sizeOf(bestAudio) });
  }
  return tiers;
}

/**
 * yt-dlp selection args for one of our format ids. `-S res:N` prefers the
 * largest stream whose shorter side is ≤ N, so portrait videos work too.
 */
export function selectionArgsFor(formatId: string): string[] | null {
  if (formatId === "audio") return ["-f", "ba[ext=m4a]/ba"];
  if (formatId === "best") return ["-f", "bv*+ba/b", "-S", "ext:mp4:m4a"];
  const m = /^v(\d{3,4})$/.exec(formatId);
  if (!m || !STANDARD_HEIGHTS.includes(Number(m[1]))) return null;
  return ["-f", "bv*+ba/b", "-S", `res:${m[1]},ext:mp4:m4a`];
}
