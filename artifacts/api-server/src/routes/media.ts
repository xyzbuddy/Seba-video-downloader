import { Router, type IRouter, type Request, type Response } from "express";
import { type Platform, type MediaInfo, UserFacingError, detectPlatform, parseMediaUrl, getProgress } from "../lib/media-utils";
import * as youtube from "../platforms/youtube";
import * as facebook from "../platforms/facebook";
import * as instagram from "../platforms/instagram";
import * as tiktok from "../platforms/tiktok";
import { getPreview } from "../platforms/preview";

type Handler = {
  getInfo(url: string): Promise<MediaInfo>;
  download(url: string, formatId: string, title: string | undefined, token: string | undefined, req: Request, res: Response): Promise<boolean>;
};

const HANDLERS: Record<Platform, Handler> = { youtube, facebook, instagram, tiktok };

const UNSUPPORTED =
  "That link isn't from YouTube, Facebook, Instagram or TikTok. Copy the link from the video's Share button and paste it again.";

function readUrl(req: Request): { url: string; platform: Platform } {
  const raw = typeof req.query.url === "string" ? req.query.url : "";
  if (!raw.trim()) throw new UserFacingError("Paste a video link first.", 400);
  const platform = detectPlatform(raw);
  if (!platform) throw new UserFacingError(UNSUPPORTED, 400);
  return { url: parseMediaUrl(raw)!.toString(), platform };
}

function sendError(req: Request, res: Response, err: unknown) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (err instanceof UserFacingError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  req.log?.error?.({ err }, "unexpected media error");
  res.status(500).json({ error: "Something went wrong on our side. Try again in a minute." });
}

const router: IRouter = Router();

// GET /api/info?url=
router.get("/info", async (req, res) => {
  try {
    const { url, platform } = readUrl(req);
    const info = await HANDLERS[platform].getInfo(url);
    res.setHeader("Cache-Control", "no-store");
    res.json(info);
  } catch (err) {
    sendError(req, res, err);
  }
});

// GET /api/preview?url= — title and thumbnail within about a second
router.get("/preview", async (req, res) => {
  try {
    const { url, platform } = readUrl(req);
    res.setHeader("Cache-Control", "no-store");
    res.json(await getPreview(platform, url));
  } catch (err) {
    sendError(req, res, err);
  }
});

// GET /api/progress?token= — how far the server is with preparing a download
router.get("/progress", (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  res.setHeader("Cache-Control", "no-store");
  res.json(/^[a-z0-9]{8,32}$/i.test(token) ? getProgress(token) ?? null : null);
});

// GET /api/download?url=&format=&title=&token=
router.get("/download", async (req, res) => {
  try {
    const { url, platform } = readUrl(req);
    const format = typeof req.query.format === "string" ? req.query.format : "";
    if (!/^[a-z0-9]{1,12}$/.test(format)) throw new UserFacingError("Pick a quality first.", 400);
    const title = typeof req.query.title === "string" ? req.query.title.slice(0, 200) : undefined;
    const token = typeof req.query.token === "string" && /^[a-z0-9]{8,32}$/i.test(req.query.token)
      ? req.query.token
      : undefined;

    let closed = false;
    req.on("close", () => { closed = true; });

    const started = await HANDLERS[platform].download(url, format, title, token, req, res);
    if (!started && !closed && !res.headersSent) {
      throw new UserFacingError(
        "The video was found, but the file couldn't be fetched. Try a lower quality, or try again in a minute.",
        502,
      );
    }
  } catch (err) {
    sendError(req, res, err);
  }
});

export default router;
