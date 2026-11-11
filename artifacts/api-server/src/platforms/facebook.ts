import type { Request, Response } from "express";
import {
  type MediaInfo,
  UserFacingError,
  lookupInfo,
  cleanFacebookTitle,
  videoTiersFromYtDlp,
  selectionArgsFor,
  downloadWithYtDlp,
  filenameFrom,
} from "../lib/media-utils";
import { cachedLookup, forgetInfo, pickStreams, streamSelection, selectionSize } from "../lib/fast-stream";

function lookup(url: string): Promise<any> {
  return cachedLookup(url, () => lookupInfo(url));
}

export async function getInfo(url: string): Promise<MediaInfo> {
  let info: any;
  try {
    info = await lookup(url);
  } catch (err) {
    if (err instanceof UserFacingError) throw err;
    throw new UserFacingError(
      "Couldn't read this Facebook video. Only public videos and reels work; check that the post isn't limited to friends or a group.",
    );
  }

  const formats = videoTiersFromYtDlp(info.formats ?? [], true);
  // sizes from the exact streams the download will use, so the button matches the file
  for (const f of formats) f.size = selectionSize(info, f.id);
  if (!formats.length) formats.push({ id: "best", label: "Best available", kind: "video" });

  const portrait = /\/reel\//.test(url) || (info.width && info.height && info.height > info.width);
  const rawTitle: string = info.title || info.description || "";
  return {
    platform: "facebook",
    // Facebook often uses the post text as the title; keep it short.
    title: cleanFacebookTitle(rawTitle).slice(0, 140) || "Facebook video",
    author: info.uploader || info.channel,
    thumbnail: info.thumbnail,
    duration: info.duration,
    shape: portrait ? "portrait" : "landscape",
    formats,
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
  const args = selectionArgsFor(formatId);
  if (!args) throw new UserFacingError("Pick one of the listed qualities and try again.", 400);
  const audio = formatId === "audio";
  const label = audio ? "audio" : formatId === "best" ? "best" : formatId.slice(1) + "p";
  const name = title || "Facebook video";

  // Fast path: stream straight from the URLs found during lookup
  try {
    const sel = pickStreams(await lookup(url), formatId);
    // streamSelection sets the final extension and type for the chosen stream
    const target = { filename: filenameFrom(name, label, "mp4"), contentType: "video/mp4", token };
    const fresh = () => { forgetInfo(url); return lookup(url); };
    if (sel && (await streamSelection(sel, req, res, target, fresh))) return true;
  } catch (err) {
    if (err instanceof UserFacingError) throw err;
  }
  forgetInfo(url);
  if (req.destroyed) return false;

  // Slow path: yt-dlp downloads and merges to a temp file first
  return downloadWithYtDlp(url, args, req, res, {
    filename: filenameFrom(name, label, audio ? "m4a" : "mp4"),
    contentType: audio ? "audio/mp4" : "video/mp4",
    token,
  });
}
