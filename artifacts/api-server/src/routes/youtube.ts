import { Router, type IRouter } from "express";
import ytdl from "@distube/ytdl-core";

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

function getQualityLabel(format: ytdl.videoFormat): string {
  if (!format.qualityLabel) return "Unknown";
  return format.qualityLabel;
}

function normalizeQualityLabel(label: string): string {
  const match = label.match(/(\d+)p/);
  if (!match) return label;
  const height = parseInt(match[1]);
  if (height >= 2160) return "4K";
  if (height >= 1440) return "1440p";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  if (height >= 480) return "480p";
  if (height >= 360) return "360p";
  if (height >= 240) return "240p";
  return label;
}

router.get("/youtube/info", async (req, res) => {
  const { url } = req.query as { url?: string };

  if (!url) {
    res.status(400).json({ error: "BAD_REQUEST", message: "URL parameter is required" });
    return;
  }

  if (!ytdl.validateURL(url)) {
    res.status(400).json({ error: "INVALID_URL", message: "Invalid YouTube URL" });
    return;
  }

  try {
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      },
    });

    const { videoDetails, formats } = info;

    const seen = new Set<string>();
    const uniqueFormats: Array<{
      formatId: string;
      quality: string;
      resolution: string;
      filesize?: number;
      ext: string;
      hasVideo: boolean;
      hasAudio: boolean;
    }> = [];

    const videoFormats = formats
      .filter((f) => f.hasVideo && f.qualityLabel)
      .sort((a, b) => {
        const aH = parseInt((a.qualityLabel || "0p").replace(/\D/g, "")) || 0;
        const bH = parseInt((b.qualityLabel || "0p").replace(/\D/g, "")) || 0;
        return bH - aH;
      });

    for (const f of videoFormats) {
      const qualLabel = normalizeQualityLabel(getQualityLabel(f));
      const key = `${qualLabel}-${f.container}`;
      if (seen.has(key)) continue;
      seen.add(key);

      uniqueFormats.push({
        formatId: f.itag.toString(),
        quality: qualLabel,
        resolution: f.qualityLabel || qualLabel,
        filesize: f.contentLength ? parseInt(f.contentLength) : undefined,
        ext: f.container || "mp4",
        hasVideo: f.hasVideo,
        hasAudio: f.hasAudio,
      });
    }

    if (uniqueFormats.length === 0) {
      const fallback = formats.filter((f) => f.hasVideo).slice(0, 3);
      for (const f of fallback) {
        uniqueFormats.push({
          formatId: f.itag.toString(),
          quality: getQualityLabel(f) || "Standard",
          resolution: f.qualityLabel || "Standard",
          filesize: f.contentLength ? parseInt(f.contentLength) : undefined,
          ext: f.container || "mp4",
          hasVideo: f.hasVideo,
          hasAudio: f.hasAudio,
        });
      }
    }

    const duration = parseInt(videoDetails.lengthSeconds) || 0;

    res.json({
      id: videoDetails.videoId,
      title: videoDetails.title,
      thumbnail:
        videoDetails.thumbnails?.sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url ||
        `https://img.youtube.com/vi/${videoDetails.videoId}/maxresdefault.jpg`,
      channelName: videoDetails.author?.name || "Unknown Channel",
      duration,
      durationFormatted: formatDuration(duration),
      viewCount: videoDetails.viewCount ? parseInt(videoDetails.viewCount) : undefined,
      formats: uniqueFormats,
    });
  } catch (err: unknown) {
    const error = err as Error;
    req.log.error({ err: error }, "Failed to fetch video info");

    if (error.message?.includes("private") || error.message?.includes("unavailable")) {
      res.status(400).json({
        error: "VIDEO_UNAVAILABLE",
        message: "This video is private or unavailable",
      });
      return;
    }
    if (error.message?.includes("age")) {
      res.status(400).json({
        error: "AGE_RESTRICTED",
        message: "This video is age-restricted and cannot be downloaded",
      });
      return;
    }

    res.status(500).json({
      error: "FETCH_FAILED",
      message: "Failed to fetch video information. Please try again.",
    });
  }
});

router.get("/youtube/download-url", async (req, res) => {
  const { url, formatId, quality } = req.query as {
    url?: string;
    formatId?: string;
    quality?: string;
  };

  if (!url || !formatId || !quality) {
    res.status(400).json({
      error: "BAD_REQUEST",
      message: "url, formatId, and quality parameters are required",
    });
    return;
  }

  if (!ytdl.validateURL(url)) {
    res.status(400).json({ error: "INVALID_URL", message: "Invalid YouTube URL" });
    return;
  }

  try {
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      },
    });

    const format = info.formats.find((f) => f.itag.toString() === formatId);

    if (!format || !format.url) {
      res.status(400).json({
        error: "FORMAT_NOT_FOUND",
        message: "The selected format is not available for this video",
      });
      return;
    }

    const title = info.videoDetails.title
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "_")
      .substring(0, 80);
    const filename = `${title}_${quality}.${format.container || "mp4"}`;

    res.json({
      downloadUrl: format.url,
      filename,
      quality,
    });
  } catch (err: unknown) {
    const error = err as Error;
    req.log.error({ err: error }, "Failed to get download URL");
    res.status(500).json({
      error: "DOWNLOAD_FAILED",
      message: "Failed to generate download URL. Please try again.",
    });
  }
});

export default router;
