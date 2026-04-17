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

  try {
    const { stdout } = await execFileAsync(
      YT_DLP,
      ["--dump-json", "--no-playlist", "--no-warnings", url],
      { timeout: 30000 }
    );

    const info = JSON.parse(stdout.trim());
    const availableHeights = new Set<number>(
      ((info.formats as any[]) || []).filter((f) => f.height).map((f) => f.height)
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

    // Deduplicate formats based on formatId just in case
    const uniqueFormats = Array.from(new Map(formats.map(item => [item.formatId, item])).values());

    res.json({
      id: info.id || "unknown",
      title: (info.title || "Video").replace(/\n/g, " ").slice(0, 120).trim(),
      thumbnail: info.thumbnail,
      channelName: info.uploader || info.channel || "YouTube",
      duration: info.duration ? Number(info.duration) : 0,
      durationFormatted: formatDuration(info.duration ? Number(info.duration) : 0),
      viewCount: info.view_count ? Number(info.view_count) : undefined,
      formats: uniqueFormats,
    });
  } catch (err) {
    req.log?.error?.({ err }, "yt-dlp YouTube info failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Failed to fetch video information. Please try again." });
  }
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

  try {
    const { stdout } = await execFileAsync(
      YT_DLP,
      ["--dump-json", "--no-playlist", "--no-warnings", url],
      { timeout: 30000 }
    );
    const info = JSON.parse(stdout.trim());
    const rawFormats = info.formats || [];

    // Filter video candidate
    const videoCandidates = rawFormats
      .filter((f: any) => f.vcodec && f.vcodec !== "none" && (f.height || 0) <= height)
      .sort((a: any, b: any) => {
        const hDiff = (b.height || 0) - (a.height || 0);
        if (hDiff !== 0) return hDiff;
        // Prefer MP4
        const aMp4 = a.ext === "mp4" ? 1 : 0;
        const bMp4 = b.ext === "mp4" ? 1 : 0;
        return bMp4 - aMp4;
      });

    const bestVideo = videoCandidates[0];

    // Filter audio candidate
    const audioCandidates = rawFormats
      .filter((f: any) => f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"))
      .sort((a: any, b: any) => {
        // Prefer m4a
        const aM4a = a.ext === "m4a" ? 1 : 0;
        const bM4a = b.ext === "m4a" ? 1 : 0;
        if (bM4a !== aM4a) return bM4a - aM4a;
        return (b.abr || 0) - (a.abr || 0);
      });

    const bestAudio = audioCandidates[0];

    if (!bestVideo?.url || !bestAudio?.url) {
      // Fallback to a single pre-merged stream
      const combo = rawFormats.find((f: any) => f.url && f.acodec !== "none" && f.vcodec !== "none" && f.ext === "mp4");
      if (combo?.url) {
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "video/mp4");

        const proto = combo.url.startsWith("https") ? https : http;
        const pr = proto.get(combo.url, { headers: { "User-Agent": "Mozilla/5.0" } }, (upstream) => {
          upstream.pipe(res);
          upstream.on("error", (e: Error) => { req.log?.error?.({ e }, "combo stream error"); });
        });
        pr.on("error", (e: Error) => { req.log?.error?.({ e }, "combo proxy error"); if (!res.headersSent) res.status(500).json({ error: "STREAM_FAILED" }); });
        req.on("close", () => pr.destroy());
        return;
      }

      res.status(500).json({ error: "NO_STREAM_URL", message: "Could not find stream URLs" });
      return;
    }

    videoUrl = bestVideo.url;
    audioUrl = bestAudio.url;
  } catch (err) {
    req.log?.error?.({ err }, "yt-dlp download-phase payload extraction failed");
    if (!res.headersSent) res.status(500).json({ error: "DOWNLOAD_FAILED", message: "Failed to resolve URLs" });
    return;
  }

  // Phase 2 — ffmpeg merges video + audio into fragmented MP4, pipes to browser
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

  ffmpegProcess.stderr.on("data", (chunk: Buffer) => {
    req.log?.info?.({ stderr: chunk.toString() }, "ffmpeg progress");
  });

  ffmpegProcess.on("error", (err: Error) => {
    req.log?.error?.({ err }, "ffmpeg spawn error");
    if (!res.headersSent) res.status(500).json({ error: "STREAM_FAILED", message: "Streaming process failed" });
  });

  ffmpegProcess.on("close", (code) => {
    if (clientGone) return;
    if (code !== 0) req.log?.error?.({ code }, "ffmpeg exited with non-zero code");
  });
});

router.get("/youtube/download-url", async (req, res) => {
  res.status(501).json({ error: "NOT_SUPPORTED", message: "Use /youtube/download instead" });
});

export default router;
