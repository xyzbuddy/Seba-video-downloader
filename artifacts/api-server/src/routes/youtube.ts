import { Router, type IRouter } from "express";
import https from "https";
import http from "http";
import ffmpegStatic from "ffmpeg-static";
import { execFileSync, spawn } from "child_process";
import path from "path";
import fs from "fs";

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
  const beside = path.join(__dirname, "..", "yt-dlp" + (process.platform === "win32" ? ".exe" : ""));
  if (fs.existsSync(beside)) return beside;
  try {
    const which = execFileSync(process.platform === "win32" ? "where" : "which", ["yt-dlp"], { encoding: "utf8" }).trim();
    if (which) return which.split("\n")[0].trim();
  } catch {}
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

// ── Invidious instances ───────────────────────────────────────────────────────
const INVIDIOUS_INSTANCES = [
  "https://inv.thepixora.com",
  "https://invidious.perennialte.ch",
  "https://iv.melmac.space",
  "https://invidious.privacydev.net",
  "https://yt.cdaut.de",
  "https://invidious.jing.rocks",
];

interface InvFormat {
  url: string;
  type: string;
  qualityLabel?: string;
  resolution?: string;
  bitrate?: number;
  itag?: number;
}

interface InvVideoData {
  videoId: string;
  title: string;
  videoThumbnails: Array<{ url: string; width: number }>;
  lengthSeconds: number;
  author: string;
  viewCount: number;
  adaptiveFormats: InvFormat[];
  formatStreams: InvFormat[];
}

// Race all instances — fastest wins
async function fetchFromInvidious(videoId: string): Promise<InvVideoData | null> {
  const fields = "videoId,title,videoThumbnails,lengthSeconds,author,viewCount,adaptiveFormats,formatStreams";
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 25000);
  try {
    const result = await Promise.any(
      INVIDIOUS_INSTANCES.map(async (base) => {
        const res = await fetch(`${base}/api/v1/videos/${videoId}?fields=${fields}`, {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json() as InvVideoData;
        if (!data.title) throw new Error("no title");
        return data;
      })
    );
    clearTimeout(t);
    controller.abort();
    return result;
  } catch {
    clearTimeout(t);
    return null;
  }
}

// oEmbed — title/thumbnail, always accessible
async function fetchOEmbed(videoId: string) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (res.ok) return res.json() as Promise<{ title: string; author_name: string; thumbnail_url: string }>;
  } catch {}
  return null;
}

// Proxy a direct URL → response (with redirect following)
function proxyStream(streamUrl: string, res: any, req: any) {
  const proto = streamUrl.startsWith("https") ? https : http;
  const reqOut = proto.get(streamUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "*/*",
    },
  }, (upstream) => {
    if ((upstream.statusCode ?? 0) >= 300 && (upstream.statusCode ?? 0) < 400 && upstream.headers.location) {
      upstream.destroy();
      proxyStream(upstream.headers.location, res, req);
      return;
    }
    if ((upstream.statusCode ?? 0) < 200 || (upstream.statusCode ?? 0) >= 300) {
      upstream.destroy();
      if (!res.headersSent) res.status(502).json({ error: "CDN_ERROR", message: `CDN returned ${upstream.statusCode}` });
      return;
    }
    if (upstream.headers["content-length"]) res.setHeader("Content-Length", upstream.headers["content-length"]);
    upstream.pipe(res);
    upstream.on("error", () => { if (!res.headersSent) res.status(500).end(); });
  });
  reqOut.on("error", () => { if (!res.headersSent) res.status(502).json({ error: "PROXY_ERROR" }); });
  req.on("close", () => reqOut.destroy());
}

// ── GET /youtube/info ─────────────────────────────────────────────────────────
router.get("/youtube/info", async (req, res) => {
  const { url } = req.query as { url?: string };
  if (!url) { res.status(400).json({ error: "BAD_REQUEST", message: "URL required" }); return; }
  if (!isValidYoutubeUrl(url)) { res.status(400).json({ error: "INVALID_URL", message: "Invalid YouTube URL" }); return; }

  const videoId = extractVideoId(url);
  if (!videoId) { res.status(400).json({ error: "INVALID_URL", message: "Could not extract video ID" }); return; }

  // Fetch oEmbed + Invidious in parallel
  const [oembed, invData] = await Promise.all([
    fetchOEmbed(videoId),
    fetchFromInvidious(videoId),
  ]);

  if (!oembed && !invData) {
    res.status(500).json({ error: "FETCH_FAILED", message: "Failed to fetch video information. Please try again." });
    return;
  }

  const title = invData?.title || oembed?.title || "YouTube Video";
  const thumbnail = invData?.videoThumbnails?.find(t => t.width >= 480)?.url
    || oembed?.thumbnail_url
    || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const channelName = invData?.author || oembed?.author_name || "YouTube";
  const duration = invData?.lengthSeconds ? Number(invData.lengthSeconds) : 0;

  // Derive available heights from Invidious formats
  let availableHeights = new Set<number>([720, 480, 360]); // safe defaults
  if (invData) {
    const heights = [
      ...(invData.adaptiveFormats || [])
        .filter(f => f.type?.includes("video"))
        .map(f => {
          const m = (f.qualityLabel || f.resolution || "").match(/(\d+)p/);
          return m ? parseInt(m[1]) : 0;
        }),
      ...(invData.formatStreams || [])
        .map(f => {
          const m = (f.qualityLabel || f.resolution || "").match(/(\d+)p/);
          return m ? parseInt(m[1]) : 0;
        }),
    ].filter(h => h > 0);
    if (heights.length > 0) availableHeights = new Set(heights);
  }

  const maxHeight = Math.max(...availableHeights);
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

  res.json({
    id: videoId,
    title: title.replace(/\n/g, " ").slice(0, 120).trim(),
    thumbnail,
    channelName,
    duration,
    durationFormatted: formatDuration(duration),
    viewCount: invData?.viewCount ? Number(invData.viewCount) : undefined,
    formats: Array.from(new Map(qualityFormats.map(f => [f.formatId, f])).values()),
  });
});

// ── GET /youtube/download ─────────────────────────────────────────────────────
router.get("/youtube/download", async (req, res) => {
  const { url, formatId, quality, title } = req.query as {
    url?: string; formatId?: string; quality?: string; title?: string;
  };

  if (!url || !formatId || !quality) {
    res.status(400).json({ error: "BAD_REQUEST", message: "url, formatId, and quality required" });
    return;
  }
  if (!isValidYoutubeUrl(url)) {
    res.status(400).json({ error: "INVALID_URL", message: "Invalid YouTube URL" });
    return;
  }

  const videoId = extractVideoId(url);
  if (!videoId) { res.status(400).json({ error: "INVALID_URL" }); return; }

  const targetHeight = parseInt(formatId.replace("height_", ""), 10) || 720;
  const safeName = (title || "video").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 80) || "video";
  const filename = `${safeName}_${quality}.mp4`;

  // Strategy 1: Invidious — get stream URLs, proxy if accessible
  const invData = await fetchFromInvidious(videoId);

  if (invData) {
    const getHeight = (f: InvFormat) => {
      const m = (f.qualityLabel || f.resolution || "").match(/(\d+)p/);
      return m ? parseInt(m[1]) : 0;
    };

    // Try separate video+audio → ffmpeg mux (best quality)
    const videoStreams = (invData.adaptiveFormats || [])
      .filter(f => f.type?.includes("video") && f.url && getHeight(f) <= targetHeight && getHeight(f) > 0)
      .sort((a, b) => getHeight(b) - getHeight(a));
    const audioStreams = (invData.adaptiveFormats || [])
      .filter(f => f.type?.includes("audio") && f.url)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    const bestVideo = videoStreams[0];
    const bestAudio = audioStreams[0];

    if (bestVideo?.url && bestAudio?.url) {
      // Test accessibility of stream URLs (quick 2KB head request)
      let streamsAccessible = false;
      try {
        const testRes = await fetch(bestVideo.url, {
          method: "HEAD",
          signal: AbortSignal.timeout(4000),
        });
        streamsAccessible = testRes.status >= 200 && testRes.status < 400;
      } catch {}

      if (streamsAccessible) {
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "video/mp4");

        const ff = spawn(FFMPEG_BIN, [
          "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "-i", bestVideo.url,
          "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "-i", bestAudio.url,
          "-c", "copy",
          "-f", "mp4",
          "-movflags", "frag_keyframe+empty_moov+faststart",
          "pipe:1",
        ]);

        let clientGone = false;
        req.on("close", () => { clientGone = true; if (!ff.killed) ff.kill(); });
        ff.stdout.pipe(res);
        ff.on("error", () => { if (!res.headersSent) res.status(500).end(); });
        return;
      }
    }

    // Fallback: pre-merged stream (720p/360p)
    const preMerged = (invData.formatStreams || [])
      .filter(f => f.url)
      .sort((a, b) => {
        // Prefer closest to target height
        const aH = getHeight(a), bH = getHeight(b);
        return Math.abs(bH - targetHeight) - Math.abs(aH - targetHeight);
      });

    for (const stream of preMerged) {
      try {
        const testRes = await fetch(stream.url, {
          method: "HEAD",
          signal: AbortSignal.timeout(4000),
        });
        if (testRes.status >= 200 && testRes.status < 400) {
          res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
          res.setHeader("Content-Type", "video/mp4");
          if (testRes.headers.get("content-length")) {
            res.setHeader("Content-Length", testRes.headers.get("content-length")!);
          }
          proxyStream(stream.url, res, req);
          return;
        }
      } catch {}
    }
  }

  // Strategy 2: yt-dlp (fallback for when Invidious stream URLs are IP-locked)
  const fmtSelector = `bestvideo[height<=${targetHeight}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${targetHeight}][ext=mp4]/best[height<=${targetHeight}]/best`;
  const ytdlpClients = ["mweb", "tv_embedded", "web_creator"];

  for (const client of ytdlpClients) {
    const proc = spawn(YT_DLP, [
      "-f", fmtSelector,
      "--no-playlist",
      "--no-warnings",
      "--no-check-certificate",
      "--extractor-args", `youtube:player_client=${client}`,
      "--merge-output-format", "mp4",
      "-o", "-",
      url,
    ]);

    let gotData = false;
    const done = await new Promise<boolean>((resolve) => {
      proc.stdout.once("data", () => {
        gotData = true;
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "video/mp4");
        proc.stdout.pipe(res);
        req.on("close", () => { if (!proc.killed) proc.kill(); });
        proc.on("close", () => resolve(true));
      });
      proc.on("error", () => resolve(false));
      setTimeout(() => {
        if (!gotData && !proc.killed) { proc.kill("SIGTERM"); resolve(false); }
      }, 15000);
      proc.on("close", () => { if (!gotData) resolve(false); });
    });

    if (done) return;
  }

  if (!res.headersSent) {
    res.status(500).json({
      error: "DOWNLOAD_FAILED",
      message: "Download failed. YouTube is blocking this server. Please try the YouTube page directly.",
    });
  }
});

router.get("/youtube/download-url", (_req, res) => {
  res.status(501).json({ error: "NOT_SUPPORTED", message: "Use /youtube/download instead" });
});

export default router;
