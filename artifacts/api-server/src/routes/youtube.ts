import { Router, type IRouter } from "express";
import https from "https";
import http from "http";
import ffmpegStatic from "ffmpeg-static";
import { execFileSync, spawn, execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execFileAsync = promisify(execFile);

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

// ── yt-dlp path ───────────────────────────────────────────────────────────────
function resolveYtDlp(): string {
  // 1. Check beside the dist bundle (artifacts/api-server/yt-dlp)
  const beside = path.join(__dirname, "..", "yt-dlp" + (process.platform === "win32" ? ".exe" : ""));
  if (fs.existsSync(beside)) return beside;
  // 2. Check system PATH
  try {
    const which = execFileSync(process.platform === "win32" ? "where" : "which", ["yt-dlp"], { encoding: "utf8" }).trim();
    if (which) return which.split("\n")[0].trim();
  } catch {}
  // 3. Fallback
  return "yt-dlp";
}
const YT_DLP = resolveYtDlp();

const router: IRouter = Router();

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

function extractVideoId(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.split("/")[1]?.split("?")[0] || "";
    }
    return parsed.searchParams.get("v") || parsed.pathname.split("/").pop() || "";
  } catch {
    return "";
  }
}

const QUALITY_HEIGHTS = [2160, 1440, 1080, 720, 480, 360];
const QUALITY_LABELS: Record<number, string> = {
  2160: "4K", 1440: "1440p", 1080: "1080p", 720: "720p", 480: "480p", 360: "360p",
};

// ── YouTube oEmbed – always works, gives title + thumbnail ───────────────────
async function fetchYouTubeOEmbed(videoId: string) {
  const res = await fetch(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`oEmbed HTTP ${res.status}`);
  return res.json() as Promise<{
    title: string;
    author_name: string;
    thumbnail_url: string;
  }>;
}

// ── yt-dlp with multiple player client fallbacks ─────────────────────────────
const YT_DLP_CLIENTS = [
  "mweb",           // mobile web – usually not datacenter-blocked
  "web_creator",    // YouTube Studio client
  "android_testsuite", // internal Android test client
  "tv_embedded",    // TV embedded player
];

async function fetchYtDlpFormats(url: string): Promise<any[] | null> {
  for (const client of YT_DLP_CLIENTS) {
    try {
      const { stdout } = await execFileAsync(
        YT_DLP,
        [
          "--dump-json",
          "--no-playlist",
          "--no-warnings",
          "--no-check-certificate",
          "--extractor-args", `youtube:player_client=${client}`,
          url,
        ],
        { timeout: 20000, maxBuffer: 10 * 1024 * 1024 }
      );
      const data = JSON.parse(stdout.trim());
      if (data.formats && data.formats.length > 0) {
        return data.formats;
      }
    } catch {
      // try next client
    }
  }
  return null;
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

  const videoId = extractVideoId(url);
  if (!videoId) {
    res.status(400).json({ error: "INVALID_URL", message: "Could not extract video ID" });
    return;
  }

  // Step 1: Get title + thumbnail from oEmbed (always works)
  let title = "YouTube Video";
  let thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  let channelName = "YouTube";

  try {
    const oembed = await fetchYouTubeOEmbed(videoId);
    title = oembed.title;
    channelName = oembed.author_name;
    thumbnail = oembed.thumbnail_url;
  } catch (e) {
    req.log?.warn?.({ e }, "oEmbed failed, using defaults");
  }

  // Step 2: Try yt-dlp to get available format heights
  const formats = await fetchYtDlpFormats(url);

  let availableHeights: Set<number>;
  if (formats) {
    availableHeights = new Set<number>(
      formats.filter((f: any) => f.height).map((f: any) => Number(f.height))
    );
  } else {
    // yt-dlp blocked — offer standard quality options anyway
    availableHeights = new Set([2160, 1080, 720, 480, 360]);
  }

  const maxHeight = availableHeights.size > 0 ? Math.max(...availableHeights) : 720;
  const qualityFormats = QUALITY_HEIGHTS
    .filter(h => h <= maxHeight || h === 720)
    .map(h => ({
      formatId: `height_${h}`,
      quality: QUALITY_LABELS[h] || `${h}p`,
      resolution: `${h}p`,
      ext: "mp4",
      hasVideo: true,
      hasAudio: true,
    }));

  const uniqueFormats = Array.from(new Map(qualityFormats.map(item => [item.formatId, item])).values());

  res.json({
    id: videoId,
    title: title.replace(/\n/g, " ").slice(0, 120).trim(),
    thumbnail,
    channelName,
    duration: 0,
    durationFormatted: "0:00",
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

  const targetHeight = parseInt(formatId.replace("height_", ""), 10) || 720;
  const safeName = (title || "video").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 80) || "video";
  const filename = `${safeName}_${quality}.mp4`;

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "video/mp4");

  // Pipe yt-dlp output directly — try each client until one works
  const fmtSelector = `bestvideo[height<=${targetHeight}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${targetHeight}]+bestaudio/best[height<=${targetHeight}]/best`;

  for (const client of YT_DLP_CLIENTS) {
    const args = [
      "-f", fmtSelector,
      "--no-playlist",
      "--no-warnings",
      "--no-check-certificate",
      "--extractor-args", `youtube:player_client=${client}`,
      "--merge-output-format", "mp4",
      "-o", "-",
      url,
    ];

    const proc = spawn(YT_DLP, args);
    let resolved = false;

    await new Promise<void>((resolve) => {
      proc.stdout.once("data", () => {
        resolved = true;
        proc.stdout.pipe(res);
        let clientGone = false;
        req.on("close", () => { clientGone = true; if (!proc.killed) proc.kill(); });
        proc.on("close", () => { resolve(); });
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        const stderr = chunk.toString();
        // If blocked/error, mark as unresolved quickly
        if (stderr.includes("Sign in") || stderr.includes("bot") || stderr.includes("unavailable")) {
          if (!resolved && !proc.killed) proc.kill("SIGTERM");
        }
      });

      proc.on("error", () => {
        if (!resolved) resolve();
      });

      proc.on("close", (code) => {
        if (!resolved) resolve();
      });

      // Timeout if no data in 15s
      setTimeout(() => {
        if (!resolved && !proc.killed) {
          proc.kill("SIGTERM");
          resolve();
        }
      }, 15000);
    });

    if (resolved) return; // Successfully piped
  }

  // All clients failed
  if (!res.headersSent) {
    res.status(500).json({ error: "DOWNLOAD_FAILED", message: "Could not download video. YouTube may be blocking this server." });
  }
});

router.get("/youtube/download-url", async (_req, res) => {
  res.status(501).json({ error: "NOT_SUPPORTED", message: "Use /youtube/download instead" });
});

export default router;
