import { Router, type IRouter } from "express";
import { execFile, execFileSync, spawn } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

// Use the bundled yt-dlp binary (artifacts/api-server/yt-dlp)
const YT_DLP = path.join(process.cwd(), "yt-dlp");

// Resolve ffmpeg dynamically — Nix store hashes change across system updates
function resolveFfmpegBin(): string {
  try {
    return execFileSync("which", ["ffmpeg"], { encoding: "utf8" }).trim();
  } catch {
    // Fallback to known Replit runtime path
    return "/nix/store/hm5p1jkyrqp2jinklggxv8q7qg1glf03-replit-runtime-path/bin/ffmpeg";
  }
}
const FFMPEG_BIN = resolveFfmpegBin();

const router: IRouter = Router();

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function isValidYoutubeUrl(url: string): boolean {
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)/.test(url);
}

const QUALITY_HEIGHTS = [2160, 1440, 1080, 720, 480, 360];
const QUALITY_LABELS: Record<number, string> = {
  2160: "4K",
  1440: "1440p",
  1080: "1080p",
  720: "720p",
  480: "480p",
  360: "360p",
};

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
      ["--dump-json", "--no-playlist", url],
      { timeout: 60000 }
    );

    const info = JSON.parse(stdout);

    type RawFormat = {
      height?: number;
      vcodec?: string;
      acodec?: string;
      filesize?: number;
      filesize_approx?: number;
    };
    const allRawFormats = (info.formats || []) as RawFormat[];

    // Collect unique heights from video-capable formats
    const availableHeights = new Set<number>();
    for (const fmt of allRawFormats) {
      if (fmt.height && fmt.vcodec && fmt.vcodec !== "none") {
        availableHeights.add(fmt.height);
      }
    }

    const maxHeight = availableHeights.size > 0 ? Math.max(...availableHeights) : 720;

    // Best audio-only format size (added to video size for total estimate)
    const bestAudioSize = allRawFormats
      .filter((f) => f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"))
      .reduce((max, f) => Math.max(max, f.filesize ?? f.filesize_approx ?? 0), 0);

    // Build quality presets up to the video's max height
    const formats = QUALITY_HEIGHTS
      .filter((h) => h <= maxHeight)
      .map((h) => {
        // Find the largest video format at this exact height
        const videoSize = allRawFormats
          .filter((f) => f.height === h && f.vcodec && f.vcodec !== "none")
          .reduce((max, f) => Math.max(max, f.filesize ?? f.filesize_approx ?? 0), 0);

        const filesize = videoSize > 0 ? videoSize + bestAudioSize : undefined;

        return {
          formatId: `height_${h}`,
          quality: QUALITY_LABELS[h] || `${h}p`,
          resolution: `${h}p`,
          ext: "mp4",
          hasVideo: true,
          hasAudio: true,
          ...(filesize ? { filesize } : {}),
        };
      });

    // Fallback: always show at least 720p if no formats detected
    if (formats.length === 0) {
      formats.push({
        formatId: "height_720",
        quality: "720p",
        resolution: "720p",
        ext: "mp4",
        hasVideo: true,
        hasAudio: true,
      });
    }

    const thumbnails = (info.thumbnails || []) as Array<{ url: string; width?: number }>;
    const thumbnail =
      thumbnails.sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url ||
      `https://img.youtube.com/vi/${info.id}/maxresdefault.jpg`;

    res.json({
      id: info.id,
      title: info.title,
      thumbnail,
      channelName: info.uploader || info.channel || "Unknown Channel",
      duration: info.duration || 0,
      durationFormatted: formatDuration(info.duration || 0),
      viewCount: info.view_count ?? undefined,
      formats,
    });
  } catch (err: unknown) {
    const error = err as Error & { stderr?: string };
    req.log.error({ err: error }, "Failed to fetch video info");

    const msg = (error.message || "") + (error.stderr || "");
    if (msg.includes("Private video") || msg.includes("not available") || msg.includes("This video is unavailable")) {
      res.status(400).json({ error: "VIDEO_UNAVAILABLE", message: "This video is private or unavailable" });
      return;
    }
    if (msg.includes("age")) {
      res.status(400).json({ error: "AGE_RESTRICTED", message: "This video is age-restricted and cannot be downloaded" });
      return;
    }

    res.status(500).json({ error: "FETCH_FAILED", message: "Failed to fetch video information. Please try again." });
  }
});

router.get("/youtube/download-url", async (req, res) => {
  const { url, formatId, quality } = req.query as {
    url?: string;
    formatId?: string;
    quality?: string;
  };

  if (!url || !formatId || !quality) {
    res.status(400).json({ error: "BAD_REQUEST", message: "url, formatId, and quality parameters are required" });
    return;
  }

  if (!isValidYoutubeUrl(url)) {
    res.status(400).json({ error: "INVALID_URL", message: "Invalid YouTube URL" });
    return;
  }

  try {
    const height = formatId.replace("height_", "");
    // Prefer combined mp4 streams; fall back to best available
    const formatSelector = `best[height<=${height}][ext=mp4]/best[height<=${height}]/bestvideo[height<=${height}]+bestaudio/best`;

    const { stdout } = await execFileAsync(
      YT_DLP,
      ["-f", formatSelector, "--get-url", "--no-playlist", url],
      { timeout: 60000 }
    );

    // yt-dlp may output two lines (video + audio) when merging; use first (direct stream)
    const downloadUrl = stdout.trim().split("\n")[0];

    if (!downloadUrl) {
      res.status(500).json({ error: "NO_URL", message: "Could not retrieve download URL" });
      return;
    }

    res.json({
      downloadUrl,
      filename: `video_${quality}.mp4`,
      quality,
    });
  } catch (err: unknown) {
    const error = err as Error;
    req.log.error({ err: error }, "Failed to get download URL");
    res.status(500).json({ error: "DOWNLOAD_FAILED", message: "Failed to generate download URL. Please try again." });
  }
});

// Download endpoint — two-phase real-time streaming:
// Phase 1: yt-dlp --get-url resolves the direct CDN URLs for video+audio (fast, ~3s)
// Phase 2: ffmpeg fetches both streams simultaneously and mixes them into a
//           fragmented MP4 piped directly to the HTTP response.
// This starts delivering data to the browser immediately — no proxy timeout,
// no temp file needed, and every quality tier (4K, 1440p, 1080p…) works correctly.
router.get("/youtube/download", async (req, res) => {
  const { url, formatId, quality, title } = req.query as {
    url?: string;
    formatId?: string;
    quality?: string;
    title?: string;
  };

  if (!url || !formatId || !quality) {
    res.status(400).json({ error: "BAD_REQUEST", message: "url, formatId, and quality parameters are required" });
    return;
  }

  if (!isValidYoutubeUrl(url)) {
    res.status(400).json({ error: "INVALID_URL", message: "Invalid YouTube URL" });
    return;
  }

  const height = formatId.replace("height_", "");

  // Prefer mp4/m4a DASH pair so ffmpeg gets natively compatible streams
  const formatSelector = `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`;

  // Build a safe filename
  const safeName = (title || "video")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80);
  const filename = `${safeName}_${quality}.mp4`;

  // --- Phase 1: resolve direct CDN stream URLs ---
  let rawUrls: string[];
  try {
    const { stdout } = await execFileAsync(
      YT_DLP,
      ["-f", formatSelector, "--get-url", "--no-playlist", "--no-warnings", url],
      { timeout: 600000 }
    );
    rawUrls = stdout.trim().split("\n").filter(Boolean);
  } catch (err) {
    req.log.error({ err }, "yt-dlp --get-url failed");
    if (!res.headersSent) res.status(500).json({ error: "DOWNLOAD_FAILED", message: "Could not resolve video stream URLs" });
    return;
  }

  if (!rawUrls.length) {
    res.status(500).json({ error: "NO_STREAM_URL", message: "No stream URL returned" });
    return;
  }

  // --- Phase 2: stream via ffmpeg in real-time ---
  // Build ffmpeg args: one -i per URL (video, then audio if present)
  const ffmpegArgs: string[] = [];
  for (const u of rawUrls) {
    ffmpegArgs.push("-i", u);
  }

  // Fragmented MP4 via pipe — no seekable container needed for streaming
  ffmpegArgs.push(
    "-c", "copy",
    "-f", "mp4",
    "-movflags", "frag_keyframe+empty_moov+faststart",
    "pipe:1"
  );

  const ffmpegProcess = spawn(FFMPEG_BIN, ffmpegArgs);

  let clientGone = false;
  req.on("close", () => {
    clientGone = true;
    if (!ffmpegProcess.killed) ffmpegProcess.kill();
  });

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "video/mp4");

  ffmpegProcess.stdout.pipe(res);

  ffmpegProcess.stderr.on("data", (chunk: Buffer) => {
    req.log.info({ stderr: chunk.toString() }, "ffmpeg progress");
  });

  ffmpegProcess.on("error", (err: Error) => {
    req.log.error({ err }, "ffmpeg spawn error");
    if (!res.headersSent) res.status(500).json({ error: "STREAM_FAILED", message: "Streaming process failed" });
  });

  ffmpegProcess.on("close", (code) => {
    if (clientGone) return;
    if (code !== 0) {
      req.log.error({ code }, "ffmpeg exited with non-zero code");
    }
  });
});

export default router;

