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
// Returns metadata for Facebook, Instagram, and TikTok videos
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
          {
            formatId: "no_watermark",
            quality: "No Watermark",
            label: "Without Watermark ✅",
            filesize: data.data.size,
          },
          {
            formatId: "with_watermark",
            quality: "With Watermark",
            label: "With Watermark",
            filesize: data.data.wm_size,
          },
        ],
      });
    } catch (err) {
      req.log?.error?.({ err }, "TikWM API error");
      res.status(500).json({ error: "Failed to fetch TikTok video. It might be private or unavailable." });
    }
    return;
  }

  // Facebook / Instagram — use yt-dlp
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

    if (platform === "facebook") {
      // Find combined video+audio streams
      const combined = ((info.formats as any[]) || []).filter(
        (f: any) =>
          f.acodec && f.acodec !== "none" && f.vcodec && f.vcodec !== "none"
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
        formats.push({
          formatId: "best",
          quality: "Best",
          label: "Best Available",
          filesize: info.filesize || info.filesize_approx,
        });
      }
    } else {
      // Instagram — best quality
      formats.push({
        formatId: "best",
        quality: "Best",
        label: "Best Quality (MP4)",
        filesize: info.filesize || info.filesize_approx,
      });
    }

    const title = (info.title || info.description || "Video")
      .replace(/\n/g, " ")
      .slice(0, 120)
      .trim();

    res.json({
      platform,
      title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      author: info.uploader || info.channel || info.uploader_id || "Unknown",
      formats,
    });
  } catch (err: unknown) {
    req.log?.error?.({ err }, "yt-dlp media/info failed");
    res
      .status(500)
      .json({ error: "Failed to fetch video info. The content might be private or unavailable." });
  }
});

// GET /api/media/download?url=&formatId=&title=&quality=&noWatermark=
// Downloads a video from Facebook, Instagram, or TikTok
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

  const safeName = (title || "video")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80) || "video";
  const filename = `${safeName}_${quality || "best"}.mp4`;

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "video/mp4");

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

  // Facebook / Instagram — get direct URL via yt-dlp then proxy
  const fmtSelector =
    formatId && formatId !== "best" ? formatId : "best[ext=mp4]/best";

  try {
    const { stdout } = await execFileAsync(
      YT_DLP,
      ["-f", fmtSelector, "--get-url", "--no-playlist", "--no-warnings", url],
      { timeout: 30000 }
    );

    const urls = stdout.trim().split("\n").filter(Boolean);
    const directUrl = urls[0];

    if (!directUrl) {
      res.status(500).json({ error: "No download URL found" });
      return;
    }

    proxyStream(directUrl, res, req);
  } catch (err) {
    req.log?.error?.({ err }, "Media download error");
    if (!res.headersSent) res.status(500).json({ error: "Failed to download video" });
  }
});

export default router;
