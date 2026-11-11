import type { Request, Response } from "express";
import {
  type MediaFormat,
  type MediaInfo,
  UserFacingError,
  parseMediaUrl,
  lookupInfo,
  videoTiersFromYtDlp,
  selectionArgsFor,
  downloadWithYtDlp,
  muxDownload,
  proxyDownload,
  filenameFrom,
} from "../lib/media-utils";
import { cachedLookup, forgetInfo, pickStreams, streamSelection, selectionSize } from "../lib/fast-stream";

// web_embedded returns stream URLs that can be fetched directly (other clients
// often get 403 without a PO token), which is what makes instant downloads work.
const FAST_CLIENT = ["--extractor-args", "youtube:player_client=web_embedded"];

/** yt-dlp JSON for a video, preferring the client with directly fetchable URLs. */
function lookup(id: string): Promise<any> {
  const key = canonical(id);
  return cachedLookup(key, async () => {
    try {
      return await lookupInfo(key, "web_embedded");
    } catch (err) {
      if (err instanceof UserFacingError) throw err;
      // e.g. embedding disabled for this video: use yt-dlp's default clients
      return lookupInfo(key);
    }
  });
}

/** Returns the 11-char video id, or "" if this isn't a single-video link. */
export function youtubeId(raw: string): string {
  const u = parseMediaUrl(raw);
  if (!u) return "";
  const host = u.hostname.toLowerCase();
  let id = "";
  if (host === "youtu.be" || host.endsWith(".youtu.be")) id = u.pathname.split("/")[1] || "";
  else if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
  else id = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1] || "";
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
}

function canonical(id: string) {
  return `https://www.youtube.com/watch?v=${id}`;
}

function requireId(url: string): string {
  const id = youtubeId(url);
  if (!id) {
    throw new UserFacingError(
      "That YouTube link doesn't point to a single video. Open the video and copy the link from the Share button.",
      400,
    );
  }
  return id;
}

// ── Invidious fallback (used when yt-dlp is blocked on the server) ────────────
const INVIDIOUS = [
  "https://inv.thepixora.com",
  "https://invidious.perennialte.ch",
  "https://iv.melmac.space",
  "https://invidious.privacydev.net",
  "https://yt.cdaut.de",
  "https://invidious.jing.rocks",
];

interface InvFormat { url: string; type: string; qualityLabel?: string; resolution?: string; bitrate?: number | string; clen?: string }
interface InvVideo {
  title: string;
  author: string;
  lengthSeconds: number;
  videoThumbnails: { url: string; width: number }[];
  adaptiveFormats: InvFormat[];
  formatStreams: InvFormat[];
}

async function invidious(id: string): Promise<InvVideo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    return await Promise.any(
      INVIDIOUS.map(async (base) => {
        const r = await fetch(`${base}/api/v1/videos/${id}`, { signal: controller.signal });
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as InvVideo;
        if (!data?.title) throw new Error("empty");
        return data;
      }),
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

const invHeight = (f: InvFormat) => Number((f.qualityLabel || f.resolution || "").match(/(\d+)p/)?.[1] ?? 0);
const isVideo = (f: InvFormat) => f.type?.startsWith("video/");
const isAudio = (f: InvFormat) => f.type?.startsWith("audio/");

async function oembed(id: string) {
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical(id))}&format=json`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (r.ok) return (await r.json()) as { title: string; author_name: string; thumbnail_url: string };
  } catch {}
  return null;
}

// ── info ──────────────────────────────────────────────────────────────────────
export async function getInfo(url: string): Promise<MediaInfo> {
  const id = requireId(url);
  const isShort = /\/shorts\//.test(url);

  try {
    const info = await lookup(id);
    const formats = videoTiersFromYtDlp(info.formats ?? [], true);
    // sizes from the exact streams the download will use, so the button matches the file
    for (const f of formats) f.size = selectionSize(info, f.id);
    if (formats.length) {
      const portrait = isShort || (info.width && info.height && info.height > info.width);
      return {
        platform: "youtube",
        title: info.title || "YouTube video",
        author: info.channel || info.uploader,
        thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        duration: info.duration,
        shape: portrait ? "portrait" : "landscape",
        formats,
      };
    }
  } catch (err) {
    if (err instanceof UserFacingError) throw err;
  }

  const [inv, oe] = await Promise.all([invidious(id), oembed(id)]);
  if (!inv && !oe) {
    throw new UserFacingError("Couldn't reach YouTube right now. Try again in a minute.", 502);
  }

  let formats: MediaFormat[] = [];
  if (inv) {
    const heights = new Set(
      [...inv.adaptiveFormats.filter(isVideo), ...inv.formatStreams].map(invHeight).filter((h) => h > 0),
    );
    formats = [2160, 1440, 1080, 720, 480, 360]
      .filter((h) => heights.has(h))
      .map((h) => ({ id: `v${h}`, label: h === 2160 ? "4K" : `${h}p`, kind: "video" as const }));
    if (inv.adaptiveFormats.some(isAudio)) formats.push({ id: "audio", label: "Audio only", kind: "audio" });
  }
  if (!formats.length) {
    formats = [
      { id: "v720", label: "720p", kind: "video" },
      { id: "v360", label: "360p", kind: "video" },
      { id: "audio", label: "Audio only", kind: "audio" },
    ];
  }

  return {
    platform: "youtube",
    title: inv?.title || oe?.title || "YouTube video",
    author: inv?.author || oe?.author_name,
    thumbnail: oe?.thumbnail_url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    duration: inv?.lengthSeconds ? Number(inv.lengthSeconds) : undefined,
    shape: isShort ? "portrait" : "landscape",
    formats,
  };
}

// ── download ──────────────────────────────────────────────────────────────────
export async function download(
  url: string,
  formatId: string,
  title: string | undefined,
  token: string | undefined,
  req: Request,
  res: Response,
): Promise<boolean> {
  const id = requireId(url);
  const args = selectionArgsFor(formatId);
  if (!args) throw new UserFacingError("Pick one of the listed qualities and try again.", 400);

  const audio = formatId === "audio";
  const label = audio ? "audio" : formatId === "best" ? "best" : formatId.slice(1) + "p";
  const target = {
    filename: filenameFrom(title, label, audio ? "m4a" : "mp4"),
    contentType: audio ? "audio/mp4" : "video/mp4",
    token,
  };

  // 1. Fast path: stream straight from the URLs found during lookup (starts in ~1s)
  try {
    const json = await lookup(id);
    const sel = pickStreams(json, formatId);
    // streamSelection sets the final extension and type for the chosen stream
    const fresh = () => { forgetInfo(canonical(id)); return lookup(id); };
    if (sel && (await streamSelection(sel, req, res, target, fresh))) return true;
  } catch (err) {
    if (err instanceof UserFacingError) throw err;
  }
  forgetInfo(canonical(id)); // URLs may have expired; next lookup starts fresh
  if (req.destroyed) return false;

  // 2. Slow path: yt-dlp downloads and merges to a temp file first. YouTube
  //    sometimes refuses one player client and accepts another, so try a few.
  target.filename = filenameFrom(title, label, audio ? "m4a" : "mp4");
  target.contentType = audio ? "audio/mp4" : "video/mp4";
  const clients = [FAST_CLIENT, [], ["--extractor-args", "youtube:player_client=tv"]];
  if (await downloadWithYtDlp(canonical(id), args, req, res, target, clients)) return true;

  // 2. Invidious stream URLs
  const inv = await invidious(id);
  if (!inv || req.destroyed) return false;

  const audios = inv.adaptiveFormats
    .filter((f) => isAudio(f) && f.url)
    .sort((a, b) => Number(b.bitrate ?? 0) - Number(a.bitrate ?? 0));
  const bestAudio = audios.find((a) => a.type.includes("mp4")) ?? audios[0];

  if (audio) {
    return bestAudio ? proxyDownload(bestAudio.url, {}, req, res, target) : false;
  }

  const target_h = Number(formatId.slice(1)) || 720;
  const video = inv.adaptiveFormats
    .filter((f) => isVideo(f) && f.url && invHeight(f) > 0 && invHeight(f) <= target_h)
    .sort((a, b) => invHeight(b) - invHeight(a) || Number(a.type.includes("mp4")) - Number(b.type.includes("mp4")))[0];
  if (video && bestAudio && (await muxDownload({ url: video.url }, { url: bestAudio.url }, req, res, target, 15000))) {
    return true;
  }

  const premerged = inv.formatStreams
    .filter((f) => f.url)
    .sort((a, b) => Math.abs(invHeight(a) - target_h) - Math.abs(invHeight(b) - target_h));
  for (const s of premerged) {
    if (req.destroyed) return false;
    if (await proxyDownload(s.url, {}, req, res, target)) return true;
  }
  return false;
}
