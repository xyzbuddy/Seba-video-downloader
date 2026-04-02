import { Router, type IRouter } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import https from "https";
import http from "http";

const execFileAsync = promisify(execFile);
const YT_DLP = path.join(process.cwd(), "yt-dlp");

const router: IRouter = Router();

export type Platform = "youtube" | "facebook" | "instagram" | "tiktok";

export function detectPlatform(url: string): Platform | null {
  if (/youtu(be\.com|\.be)/i.test(url)) return "youtube";
  if (/facebook\.com|fb\.watch|m\.facebook\.com/i.test(url)) return "facebook";
  if (/instagram\.com/i.test(url)) return "instagram";
  if (/tiktok\.com/i.test(url)) return "tiktok";
  return null;
}

// Strip query params from Instagram URLs — tracking params confuse yt-dlp
function cleanInstagramUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Keep only the canonical path (no query string, no hash)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}/`;
  } catch {
    return url;
  }
}

function proxyStream(directUrl: string, res: any, req: any) {
  const proto = directUrl.startsWith("https") ? https : http;
  const reqObj = proto.get(
    directUrl,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://www.tiktok.com/",
        Accept: "*/*",
      },
    },
    (upstream) => {
      if (upstream.headers["content-length"]) {
        res.setHeader("Content-Length", upstream.headers["content-length"]);
      }
      upstream.pipe(res);
      upstream.on("error", (err: Error) => {
        req.log?.error?.({ err }, "Upstream stream error");
        if (!res.headersSent) res.status(500).json({ error: "Stream failed" });
      });
    }
  );
  reqObj.on("error", (err: Error) => {
    req.log?.error?.({ err }, "Proxy request error");
    if (!res.headersSent) res.status(500).json({ error: "Failed to connect to video server" });
  });
}

// Scrape Instagram embed page to extract video URL (no API key required)
async function scrapeInstagramEmbed(url: string): Promise<{
  videoUrl: string;
  thumbnail: string;
  title: string;
}> {
  const shortcodeMatch = url.match(/\/(p|reel|tv|stories)\/([A-Za-z0-9_-]+)/);
  if (!shortcodeMatch) throw new Error("Invalid Instagram URL — could not extract post shortcode");
  const shortcode = shortcodeMatch[2];

  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/`;
  const res = await fetch(embedUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!res.ok) throw new Error(`Instagram embed returned ${res.status}`);
  const html = await res.text();

  // Try multiple extraction patterns
  const videoUrlMatch =
    html.match(/"video_url":"(https:[^"]+)"/) ||
    html.match(/video_url":"(https:\\u002F\\u002F[^"]+)"/) ||
    html.match(/<meta property="og:video"[^>]+content="([^"]+)"/i);

  if (!videoUrlMatch) throw new Error("No video URL found in Instagram embed — might be a photo post or private");

  const videoUrl = videoUrlMatch[1]
    .replace(/\\u0026/g, "&")
    .replace(/\\u002F/g, "/")
    .replace(/\\/g, "");

  const thumbnailMatch =
    html.match(/"display_url":"(https:[^"]+)"/) ||
    html.match(/<meta property="og:image"[^>]+content="([^"]+)"/i);
  const thumbnail = thumbnailMatch
    ? thumbnailMatch[1].replace(/\\u0026/g, "&").replace(/\\/g, "")
    : "";

  const captionMatch =
    html.match(/"accessibility_caption":"([^"]+)"/) ||
    html.match(/<meta property="og:description"[^>]+content="([^"]+)"/i) ||
    html.match(/"text":"([^"]{5,120})"/);
  const title = captionMatch ? captionMatch[1].slice(0, 120) : "Instagram Video";

  return { videoUrl, thumbnail, title };
}

// GET /api/detect?url=
router.get("/detect", (req, res) => {
  const { url } = req.query as { url?: string };
  if (!url) {
    res.status(400).json({ error: "URL required" });
    return;
  }
  res.json({ platform: detectPlatform(url) });
});

// GET /api/media/info?url=
router.get("/media/info", async (req, res) => {
  const { url } = req.query as { url?: string };
  if (!url) {
    res.status(400).json({ error: "URL required" });
    return;
  }

  const platform = detectPlatform(url);
  if (!platform || platform === "youtube") {
    res.status(400).json({ error: "Use the YouTube endpoint for YouTube videos" });
    return;
  }

  // ── TikTok — use TikWM API ──────────────────────────────────────────────
  if (platform === "tiktok") {
    try {
      const tikUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
      const response = await fetch(tikUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      });
      const data = (await response.json()) as {
        code: number;
        msg: string;
        data?: {
          title: string;
          cover: string;
          duration: number;
          play: string;
          wmplay: string;
          size: number;
          wm_size: number;
          author: { nickname: string; avatar: string };
        };
      };

      if (data.code !== 0 || !data.data) {
        res.status(500).json({ error: "Failed to fetch TikTok info", message: data.msg });
        return;
      }

      res.json({
        platform: "tiktok",
        title: data.data.title || "TikTok Video",
        thumbnail: data.data.cover,
        duration: data.data.duration,
        author: data.data.author?.nickname || "TikTok User",
        formats: [
          { formatId: "no_watermark", quality: "No Watermark", label: "Without Watermark ✅", filesize: data.data.size },
          { formatId: "with_watermark", quality: "With Watermark", label: "With Watermark", filesize: data.data.wm_size },
        ],
      });
    } catch (err) {
      req.log?.error?.({ err }, "TikWM API error");
      res.status(500).json({ error: "Failed to fetch TikTok video. It might be private or unavailable." });
    }
    return;
  }

  // ── Instagram — embed scraper + yt-dlp fallback ─────────────────────────
  if (platform === "instagram") {
    const cleanUrl = cleanInstagramUrl(url);

    // 1. Try yt-dlp first (with mobile Safari user-agent)
    try {
      const { stdout } = await execFileAsync(
        YT_DLP,
        [
          "--dump-json",
          "--no-playlist",
          "--no-warnings",
          "--no-check-certificates",
          "--add-header",
          "User-Agent:Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
          cleanUrl,
        ],
        { timeout: 25000 }
      );
      const info = JSON.parse(stdout.trim());
      res.json({
        platform: "instagram",
        title: (info.title || info.description || "Instagram Video").replace(/\n/g, " ").slice(0, 120),
        thumbnail: info.thumbnail,
        duration: info.duration || 0,
        author: info.uploader || info.channel || "Instagram",
        formats: [
          {
            formatId: "best",
            quality: "Best",
            label: "Best Quality (MP4)",
            filesize: info.filesize || info.filesize_approx,
          },
        ],
      });
      return;
    } catch (ytErr) {
      req.log?.warn?.({ ytErr }, "yt-dlp failed for Instagram, trying embed scraper");
    }

    // 2. Fallback: embed page scraper
    try {
      const scraped = await scrapeInstagramEmbed(cleanUrl);
      res.json({
        platform: "instagram",
        title: scraped.title,
        thumbnail: scraped.thumbnail,
        duration: 0,
        author: "Instagram",
        formats: [{ formatId: "embed", quality: "Best", label: "Best Quality (MP4)" }],
      });
    } catch (embedErr) {
      req.log?.error?.({ embedErr }, "Instagram embed scraper also failed");
      res
        .status(500)
        .json({ error: "Failed to fetch Instagram video. The content might be private or unavailable." });
    }
    return;
  }

  // ── Facebook — yt-dlp ───────────────────────────────────────────────────
  try {
    const { stdout } = await execFileAsync(
      YT_DLP,
      ["--dump-json", "--no-playlist", "--no-warnings", url],
      { timeout: 30000 }
    );

    const info = JSON.parse(stdout.trim());
    const formats: Array<{
      formatId: string;
      quality: string;
      label: string;
      filesize?: number;
      height?: number;
    }> = [];

    const combined = ((info.formats as any[]) || []).filter(
      (f: any) => f.acodec && f.acodec !== "none" && f.vcodec && f.vcodec !== "none"
    );
    combined.sort((a: any, b: any) => (b.height || 0) - (a.height || 0));

    const seen = new Set<string>();
    for (const f of combined) {
      const tier = (f.height || 0) >= 720 ? "HD" : "SD";
      if (!seen.has(tier)) {
        seen.add(tier);
        formats.push({
          formatId: f.format_id,
          quality: tier,
          label: `${tier} — ${f.height || "?"}p`,
          filesize: f.filesize || f.filesize_approx,
          height: f.height,
        });
      }
    }

    if (formats.length === 0) {
      formats.push({ formatId: "best", quality: "Best", label: "Best Available" });
    }

    res.json({
      platform: "facebook",
      title: (info.title || info.description || "Video").replace(/\n/g, " ").slice(0, 120).trim(),
      thumbnail: info.thumbnail,
      duration: info.duration,
      author: info.uploader || info.channel || "Unknown",
      formats,
    });
  } catch (err) {
    req.log?.error?.({ err }, "yt-dlp Facebook info failed");
    res.status(500).json({ error: "Failed to fetch video info. The content might be private or unavailable." });
  }
});

// GET /api/media/download?url=&formatId=&title=&quality=&noWatermark=
router.get("/media/download", async (req, res) => {
  const { url, formatId, title, quality, noWatermark } = req.query as {
    url?: string;
    formatId?: string;
    title?: string;
    quality?: string;
    noWatermark?: string;
  };

  if (!url) {
    res.status(400).json({ error: "URL required" });
    return;
  }

  const platform = detectPlatform(url);
  if (!platform || platform === "youtube") {
    res.status(400).json({ error: "Unsupported for this endpoint" });
    return;
  }

  const safeName =
    (title || "video")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 80) || "video";
  const filename = `${safeName}_${quality || "best"}.mp4`;

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "video/mp4");

  // ── TikTok ──────────────────────────────────────────────────────────────
  if (platform === "tiktok") {
    try {
      const tikUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
      const apiRes = await fetch(tikUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      const data = (await apiRes.json()) as {
        code: number;
        data?: { play: string; wmplay: string };
      };

      if (data.code !== 0 || !data.data) {
        res.status(500).json({ error: "Failed to get TikTok download URL" });
        return;
      }

      const useNoWatermark = formatId === "no_watermark" || noWatermark !== "false";
      const directUrl = useNoWatermark ? data.data.play : data.data.wmplay;
      proxyStream(directUrl, res, req);
    } catch (err) {
      req.log?.error?.({ err }, "TikTok download error");
      if (!res.headersSent) res.status(500).json({ error: "Download failed" });
    }
    return;
  }

  // ── Instagram ────────────────────────────────────────────────────────────
  if (platform === "instagram") {
    const cleanUrl = cleanInstagramUrl(url);

    // If formatId is "embed", we got info from the embed scraper — use it again
    if (formatId === "embed") {
      try {
        const scraped = await scrapeInstagramEmbed(cleanUrl);
        proxyStream(scraped.videoUrl, res, req);
        return;
      } catch (err) {
        req.log?.error?.({ err }, "Instagram embed download failed");
        if (!res.headersSent) res.status(500).json({ error: "Download failed" });
        return;
      }
    }

    // Otherwise try yt-dlp first
    try {
      const { stdout } = await execFileAsync(
        YT_DLP,
        [
          "-f",
          "best[ext=mp4]/best",
          "--get-url",
          "--no-playlist",
          "--no-warnings",
          "--no-check-certificates",
          "--add-header",
          "User-Agent:Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
          cleanUrl,
        ],
        { timeout: 25000 }
      );
      const directUrl = stdout.trim().split("\n").filter(Boolean)[0];
      if (!directUrl) throw new Error("No URL from yt-dlp");
      proxyStream(directUrl, res, req);
      return;
    } catch (ytErr) {
      req.log?.warn?.({ ytErr }, "yt-dlp download failed for Instagram, trying embed scraper");
    }

    // Fallback: embed scraper
    try {
      const scraped = await scrapeInstagramEmbed(cleanUrl);
      proxyStream(scraped.videoUrl, res, req);
    } catch (err) {
      req.log?.error?.({ err }, "Instagram download both methods failed");
      if (!res.headersSent) res.status(500).json({ error: "Failed to download Instagram video" });
    }
    return;
  }

  // ── Facebook — yt-dlp ────────────────────────────────────────────────────
  // Map simple quality names to yt-dlp format selectors
  const fmtMap: Record<string, string> = {
    best: "best[ext=mp4]/best",
    worst: "worst[ext=mp4]/worst",
    HD: "best[ext=mp4]/best",
    SD: "worst[ext=mp4]/worst",
  };
  const fmtSelector =
    (formatId && fmtMap[formatId]) ||
    (formatId && formatId !== "best" && formatId !== "worst" ? formatId : "best[ext=mp4]/best");

  try {
    const { stdout } = await execFileAsync(
      YT_DLP,
      ["-f", fmtSelector, "--get-url", "--no-playlist", "--no-warnings", url],
      { timeout: 30000 }
    );
    const directUrl = stdout.trim().split("\n").filter(Boolean)[0];
    if (!directUrl) {
      res.status(500).json({ error: "No download URL found" });
      return;
    }
    proxyStream(directUrl, res, req);
  } catch (err) {
    req.log?.error?.({ err }, "Facebook download failed");
    if (!res.headersSent) res.status(500).json({ error: "Failed to download video" });
  }
});

export default router;
