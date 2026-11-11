import type { Request, Response } from "express";
import {
  type MediaInfo,
  UserFacingError,
  BROWSER_UA,
  lookupInfo,
  proxyDownload,
  filenameFrom,
} from "../lib/media-utils";
import { cachedLookup, forgetInfo, directSelection, pickStreams, streamSelection, type Selection } from "../lib/fast-stream";

interface IgVideo {
  videoUrl: string;
  /** headers needed to fetch videoUrl */
  headers: Record<string, string>;
  thumbnail?: string;
  title?: string;
  author?: string;
  duration?: number;
  /** full yt-dlp info when that source was used (may hold separate video/audio) */
  json?: any;
}

const TRACKING_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "igsh", "igshid", "ref"];

function clean(url: string): string {
  try {
    const u = new URL(url);
    TRACKING_PARAMS.forEach((k) => u.searchParams.delete(k));
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

function shortcode(url: string): string | null {
  return url.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

const unescape = (u: string) => u.replace(/\\u0026/g, "&").replace(/&amp;/g, "&").replace(/\\\//g, "/");

// ── source 1: public embed page ───────────────────────────────────────────────
async function viaEmbed(url: string): Promise<IgVideo> {
  const code = shortcode(url);
  if (!code) throw new Error("no shortcode");
  const r = await fetch(`https://www.instagram.com/p/${code}/embed/captioned/`, {
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.8", "Sec-Fetch-Dest": "iframe" },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`embed ${r.status}`);
  const html = await r.text();

  const json = html.match(/\\?"video_url\\?"\s*:\s*\\?"(https:[^"\\]*(?:\\.[^"\\]*)*)\\?"/)?.[1];
  const mp4 = html.match(/https:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/)?.[0];
  const videoUrl = json ? unescape(json) : mp4 ? unescape(mp4) : "";
  if (!videoUrl) throw new Error("no video in embed");

  const thumb =
    html.match(/class="[^"]*EmbeddedMediaImage[^"]*"[^>]*\ssrc="([^"]+)"/)?.[1] ??
    html.match(/<img[^>]*\ssrc="([^"]+)"[^>]*class="[^"]*EmbeddedMediaImage/)?.[1] ??
    html.match(/\\?"display_url\\?"\s*:\s*\\?"([^"\\]*(?:\\.[^"\\]*)*)\\?"/)?.[1];
  const caption = html.match(/<div class="Caption"[^>]*>[\s\S]*?<\/a>([\s\S]*?)<div/)?.[1]?.replace(/<[^>]+>/g, " ");
  const author = html.match(/class="[^"]*UsernameText[^"]*"[^>]*>([^<]+)</)?.[1];

  return {
    videoUrl,
    headers: { Referer: "https://www.instagram.com/" },
    thumbnail: thumb ? unescape(thumb) : undefined,
    title: caption?.replace(/\s+/g, " ").trim() || undefined,
    author: author?.trim(),
  };
}

// ── source 2: yt-dlp ──────────────────────────────────────────────────────────
async function viaYtDlp(url: string): Promise<IgVideo> {
  // the warm worker when available, so this source costs no startup time
  const info = await lookupInfo(url);
  const f = info.requested_formats?.[0] ?? info;
  if (!f?.url && !info.formats?.length) throw new Error("yt-dlp gave no url");
  return {
    json: info,
    videoUrl: f?.url ?? "",
    headers: f?.http_headers ?? {},
    thumbnail: info.thumbnail,
    title: info.description || info.title,
    author: info.uploader || info.channel,
    duration: info.duration,
  };
}

// ── source 3: SnapSave (decoded without executing its script) ─────────────────
const BASE_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/";

function toDecimal(d: string, base: number): number {
  const alphabet = BASE_CHARS.slice(0, base);
  let value = 0;
  const digits = d.split("").reverse();
  for (let i = 0; i < digits.length; i++) {
    const idx = alphabet.indexOf(digits[i]);
    if (idx === -1) return NaN;
    value += idx * Math.pow(base, i);
  }
  return value;
}

/** Decodes SnapSave's `eval(function(h,u,n,t,e,r){…}("…",u,"…",t,e,r))` payload. */
export function decodeSnapSave(js: string): string {
  const m = js.match(/\}\(\s*"([^"]*)"\s*,\s*\d+\s*,\s*"([^"]*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\d+\s*\)\s*\)/);
  if (!m) throw new Error("Unrecognised SnapSave response");
  const [, h, n, tStr, eStr] = m;
  const t = Number(tStr);
  const e = Number(eStr);
  if (e < 2 || e > BASE_CHARS.length || e >= n.length) throw new Error("Bad SnapSave parameters");
  const delimiter = n[e];
  let r = "";
  for (let i = 0; i < h.length; i++) {
    let s = "";
    while (i < h.length && h[i] !== delimiter) s += h[i++];
    for (let j = 0; j < n.length; j++) s = s.split(n[j]).join(String(j));
    const code = toDecimal(s, e) - t;
    if (Number.isNaN(code)) throw new Error("Corrupt SnapSave payload");
    r += String.fromCharCode(code);
  }
  return Buffer.from(r, "latin1").toString("utf8");
}

async function viaSnapSave(url: string): Promise<IgVideo> {
  const r = await fetch("https://snapsave.app/action.php", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://snapsave.app/",
      Origin: "https://snapsave.app",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": BROWSER_UA,
    },
    body: new URLSearchParams({ url }).toString(),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`snapsave ${r.status}`);
  const html = decodeSnapSave(await r.text());
  if (/Error:|Unable to connect/.test(html)) throw new Error("snapsave refused");
  const links: string[] = html.match(/https:\/\/d\.rapidcdn\.app\/[^\s"'<>\\]+/g) ?? [];
  const video = links.find((l) => l.includes("/v2"));
  if (!video) throw new Error("snapsave gave no video");
  return {
    videoUrl: unescape(video),
    headers: {},
    thumbnail: links.find((l) => l.includes("/thumb")),
  };
}

/**
 * The embed page and yt-dlp run at the same time; SnapSave (a third-party
 * service) joins only if neither has answered within 1.5 s. The first source
 * with a video wins, so a lookup takes as long as the fastest working source.
 */
async function resolveUncached(target: string): Promise<IgVideo> {
  let settled = false;
  const hedge = new Promise<void>((r) => setTimeout(r, 1500)).then(() => {
    if (settled) throw new Error("not needed");
    return viaSnapSave(target);
  });
  try {
    return await Promise.any([viaEmbed(target), viaYtDlp(target), hedge]);
  } catch {
    throw new UserFacingError(
      "Couldn't get this Instagram video. Only reels and video posts from public accounts work; photo posts have no video.",
    );
  } finally {
    settled = true;
  }
}

/** Cached, so clicking Download reuses the lookup's video link right away. */
function resolve(url: string): Promise<IgVideo> {
  const target = clean(url);
  const code = shortcode(target);
  if (!code) {
    throw new UserFacingError("That Instagram link isn't a post or reel. Open the reel and use Share, then Copy link.", 400);
  }
  return cachedLookup(`ig:${code}`, () => resolveUncached(target));
}

export async function getInfo(url: string): Promise<MediaInfo> {
  const ig = await resolve(url);
  return {
    platform: "instagram",
    title: ig.title?.slice(0, 140) || "Instagram reel",
    author: ig.author ? `@${ig.author.replace(/^@/, "")}` : undefined,
    thumbnail: ig.thumbnail,
    duration: ig.duration,
    shape: "portrait",
    formats: [{ id: "best", label: "Best available", kind: "video" }],
  };
}

export async function download(
  url: string,
  formatId: string,
  title: string | undefined,
  token: string | undefined,
  req: Request,
  res: Response,
): Promise<boolean> {
  if (formatId !== "best") throw new UserFacingError("Pick one of the listed options and try again.", 400);
  const ig = await resolve(url);
  const target = { filename: filenameFrom(title || "Instagram reel", "best", "mp4"), contentType: "video/mp4", token };

  // Fast path: parallel chunked fetch (and live join if yt-dlp found separate tracks)
  const sel: Selection | null =
    (ig.json ? pickStreams(ig.json, "best") : null) ?? directSelection([{ url: ig.videoUrl, headers: ig.headers }]);
  if (sel && (await streamSelection(sel, req, res, target))) return true;
  if (req.destroyed) return false;

  // Link may have expired: look it up again and send it the plain way
  const code = shortcode(clean(url));
  if (code) forgetInfo(`ig:${code}`);
  const fresh = await resolve(url);
  return proxyDownload(fresh.videoUrl, fresh.headers, req, res, target);
}
