import { Router, type IRouter } from "express";
import { execFileSync, spawn } from "child_process";
import https from "https";
import http from "http";
import ffmpegStatic from "ffmpeg-static";

// ── Innertube API ─────────────────────────────────────────────────────────────
// YouTube's production servers block yt-dlp from GCP IPs (HTTP 429).
// Their own internal Innertube API (/youtubei/v1/player) is NOT blocked —
// it's the same endpoint the YouTube Android app uses.
// ANDROID_VR client returns direct CDN URLs (no cipher) for all formats.

const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/player";
const INNERTUBE_BODY = (videoId: string) =>
  JSON.stringify({
    videoId,
    context: {
      client: {
        clientName: "ANDROID_VR",
        clientVersion: "1.56.21",
        deviceMake: "Oculus",
        deviceModel: "Quest 3",
        androidSdkVersion: 32,
        osName: "Android",
        osVersion: "12L",
        hl: "en",
        gl: "US",
      },
    },
  });

interface InnertubeFormat {
  itag: number;
  url?: string;
  mimeType?: string;
  quality?: string;
  qualityLabel?: string;
  width?: number;
  height?: number;
  contentLength?: string;
  audioQuality?: string;
}

interface InnertubeResponse {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: {
    videoId?: string;
    title?: string;
    lengthSeconds?: string;
    author?: string;
    viewCount?: string;
    thumbnail?: { thumbnails?: Array<{ url: string; width: number; height: number }> };
  };
  streamingData?: {
    formats?: InnertubeFormat[];
    adaptiveFormats?: InnertubeFormat[];
    expiresInSeconds?: string;
  };
}

async function callInnertube(videoId: string): Promise<InnertubeResponse> {
  return new Promise((resolve, reject) => {
    const body = INNERTUBE_BODY(videoId);
    const url = new URL(INNERTUBE_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": "Mozilla/5.0 (Linux; Android 12; Oculus Quest 3) AppleWebKit/537.36 Chrome/114.0.0.0 Mobile Safari/537.36",
        "X-YouTube-Client-Name": "28",
        "X-YouTube-Client-Version": "1.56.21",
      },
    };
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          reject(new Error("Innertube response parse error"));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(new Error("Innertube request timed out")); });
    req.write(body);
    req.end();
  });
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ── ffmpeg ────────────────────────────────────────────────────────────────────
function resolveFfmpegBin(): string {
  // Use ffmpeg-static npm package for cross-environment compatibility
  if (ffmpegStatic) return ffmpegStatic;
  
  try {
    return execFileSync("which", ["ffmpeg"], { encoding: "utf8" }).trim();
  } catch {
    return "/nix/store/hm5p1jkyrqp2jinklggxv8q7qg1glf03-replit-runtime-path/bin/ffmpeg";
  }
}
const FFMPEG_BIN = resolveFfmpegBin();
console.info(`[youtube] ffmpeg resolved to: ${FFMPEG_BIN}`);

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

// Pick the best video format at or below a given height, preferring MP4
function pickVideoFormat(adaptive: InnertubeFormat[], maxHeight: number): InnertubeFormat | null {
  const candidates = adaptive
    .filter((f) => f.url && f.mimeType?.startsWith("video") && (f.height ?? 0) <= maxHeight)
    .sort((a, b) => {
      const hDiff = (b.height ?? 0) - (a.height ?? 0);
      if (hDiff !== 0) return hDiff;
      // Prefer MP4 over WebM at same height
      const aMp4 = a.mimeType?.includes("mp4") ? 1 : 0;
      const bMp4 = b.mimeType?.includes("mp4") ? 1 : 0;
      return bMp4 - aMp4;
    });
  return candidates[0] ?? null;
}

// Pick the best audio format, preferring MP4/M4A
function pickAudioFormat(adaptive: InnertubeFormat[]): InnertubeFormat | null {
  const candidates = adaptive
    .filter((f) => f.url && f.mimeType?.startsWith("audio"))
    .sort((a, b) => {
      const aMp4 = a.mimeType?.includes("mp4") ? 1 : 0;
      const bMp4 = b.mimeType?.includes("mp4") ? 1 : 0;
      if (bMp4 !== aMp4) return bMp4 - aMp4;
      // Higher content length = better quality
      return Number(b.contentLength ?? 0) - Number(a.contentLength ?? 0);
    });
  return candidates[0] ?? null;
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

  const videoId = extractVideoId(url);
  if (!videoId) {
    res.status(400).json({ error: "INVALID_URL", message: "Could not extract video ID" });
    return;
  }

  try {
    const data = await callInnertube(videoId);

    const status = data.playabilityStatus?.status;
    if (status !== "OK") {
      const reason = data.playabilityStatus?.reason ?? "Video unavailable";
      req.log.error({ status, reason }, "Innertube returned non-OK status");
      if (status === "LOGIN_REQUIRED") {
        res.status(400).json({ error: "AGE_RESTRICTED", message: "This video is age-restricted and cannot be downloaded" });
      } else {
        res.status(400).json({ error: "VIDEO_UNAVAILABLE", message: reason });
      }
      return;
    }

    const adaptive = data.streamingData?.adaptiveFormats ?? [];

    // Available heights from adaptive video formats
    const availableHeights = new Set<number>(
      adaptive.filter((f) => f.url && f.mimeType?.startsWith("video") && f.height).map((f) => f.height!)
    );
    const maxHeight = availableHeights.size > 0 ? Math.max(...availableHeights) : 720;

    // Best audio size for file size estimates
    const bestAudio = pickAudioFormat(adaptive);
    const bestAudioSize = bestAudio ? Number(bestAudio.contentLength ?? 0) : 0;

    const formats = QUALITY_HEIGHTS
      .filter((h) => h <= maxHeight)
      .map((h) => {
        const best = pickVideoFormat(adaptive, h);
        const videoSize = best ? Number(best.contentLength ?? 0) : 0;
        const filesize = videoSize + bestAudioSize || undefined;
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

    if (formats.length === 0) {
      formats.push({ formatId: "height_720", quality: "720p", resolution: "720p", ext: "mp4", hasVideo: true, hasAudio: true });
    }

    const vd = data.videoDetails!;
    const thumbs = vd.thumbnail?.thumbnails ?? [];
    const thumbnail =
      thumbs.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ||
      `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

    res.json({
      id: videoId,
      title: vd.title ?? "Unknown",
      thumbnail,
      channelName: vd.author ?? "Unknown Channel",
      duration: Number(vd.lengthSeconds ?? 0),
      durationFormatted: formatDuration(Number(vd.lengthSeconds ?? 0)),
      viewCount: vd.viewCount ? Number(vd.viewCount) : undefined,
      formats,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch video info via Innertube");
    res.status(500).json({ error: "FETCH_FAILED", message: "Failed to fetch video information. Please try again." });
  }
});

// ── GET /youtube/download ─────────────────────────────────────────────────────
// Phase 1: call Innertube to get direct CDN URLs for video + audio
// Phase 2: pass both URLs to ffmpeg which fetches and merges them on the fly,
//          piping fragmented MP4 directly to the browser response.
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

  const height = parseInt(formatId.replace("height_", ""), 10) || 720;

  const safeName = (title || "video")
    .replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 80) || "video";
  const filename = `${safeName}_${quality}.mp4`;

  // Phase 1 — resolve stream URLs via Innertube
  let videoUrl: string;
  let audioUrl: string;
  try {
    const data = await callInnertube(videoId);

    if (data.playabilityStatus?.status !== "OK") {
      res.status(400).json({ error: "VIDEO_UNAVAILABLE", message: data.playabilityStatus?.reason ?? "Video unavailable" });
      return;
    }

    const adaptive = data.streamingData?.adaptiveFormats ?? [];
    const combined = data.streamingData?.formats ?? [];

    const vidFmt = pickVideoFormat(adaptive, height);
    const audFmt = pickAudioFormat(adaptive);

    if (!vidFmt?.url || !audFmt?.url) {
      // Fallback: try combined format (360p only)
      const combo = combined.find((f) => f.url && f.mimeType?.startsWith("video"));
      if (combo?.url) {
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "video/mp4");
        if (combo.contentLength) res.setHeader("Content-Length", combo.contentLength);

        const proto = combo.url.startsWith("https") ? https : http;
        const pr = proto.get(combo.url, { headers: { "User-Agent": "com.google.android.youtube/17.31.35", Referer: "https://www.youtube.com/" } }, (upstream) => {
          upstream.pipe(res);
          upstream.on("error", (e: Error) => { req.log.error({ e }, "combo stream error"); });
        });
        pr.on("error", (e: Error) => { req.log.error({ e }, "combo proxy error"); if (!res.headersSent) res.status(500).json({ error: "STREAM_FAILED" }); });
        req.on("close", () => pr.destroy());
        return;
      }
      res.status(500).json({ error: "NO_STREAM_URL", message: "Could not find stream URLs for this quality" });
      return;
    }
    videoUrl = vidFmt.url;
    audioUrl = audFmt.url;
  } catch (err) {
    req.log.error({ err }, "Innertube call failed during download");
    if (!res.headersSent) res.status(500).json({ error: "DOWNLOAD_FAILED", message: "Could not resolve video stream URLs" });
    return;
  }

  // Phase 2 — ffmpeg merges video + audio into fragmented MP4, pipes to browser
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "video/mp4");

  req.log.info({ videoUrl: videoUrl.slice(0, 80), quality }, "YouTube download: merging via ffmpeg");

  const ffmpegArgs = [
    "-user_agent", "com.google.android.youtube/17.31.35 (Linux; U; Android 12) gzip",
    "-i", videoUrl,
    "-user_agent", "com.google.android.youtube/17.31.35 (Linux; U; Android 12) gzip",
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
    req.log.info({ stderr: chunk.toString() }, "ffmpeg progress");
  });

  ffmpegProcess.on("error", (err: Error) => {
    req.log.error({ err }, "ffmpeg spawn error");
    if (!res.headersSent) res.status(500).json({ error: "STREAM_FAILED", message: "Streaming process failed" });
  });

  ffmpegProcess.on("close", (code) => {
    if (clientGone) return;
    if (code !== 0) req.log.error({ code }, "ffmpeg exited with non-zero code");
  });
});

// ── GET /youtube/download-url (legacy) ───────────────────────────────────────
// Returns a JSON object with a download URL — kept for compatibility.
router.get("/youtube/download-url", async (req, res) => {
  res.status(501).json({ error: "NOT_SUPPORTED", message: "Use /youtube/download instead" });
});

export default router;
