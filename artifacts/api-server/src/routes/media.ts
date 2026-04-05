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

// Strip only known tracking params from Instagram URLs — keep the rest intact
// so TikWM can still parse the reel/post shortcode correctly.
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "fbclid", "igsh", "igshid", "ref",
]);

function cleanInstagramUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key)) parsed.searchParams.delete(key);
    }
    // Remove trailing slash from path for consistency
    parsed.pathname = parsed.pathname.replace(/\/$/, "");
    parsed.hash = "";
    return parsed.toString();
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

// Fetch Instagram video info via TikWM API
async function fetchInstagramViaTikwm(url: string): Promise<{
  downloadUrl: string;
  thumbnail: string;
  title: string;
  duration: number;
  author: string;
}> {
  const tikUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
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
      author: { nickname: string };
      size: number;
    };
  };

  if (data.code !== 0 || !data.data) {
    throw new Error(data.msg || "TikWM API returned an error");
  }

  return {
    downloadUrl: data.data.play,
    thumbnail: data.data.cover,
    title: data.data.title || "Instagram Video",
    duration: data.data.duration || 0,
    author: data.data.author?.nickname || "Instagram",
  };
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

  // ── Instagram — TikWM API ───────────────────────────────────────────────
  if (platform === "instagram") {
    const cleanUrl = cleanInstagramUrl(url);
    try {
      const igData = await fetchInstagramViaTikwm(cleanUrl);
      res.json({
        platform: "instagram",
        title: igData.title.replace(/\n/g, " ").slice(0, 120),
        thumbnail: igData.thumbnail,
        duration: igData.duration,
        author: igData.author,
        downloadUrl: igData.downloadUrl,
        formats: [
          {
            formatId: "tikwm",
            quality: "Best",
            label: "Best Quality (MP4)",
          },
        ],
      });
    } catch (err) {
      req.log?.error?.({ err }, "TikWM Instagram fetch failed");
      res
        .status(500)
        .json({ error: "Could not fetch this video. Make sure the account is public and the link is valid." });
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

  // ── Instagram — TikWM API ────────────────────────────────────────────────
  if (platform === "instagram") {
    const cleanUrl = cleanInstagramUrl(url);
    try {
      const igData = await fetchInstagramViaTikwm(cleanUrl);
      proxyStream(igData.downloadUrl, res, req);
    } catch (err) {
      req.log?.error?.({ err }, "Instagram TikWM download failed");
      if (!res.headersSent)
        res.status(500).json({ error: "Could not fetch this video. Make sure the account is public and the link is valid." });
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
