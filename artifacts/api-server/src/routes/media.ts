import { Router, type IRouter } from "express";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import https from "https";
import http from "http";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const execFileAsync = promisify(execFile);
const YT_DLP = path.join(__dirname, "..", "yt-dlp" + (process.platform === "win32" ? ".exe" : ""));

const router: IRouter = Router();

export type Platform = "youtube" | "facebook" | "instagram" | "tiktok";

export function detectPlatform(url: string): Platform | null {
  if (/youtu(be\.com|\.be)/i.test(url)) return "youtube";
  if (/facebook\.com|fb\.watch|m\.facebook\.com/i.test(url)) return "facebook";
  if (/instagram\.com/i.test(url)) return "instagram";
  if (/tiktok\.com/i.test(url)) return "tiktok";
  return null;
}

// Strip only known tracking params from Instagram URLs
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
    parsed.pathname = parsed.pathname.replace(/\/$/, "");
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function extractInstagramShortcode(url: string): string | null {
  const m = url.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[2] : null;
}

// Proxy a video stream from a CDN URL to the HTTP response.
function proxyStream(directUrl: string, res: any, req: any, referer = "") {
  const MAX_REDIRECTS = 5;

  function doRequest(url: string, redirectsLeft: number) {
    const proto = url.startsWith("https") ? https : http;
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "*/*",
    };
    if (referer) headers["Referer"] = referer;

    const reqObj = proto.get(url, { headers }, (upstream) => {
      const status = upstream.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        const location = upstream.headers.location;
        upstream.destroy();
        if (location && redirectsLeft > 0) {
          const next = location.startsWith("http") ? location : new URL(location, url).toString();
          doRequest(next, redirectsLeft - 1);
          return;
        }
        if (!res.headersSent) res.status(502).json({ error: "Too many redirects from CDN" });
        return;
      }

      if (status < 200 || status >= 300) {
        upstream.destroy();
        if (!res.headersSent) res.status(502).json({ error: `CDN error: HTTP ${status}` });
        return;
      }

      if (upstream.headers["content-length"]) {
        res.setHeader("Content-Length", upstream.headers["content-length"]);
      }
      upstream.pipe(res);
      upstream.on("error", (err: Error) => {
        if (!res.headersSent) res.status(500).json({ error: "Stream failed" });
      });
    });

    reqObj.on("error", (err: Error) => {
      if (!res.headersSent) res.status(500).json({ error: "Failed to connect to video server" });
    });
    req.on("close", () => reqObj.destroy());
  }

  doRequest(directUrl, MAX_REDIRECTS);
}

// Fetch Instagram video info via embed page scraping (no login needed for public posts)
async function fetchInstagramViaEmbed(url: string): Promise<{
  downloadUrl: string;
  thumbnail: string;
  title: string;
  duration: number;
  author: string;
}> {
  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) throw new Error("Could not extract Instagram shortcode");

  // Use the public embed endpoint - works without login for public posts
  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
  
  const response = await fetch(embedUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Sec-Fetch-Dest": "iframe",
      "Sec-Fetch-Mode": "navigate",
    },
  });

  if (!response.ok) {
    throw new Error(`Instagram embed returned ${response.status}`);
  }

  const html = await response.text();

  // Extract video URL
  const videoUrlMatch = html.match(/https:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/g);
  if (!videoUrlMatch || videoUrlMatch.length === 0) {
    // Try looking for video_url in JSON
    const jsonMatch = html.match(/"video_url":"(https:[^"]+)"/);
    if (!jsonMatch) {
      throw new Error("Could not extract video URL from Instagram embed");
    }
    const videoUrl = jsonMatch[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
    const thumbMatch = html.match(/"thumbnail_src":"([^"]+)"/);
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return {
      downloadUrl: videoUrl,
      thumbnail: thumbMatch ? thumbMatch[1].replace(/\\/g, "") : "",
      title: titleMatch ? titleMatch[1].replace(/ • Instagram$/, "").trim() : "Instagram Video",
      duration: 0,
      author: "Instagram",
    };
  }

  const videoUrl = videoUrlMatch[0];
  const thumbMatch = html.match(/https:\/\/[^\s"'<>\\]+\.(jpg|jpeg|png)[^\s"'<>\\]*/);
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const authorMatch = html.match(/<a[^>]+class="[^"]*UsernameText[^"]*"[^>]*>([^<]+)<\/a>/i)
    || html.match(/class="[^"]*author[^"]*"[^>]*>([^<]+)</i);

  return {
    downloadUrl: videoUrl,
    thumbnail: thumbMatch ? thumbMatch[0] : "",
    title: titleMatch ? titleMatch[1].replace(/ • Instagram$/, "").trim() : "Instagram Video",
    duration: 0,
    author: authorMatch ? authorMatch[1].trim() : "Instagram",
  };
}

// Try multiple Instagram download APIs sequentially
async function fetchInstagramViaThirdParty(url: string, reqLog: any): Promise<{
  downloadUrl: string;
  thumbnail: string;
  title: string;
  duration: number;
  author: string;
}> {
  const cleanUrl = url;
  
  // Method 1: SaveIG
  try {
    const res = await fetch("https://v3.igdownloader.app/api/ajaxSearch", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": "https://igdownloader.app",
        "Referer": "https://igdownloader.app/"
      },
      body: new URLSearchParams({ q: cleanUrl, t: "media", lang: "en" }).toString(),
    });
    const data = await res.json() as any;
    if (data.status === "ok" && data.data) {
      const html = data.data;
      const downloadMatch = html.match(/href="([^"]+)"[^>]*>Download Video/i) || html.match(/href="([^"]+)"[^>]*>Download/i);
      const thumbMatch = html.match(/src="([^"]+)"/i);
      if (downloadMatch) {
        return {
          downloadUrl: downloadMatch[1].replace(/&amp;/g, "&"),
          thumbnail: thumbMatch ? thumbMatch[1].replace(/&amp;/g, "&") : "",
          title: "Instagram Video",
          duration: 0,
          author: "Instagram",
        };
      }
    }
  } catch (e) {
    reqLog?.info?.("SaveIG method failed");
  }

  // Method 2: FastDl (formerly iGram)
  try {
    const res = await fetch("https://fastdl.app/api/convert", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
        "Origin": "https://fastdl.app",
        "Referer": "https://fastdl.app/",
      },
      body: JSON.stringify({ url: cleanUrl }),
    });
    const data = await res.json() as any;
    if (data.url && Array.isArray(data.url) && data.url.length > 0) {
      const video = data.url.find((v: any) => v.type === "mp4" || v.ext === "mp4") || data.url[0];
      if (video && video.url) {
        return {
          downloadUrl: video.url,
          thumbnail: data.meta?.thumb || data.thumb || "",
          title: data.meta?.title || "Instagram Video",
          duration: 0,
          author: "Instagram",
        };
      }
    }
  } catch (e) {
    reqLog?.info?.("FastDl method failed");
  }

  // Method 3: SnapSave fallback
  const vm = require("vm") as typeof import("vm");
  const body = new URLSearchParams({ url: cleanUrl }).toString();
  const response = await fetch("https://snapsave.app/action.php", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://snapsave.app/",
      Origin: "https://snapsave.app",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36",
    },
    body,
  });

  if (!response.ok) throw new Error(`SnapSave request failed: ${response.status}`);
  const rawJs = await response.text();
  if (!rawJs || rawJs.trim().startsWith("<!")) throw new Error("SnapSave returned non-JS response");

  let decodedHtml = "";
  const ctx = { eval: (c: string) => { decodedHtml = c; }, decodeURIComponent, escape, String, Math, RegExp };
  vm.runInNewContext(rawJs, ctx, { timeout: 5000 });

  if (!decodedHtml || decodedHtml.includes("Error:") || decodedHtml.includes("Unable to connect")) {
    throw new Error("SnapSave could not process this Instagram URL");
  }

  const allLinks: string[] = decodedHtml.match(/https:\/\/d\.rapidcdn\.app\/[^\s"'<>\\]+/g) ?? [];
  const thumbUrl = allLinks.find((l) => l.includes("/thumb")) ?? "";
  const videoUrl = allLinks.find((l) => l.includes("/v2"));

  if (!videoUrl) throw new Error("Could not extract video URL from SnapSave response");

  const altMatch = decodedHtml.match(/alt="([^"]{5,120})"/);
  return {
    downloadUrl: videoUrl,
    thumbnail: thumbUrl,
    title: altMatch ? altMatch[1] : "Instagram Reel",
    duration: 0,
    author: "Instagram",
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

  // ── Instagram — try embed scraping first, then SnapSave as fallback ──────
  if (platform === "instagram") {
    const cleanUrl = cleanInstagramUrl(url);
    
    // Try embed scraping first
    try {
      const igData = await fetchInstagramViaEmbed(cleanUrl);
      res.json({
        platform: "instagram",
        title: igData.title.replace(/\n/g, " ").slice(0, 120),
        thumbnail: igData.thumbnail,
        duration: igData.duration,
        author: igData.author,
        downloadUrl: igData.downloadUrl,
        formats: [
          {
            formatId: "embed",
            quality: "Best",
            label: "Best Quality (MP4)",
          },
        ],
      });
      return;
    } catch (embedErr) {
      req.log?.info?.({ embedErr }, "Instagram embed scraping failed, trying SnapSave");
    }

    // Fallback: SnapSave
    try {
      const igData = await fetchInstagramViaThirdParty(cleanUrl, req.log);
      res.json({
        platform: "instagram",
        title: igData.title.replace(/\n/g, " ").slice(0, 120),
        thumbnail: igData.thumbnail,
        duration: igData.duration,
        author: igData.author,
        downloadUrl: igData.downloadUrl,
        formats: [
          {
            formatId: "snapsave",
            quality: "Best",
            label: "Best Quality (MP4)",
          },
        ],
      });
      return;
    } catch (err) {
      req.log?.error?.({ err }, "All Instagram fetch methods failed");
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
      ["--dump-json", "--no-playlist", "--no-warnings",
       "--no-check-certificate",
       "--add-header", "Accept-Language:en-US,en;q=0.9",
       url],
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
  } catch (err: any) {
    req.log?.error?.({ err }, "yt-dlp Facebook info failed");
    // Try to give a more helpful error message
    const errMsg = err?.message || "";
    if (errMsg.includes("private") || errMsg.includes("login")) {
      res.status(500).json({ error: "This video is private or requires login to view." });
    } else {
      res.status(500).json({ error: "Failed to fetch video info. The content might be private or unavailable." });
    }
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
      proxyStream(directUrl, res, req, "https://www.tiktok.com/");
    } catch (err) {
      req.log?.error?.({ err }, "TikTok download error");
      if (!res.headersSent) res.status(500).json({ error: "Download failed" });
    }
    return;
  }

  // ── Instagram — try embed then SnapSave ───────────────────────────────────
  if (platform === "instagram") {
    const cleanUrl = cleanInstagramUrl(url);

    // Try embed first
    try {
      const igData = await fetchInstagramViaEmbed(cleanUrl);
      proxyStream(igData.downloadUrl, res, req, "https://www.instagram.com/");
      return;
    } catch (embedErr) {
      req.log?.info?.({ embedErr }, "Instagram embed download failed, trying SnapSave");
    }

    // Fallback: multiple 3rd party APIs
    try {
      const igData = await fetchInstagramViaThirdParty(cleanUrl, req.log);
      proxyStream(igData.downloadUrl, res, req, "https://igdownloader.app/");
      return;
    } catch (err) {
      req.log?.error?.({ err }, "All Instagram download methods failed");
      if (!res.headersSent)
        res.status(500).json({ error: "Could not fetch this video. Make sure the account is public and the link is valid." });
    }
    return;
  }

  // ── Facebook — yt-dlp piped to stdout ────────────────────────────────────
  const fmtMap: Record<string, string> = {
    best: "best[ext=mp4]/best",
    worst: "worst[ext=mp4]/worst",
    HD: "best[ext=mp4]/best",
    SD: "worst[ext=mp4]/worst",
  };
  const fmtSelector =
    (formatId && fmtMap[formatId]) ||
    (formatId && formatId !== "best" && formatId !== "worst" ? formatId : "best[ext=mp4]/best");

  const ytdlpProcess = spawn(YT_DLP, [
    "-f", fmtSelector,
    "-o", "-",
    "--no-playlist",
    "--no-warnings",
    "--no-check-certificate",
    "--add-header", "Accept-Language:en-US,en;q=0.9",
    url,
  ]);

  let clientGone = false;
  req.on("close", () => {
    clientGone = true;
    if (!ytdlpProcess.killed) ytdlpProcess.kill();
  });

  ytdlpProcess.stdout.pipe(res);

  ytdlpProcess.stderr.on("data", (chunk: Buffer) => {
    req.log?.info?.({ stderr: chunk.toString() }, "Facebook yt-dlp progress");
  });

  ytdlpProcess.on("error", (err: Error) => {
    req.log?.error?.({ err }, "Facebook yt-dlp spawn error");
    if (!res.headersSent) res.status(500).json({ error: "Failed to download video" });
  });

  ytdlpProcess.on("close", (code: number) => {
    if (clientGone) return;
    if (code !== 0) {
      req.log?.error?.({ code }, "Facebook yt-dlp exited with non-zero code");
    }
  });
});

export default router;
