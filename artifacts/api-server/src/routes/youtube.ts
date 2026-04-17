import { Router, type IRouter } from "express";
import { execFile, execFileSync, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import https from "https";
import http from "http";
import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);
const YT_DLP = path.join(__dirname, "..", "yt-dlp");

// ── ffmpeg ────────────────────────────────────────────────────────────────────
function resolveFfmpegBin(): string {
  if (ffmpegStatic) return ffmpegStatic;
  try {
    return execFileSync("which", ["ffmpeg"], { encoding: "utf8" }).trim();
  } catch {
    return "/usr/bin/ffmpeg";
  }
}
const FFMPEG_BIN = resolveFfmpegBin();

// ── helpers ───────────────────────────────────────────────────────────────────
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function isValidYoutubeUrl(url: string): boolean {
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)/.test(url);
}

const QUALITY_HEIGHTS = [2160, 1440, 1080, 720, 480, 360];
const QUALITY_LABELS: Record<number, string> = {
  2160: "4K", 1440: "1440p", 1080: "1080p", 720: "720p", 480: "480p", 360: "360p",
};

const router: IRouter = Router();

// ── Invidious API Fallback ──────────────────────────────────────────────────
async function fetchInvidious(videoId: string): Promise<any> {
  try {
    const listReq = await fetch("https://api.invidious.io/instances.json?sort_by=health");
    if (!listReq.ok) return null;
    const list = await listReq.json();
    const urls = (list as any[])
      .filter(i => i[1].type === "https" && i[1].api)
      .map(i => i[1].uri)
      .slice(0, 10);
      
    if (urls.length === 0) return null;

    const controller = new AbortController();
    const result = await Promise.any(
      urls.map(async (url) => {
        const res = await fetch(`${url}/api/v1/videos/${videoId}?fields=videoId,title,videoThumbnails,lengthSeconds,author,viewCount,adaptiveFormats,formatStreams`, {
          signal: controller.signal
        });
        if (!res.ok) throw new Error("bad status");
        const data = (await res.json()) as any;
        if (!data.title || (!data.adaptiveFormats && !data.formatStreams)) throw new Error("missing data");
        return data; // Return full info
      })
    );
    controller.abort();
    return result;
  } catch (e) {
    return null; // All failed
  }
}

// ── GET /youtube/info ─────────────────────────────────────────────────────────
router.get("/youtube/info", async (req, res) => {
  const { url } = req.query as { url?: string };

  if (!url) {
    res.status(400).json({ error: "BAD_REQUEST", message: "URL parameter is required" });
    return;
  }
  if (!isValidYoutubeUrl(url)) {
    res.status(400).json({ error: "INVALID_URL", message: "Invalid YouTube URL" });
    return;
  }

  let title = "Video";
  let thumbnail = "";
  let channelName = "YouTube";
  let duration = 0;
  let viewCount: number | undefined;
  let rawFormats: any[] = [];
  let videoId = "";
  
  try {
    const parsedUrl = new URL(url);
    videoId = parsedUrl.searchParams.get("v") || parsedUrl.pathname.split("/").pop() || "";
  } catch {}

  try {
    // 1. Fast yt-dlp attempt (8 second timeout to avoid indefinite hanging on Datacenter blocking)
    const { stdout } = await execFileAsync(
      YT_DLP,
      [
        "--dump-json",
        "--no-playlist",
        "--extractor-args", "youtube:player_client=android",
        url
      ],
      { timeout: 8000, maxBuffer: 10 * 1024 * 1024 }
    );
    const info = JSON.parse(stdout.trim());
    title = info.title;
    thumbnail = info.thumbnail;
    channelName = info.uploader || info.channel;
    duration = info.duration ? Number(info.duration) : 0;
    viewCount = info.view_count ? Number(info.view_count) : undefined;
    rawFormats = info.formats || [];
    if (!videoId) videoId = info.id;
  } catch (err) {
    req.log?.info?.({ err: (err as any).message }, "yt-dlp fast attempt failed, falling back to Invidious API");
    // 2. Invidious Fallback
    const invData = await fetchInvidious(videoId);
    if (!invData) {
      res.status(500).json({ error: "FETCH_FAILED", message: "YouTube IP blocks prevented fetch and proxy rotation failed." });
      return;
    }
    title = invData.title;
    thumbnail = invData.videoThumbnails?.[0]?.url || "";
    channelName = invData.author;
    duration = invData.lengthSeconds;
    viewCount = invData.viewCount;
    // Map Invidious formats back to a generic structure for candidate filtering later
    const adapt = (invData.adaptiveFormats || []).map((f: any) => ({
      ext: f.type?.includes("mp4") ? "mp4" : (f.type?.includes("webm") ? "webm" : "m4a"),
      height: parseInt(f.resolution?.replace("p", "") || "0"),
      vcodec: f.type?.includes("video") || f.resolution ? "vp9" : "none", // Simple mock
      acodec: f.type?.includes("audio") ? "aac" : "none",
      url: f.url
    }));
    const preMerged = (invData.formatStreams || []).map((f: any) => ({
      ext: "mp4",
      height: parseInt(f.resolution?.replace("p", "") || "0"),
      vcodec: "avc1",
      acodec: "mp4a",
      url: f.url
    }));
    rawFormats = [...adapt, ...preMerged];
  }

  const availableHeights = new Set<number>(
    rawFormats.filter((f) => f.height).map((f) => f.height)
  );
  const maxHeight = availableHeights.size > 0 ? Math.max(...availableHeights) : 720;

  const formats = QUALITY_HEIGHTS.filter((h) => h <= maxHeight || h === 720).map((h) => ({
    formatId: `height_${h}`,
    quality: QUALITY_LABELS[h] || `${h}p`,
    resolution: `${h}p`,
    ext: "mp4",
    hasVideo: true,
    hasAudio: true,
  }));

  const uniqueFormats = Array.from(new Map(formats.map(item => [item.formatId, item])).values());

  res.json({
    id: videoId || "unknown",
    title: (title || "Video").replace(/\n/g, " ").slice(0, 120).trim(),
    thumbnail: thumbnail,
    channelName: channelName || "YouTube",
    duration: duration,
    durationFormatted: formatDuration(duration),
    viewCount: viewCount,
    formats: uniqueFormats,
  });
});

// ── GET /youtube/download ─────────────────────────────────────────────────────
router.get("/youtube/download", async (req, res) => {
  const { url, formatId, quality, title } = req.query as {
    url?: string; formatId?: string; quality?: string; title?: string;
  };

  if (!url || !formatId || !quality) {
    res.status(400).json({ error: "BAD_REQUEST", message: "url, formatId, and quality parameters are required" });
    return;
  }
  if (!isValidYoutubeUrl(url)) {
    res.status(400).json({ error: "INVALID_URL", message: "Invalid YouTube URL" });
    return;
  }

  const height = parseInt(formatId.replace("height_", ""), 10) || 720;
  const safeName = (title || "video").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 80) || "video";
  const filename = `${safeName}_${quality}.mp4`;

  let videoUrl = "";
  let audioUrl = "";
  let rawFormats: any[] = [];

  let videoId = "";
  try {
    const parsedUrl = new URL(url);
    videoId = parsedUrl.searchParams.get("v") || parsedUrl.pathname.split("/").pop() || "";
  } catch {}

  try {
    const { stdout } = await execFileAsync(
      YT_DLP,
      [
        "--dump-json",
        "--no-playlist",
        "--extractor-args", "youtube:player_client=android",
        url
      ],
      { timeout: 8000, maxBuffer: 10 * 1024 * 1024 }
    );
    rawFormats = JSON.parse(stdout.trim()).formats || [];
  } catch (err) {
    req.log?.info?.({ err: (err as any).message }, "yt-dlp extraction failed in download route, falling back");
    const invData = await fetchInvidious(videoId);
    if (!invData) {
      if (!res.headersSent) res.status(500).json({ error: "DOWNLOAD_FAILED", message: "Failed to resolve URLs (IP blocked)" });
      return;
    }
    
    // Exact mapping for audio and video picking
    const adapt = (invData.adaptiveFormats || []).map((f: any) => ({
      ext: f.type?.includes("mp4") ? "mp4" : (f.type?.includes("webm") ? "webm" : "m4a"),
      height: f.type?.includes("video") ? parseInt(f.resolution?.replace("p", "") || "0") : 0,
      vcodec: f.type?.includes("video") ? "on" : "none",
      acodec: f.type?.includes("audio") ? "on" : "none",
      url: f.url
    }));
    const preMerged = (invData.formatStreams || []).map((f: any) => ({
      ext: "mp4",
      height: parseInt(f.resolution?.replace("p", "") || "0"),
      vcodec: "on",
      acodec: "on",
      url: f.url
    }));
    rawFormats = [...adapt, ...preMerged];
  }

  // Filter video candidate
  const videoCandidates = rawFormats
    .filter((f: any) => f.vcodec && f.vcodec !== "none" && (f.height || 0) <= height)
    .sort((a: any, b: any) => {
      const hDiff = (b.height || 0) - (a.height || 0);
      if (hDiff !== 0) return hDiff;
      const aMp4 = a.ext === "mp4" ? 1 : 0;
      const bMp4 = b.ext === "mp4" ? 1 : 0;
      return bMp4 - aMp4;
    });

  let bestVideo = videoCandidates[0];

  // Filter audio candidate
  const audioCandidates = rawFormats
    .filter((f: any) => f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"))
    .sort((a: any, b: any) => {
      const aM4a = a.ext === "m4a" || a.ext === "mp4" ? 1 : 0;
      const bM4a = b.ext === "m4a" || b.ext === "mp4" ? 1 : 0;
      if (bM4a !== aM4a) return bM4a - aM4a;
      return (b.abr || 0) - (a.abr || 0);
    });

  let bestAudio = audioCandidates[0];

  if (!bestVideo?.url || !bestAudio?.url) {
    // Fallback to a single pre-merged stream if separate video/audio aren't available
    const combo = rawFormats.find((f: any) => f.url && f.acodec !== "none" && f.vcodec !== "none" && f.ext === "mp4");
    if (combo?.url) {
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "video/mp4");
      const proto = combo.url.startsWith("https") ? https : http;
      const pr = proto.get(combo.url, { headers: { "User-Agent": "Mozilla/5.0" } }, (upstream) => {
        upstream.pipe(res);
      });
      pr.on("error", (e: Error) => { if (!res.headersSent) res.status(500).json({ error: "STREAM_FAILED" }); });
      req.on("close", () => pr.destroy());
      return;
    }
    res.status(500).json({ error: "NO_STREAM_URL", message: "Could not find stream URLs" });
    return;
  }

  videoUrl = bestVideo.url;
  audioUrl = bestAudio.url;

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "video/mp4");

  req.log?.info?.({ videoUrl: videoUrl.slice(0, 80), quality }, "YouTube download: merging via ffmpeg");

  const ffmpegArgs = [
    "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "-i", videoUrl,
    "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "-i", audioUrl,
    "-c", "copy",
    "-f", "mp4",
    "-movflags", "frag_keyframe+empty_moov+faststart",
    "pipe:1",
  ];

  const ffmpegProcess = spawn(FFMPEG_BIN, ffmpegArgs);

  let clientGone = false;
  req.on("close", () => {
    clientGone = true;
    if (!ffmpegProcess.killed) ffmpegProcess.kill();
  });

  ffmpegProcess.stdout.pipe(res);
  ffmpegProcess.on("error", (err: Error) => {
    if (!res.headersSent) res.status(500).json({ error: "STREAM_FAILED", message: "Streaming process failed" });
  });
});

router.get("/youtube/download-url", async (req, res) => {
  res.status(501).json({ error: "NOT_SUPPORTED", message: "Use /youtube/download instead" });
});

export default router;
