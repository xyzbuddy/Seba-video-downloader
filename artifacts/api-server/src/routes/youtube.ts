import { Router, type IRouter } from "express";
import https from "https";
import http from "http";
import ffmpegStatic from "ffmpeg-static";
import { execFileSync, spawn } from "child_process";

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

// ── Invidious instances (ordered by reliability) ──────────────────────────────
// These are manually verified to work from datacenter IPs
const INVIDIOUS_INSTANCES = [
  "https://inv.thepixora.com",
  "https://invidious.perennialte.ch",
  "https://iv.melmac.space",
  "https://invidious.moonkeki.gr",
  "https://invidious.reallyaweso.me",
  "https://yt.cdaut.de",
  "https://invidious.privacydev.net",
  "https://invidious.jing.rocks",
];

interface InvidiousFormat {
  url: string;
  type: string;
  resolution?: string;
  qualityLabel?: string;
  bitrate?: number;
  encoding?: string;
  audioSampleRate?: number;
}

interface InvidiousVideoData {
  videoId: string;
  title: string;
  videoThumbnails: Array<{ url: string; width: number; height: number }>;
  lengthSeconds: number;
  author: string;
  viewCount: number;
  adaptiveFormats: InvidiousFormat[];
  formatStreams: InvidiousFormat[];
}

async function fetchFromInvidious(videoId: string): Promise<InvidiousVideoData | null> {
  const fields = "videoId,title,videoThumbnails,lengthSeconds,author,viewCount,adaptiveFormats,formatStreams";

  // Race all instances — first one to respond wins
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const result = await Promise.any(
      INVIDIOUS_INSTANCES.map(async (base) => {
        const res = await fetch(`${base}/api/v1/videos/${videoId}?fields=${fields}`, {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${base}`);
        const data = await res.json() as InvidiousVideoData;
        if (!data.title) throw new Error("no title");
        return data;
      })
    );
    clearTimeout(timeout);
    controller.abort();
    return result;
  } catch {
    clearTimeout(timeout);
    return null;
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

  const videoId = extractVideoId(url);
  if (!videoId) {
    res.status(400).json({ error: "INVALID_URL", message: "Could not extract video ID" });
    return;
  }

  const data = await fetchFromInvidious(videoId);
  if (!data) {
    res.status(500).json({ error: "FETCH_FAILED", message: "Failed to fetch video information. Please try again." });
    return;
  }

  // Build available formats from adaptive streams
  const videoHeights = new Set<number>(
    (data.adaptiveFormats || [])
      .filter(f => f.type?.includes("video"))
      .map(f => {
        const match = (f.qualityLabel || f.resolution || "").match(/(\d+)p/);
        return match ? parseInt(match[1]) : 0;
      })
      .filter(h => h > 0)
  );

  // Also include pre-merged streams
  (data.formatStreams || []).forEach(f => {
    const match = (f.qualityLabel || f.resolution || "").match(/(\d+)p/);
    if (match) videoHeights.add(parseInt(match[1]));
  });

  const maxHeight = videoHeights.size > 0 ? Math.max(...videoHeights) : 720;
  const formats = QUALITY_HEIGHTS
    .filter(h => h <= maxHeight || h === 720)
    .map(h => ({
      formatId: `height_${h}`,
      quality: QUALITY_LABELS[h] || `${h}p`,
      resolution: `${h}p`,
      ext: "mp4",
      hasVideo: true,
      hasAudio: true,
    }));

  const uniqueFormats = Array.from(new Map(formats.map(item => [item.formatId, item])).values());
  const thumbnail = data.videoThumbnails?.find(t => t.width >= 480)?.url
    || data.videoThumbnails?.[0]?.url
    || "";

  res.json({
    id: data.videoId || videoId,
    title: (data.title || "Video").replace(/\n/g, " ").slice(0, 120).trim(),
    thumbnail,
    channelName: data.author || "YouTube",
    duration: data.lengthSeconds ? Number(data.lengthSeconds) : 0,
    durationFormatted: formatDuration(data.lengthSeconds ? Number(data.lengthSeconds) : 0),
    viewCount: data.viewCount ? Number(data.viewCount) : undefined,
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

  const videoId = extractVideoId(url);
  if (!videoId) {
    res.status(400).json({ error: "INVALID_URL", message: "Could not extract video ID" });
    return;
  }

  const targetHeight = parseInt(formatId.replace("height_", ""), 10) || 720;
  const safeName = (title || "video").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 80) || "video";
  const filename = `${safeName}_${quality}.mp4`;

  const data = await fetchFromInvidious(videoId);
  if (!data) {
    res.status(500).json({ error: "DOWNLOAD_FAILED", message: "Failed to resolve video URLs. Please try again." });
    return;
  }

  // Try to find separate video + audio streams for quality merging
  const videoFormats = (data.adaptiveFormats || []).filter(f => f.type?.includes("video") && f.url);
  const audioFormats = (data.adaptiveFormats || []).filter(f => f.type?.includes("audio") && f.url);

  // Parse height from format
  const getHeight = (f: InvidiousFormat) => {
    const m = (f.qualityLabel || f.resolution || "").match(/(\d+)p/);
    return m ? parseInt(m[1]) : 0;
  };

  // Find best video at or below target height
  const sortedVideo = videoFormats
    .filter(f => getHeight(f) <= targetHeight && getHeight(f) > 0)
    .sort((a, b) => getHeight(b) - getHeight(a));

  // Find best audio
  const sortedAudio = audioFormats
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  const bestVideo = sortedVideo[0];
  const bestAudio = sortedAudio[0];

  const safeFiename = `${safeName}_${quality}.mp4`;
  res.setHeader("Content-Disposition", `attachment; filename="${safeFiename}"`);
  res.setHeader("Content-Type", "video/mp4");

  // Case 1: Have separate video + audio — use ffmpeg to mux
  if (bestVideo?.url && bestAudio?.url) {
    req.log?.info?.({ quality, height: getHeight(bestVideo) }, "YouTube/Invidious: merging via ffmpeg");

    const ffmpegArgs = [
      "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "-i", bestVideo.url,
      "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "-i", bestAudio.url,
      "-c", "copy",
      "-f", "mp4",
      "-movflags", "frag_keyframe+empty_moov+faststart",
      "pipe:1",
    ];

    const ff = spawn(FFMPEG_BIN, ffmpegArgs);
    let clientGone = false;
    req.on("close", () => { clientGone = true; if (!ff.killed) ff.kill(); });
    ff.stdout.pipe(res);
    ff.on("error", () => { if (!res.headersSent) res.status(500).end(); });
    return;
  }

  // Case 2: Use pre-merged formatStreams (these are already combined video+audio)
  const preMerged = (data.formatStreams || [])
    .filter(f => f.url)
    .sort((a, b) => {
      const aH = getHeight(a);
      const bH = getHeight(b);
      // Find closest to target without exceeding
      const aDiff = Math.abs(aH - targetHeight);
      const bDiff = Math.abs(bH - targetHeight);
      return aDiff - bDiff;
    });

  if (preMerged[0]?.url) {
    const streamUrl = preMerged[0].url;
    req.log?.info?.({ quality }, "YouTube/Invidious: using pre-merged stream");

    const proto = streamUrl.startsWith("https") ? https : http;
    const pr = proto.get(streamUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    }, (upstream) => {
      if (upstream.headers["content-length"]) {
        res.setHeader("Content-Length", upstream.headers["content-length"]);
      }
      upstream.pipe(res);
    });
    pr.on("error", () => { if (!res.headersSent) res.status(500).end(); });
    req.on("close", () => pr.destroy());
    return;
  }

  res.status(500).json({ error: "NO_STREAM_URL", message: "Could not find stream URLs for this video." });
});

router.get("/youtube/download-url", async (_req, res) => {
  res.status(501).json({ error: "NOT_SUPPORTED", message: "Use /youtube/download instead" });
});

export default router;
