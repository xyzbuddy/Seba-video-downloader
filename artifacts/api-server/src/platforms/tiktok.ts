import type { Request, Response } from "express";
import {
  type MediaFormat,
  type MediaInfo,
  UserFacingError,
  lookupInfo,
  downloadWithYtDlp,
  proxyDownload,
  filenameFrom,
} from "../lib/media-utils";
import { cachedLookup, forgetInfo, directSelection, pickStreams, streamSelection } from "../lib/fast-stream";

interface TikWm {
  code: number;
  msg: string;
  data?: {
    title: string;
    cover: string;
    duration: number;
    play: string;
    wmplay: string;
    hdplay?: string;
    music?: string;
    size: number;
    wm_size: number;
    hd_size?: number;
    author?: { nickname: string; unique_id?: string };
    images?: string[];
  };
}

type TikData = NonNullable<TikWm["data"]>;

async function fetchTikwm(url: string): Promise<TikData> {
  const r = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const body = (await r.json()) as TikWm;
  if (body.code !== 0 || !body.data) throw new Error(`tikwm: ${body.msg || body.code}`);
  // TikWM sometimes returns site-relative paths
  const abs = (u?: string) => (u ? new URL(u, "https://www.tikwm.com").toString() : u);
  const d = body.data;
  return { ...d, play: abs(d.play)!, wmplay: abs(d.wmplay)!, hdplay: abs(d.hdplay), music: abs(d.music), cover: abs(d.cover)! };
}

/**
 * TikWM result, cached so clicking Download reuses the lookup instead of
 * asking TikWM again (it also rate-limits repeat requests).
 */
const tikwm = (url: string): Promise<TikData | null> => cachedLookup(`tikwm:${url}`, () => fetchTikwm(url)).catch(() => null);

/** yt-dlp fallback, also cached. */
const ytdlp = (url: string): Promise<any> => cachedLookup(`ytdlp:${url}`, () => lookupInfo(url));

export async function getInfo(url: string): Promise<MediaInfo> {
  const data = await tikwm(url);
  if (data) {
    if (data.images?.length && !data.play) {
      throw new UserFacingError("This TikTok is a photo slideshow, not a video, so there's nothing to download here.");
    }
    const formats: MediaFormat[] = [
      { id: "nowm", label: "No watermark", kind: "video", size: data.hd_size || data.size || undefined },
      { id: "wm", label: "With watermark", kind: "video", size: data.wm_size || undefined },
    ];
    if (data.music) formats.push({ id: "audio", label: "Audio only", kind: "audio" });
    return {
      platform: "tiktok",
      title: data.title?.trim() || "TikTok video",
      author: data.author?.unique_id ? `@${data.author.unique_id}` : data.author?.nickname,
      thumbnail: data.cover,
      duration: data.duration,
      shape: "portrait",
      formats,
    };
  }

  try {
    const info = await ytdlp(url);
    return {
      platform: "tiktok",
      title: info.title || info.description || "TikTok video",
      author: info.uploader ? `@${info.uploader}` : undefined,
      thumbnail: info.thumbnail,
      duration: info.duration,
      shape: "portrait",
      formats: [{ id: "best", label: "Best available", kind: "video" }],
    };
  } catch (err) {
    if (err instanceof UserFacingError) throw err;
    throw new UserFacingError("Couldn't read this TikTok. Check that the video is public and the link opens in a browser.");
  }
}

export async function download(
  url: string,
  formatId: string,
  title: string | undefined,
  token: string | undefined,
  req: Request,
  res: Response,
): Promise<boolean> {
  if (!["nowm", "wm", "audio", "best"].includes(formatId)) {
    throw new UserFacingError("Pick one of the listed options and try again.", 400);
  }
  const name = title || "TikTok video";
  const referer = { Referer: "https://www.tiktok.com/" };

  // 1. Fast path: stream straight from the cached TikWM links, in parallel chunks
  if (formatId !== "best") {
    const data = await tikwm(url);
    if (data) {
      const audio = formatId === "audio";
      const sel = audio
        ? directSelection([{ url: data.music }], "audio", "mp3")
        : formatId === "wm"
          ? directSelection([{ url: data.wmplay, headers: referer }])
          : directSelection([{ url: data.hdplay, headers: referer }, { url: data.play, headers: referer }]);
      const target = {
        filename: filenameFrom(name, audio ? "audio" : formatId === "wm" ? "watermark" : "no watermark", audio ? "mp3" : "mp4"),
        contentType: audio ? "audio/mpeg" : "video/mp4",
        token,
      };
      if (sel && (await streamSelection(sel, req, res, target))) return true;
      // links may have expired: look up again next time
      forgetInfo(`tikwm:${url}`);
      const direct = audio ? data.music : formatId === "wm" ? data.wmplay : data.hdplay || data.play;
      if (direct && !req.destroyed && (await proxyDownload(direct, audio ? {} : referer, req, res, target))) return true;
    }
  }
  if (req.destroyed) return false;

  // 2. yt-dlp: stream from its links, or let it download (slow path)
  const target = { filename: filenameFrom(name, "best", "mp4"), contentType: "video/mp4", token };
  try {
    const sel = pickStreams(await ytdlp(url), "best");
    if (sel && (await streamSelection(sel, req, res, target))) return true;
  } catch (err) {
    if (err instanceof UserFacingError) throw err;
  }
  forgetInfo(`ytdlp:${url}`);
  if (req.destroyed) return false;
  return downloadWithYtDlp(url, ["-f", "b[ext=mp4]/b"], req, res, target);
}
