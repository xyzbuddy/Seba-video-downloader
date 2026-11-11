export type Platform = "youtube" | "facebook" | "instagram" | "tiktok";

export const PLATFORMS: Platform[] = ["youtube", "facebook", "instagram", "tiktok"];

interface PlatformMeta {
  name: string;
  /** CSS variable holding the brand color */
  color: string;
  domains: string[];
  path: string;
  /** Page headline when this platform's page is open */
  headline: string;
  /** Intro under the headline on this platform's page */
  intro: string;
  /** Where to find the link, in that platform's own words */
  findLink: string;
  example: string;
}

export const PLATFORM_META: Record<Platform, PlatformMeta> = {
  youtube: {
    name: "YouTube",
    color: "var(--yt)",
    domains: ["youtube.com", "youtu.be"],
    path: "/youtube",
    headline: "Save YouTube videos, Shorts and audio.",
    intro: "Choose any quality the upload has, from 360p to 4K, or save just the sound as an M4A file.",
    findLink: "On a video or Short, tap Share, then Copy link. On a computer, copy the address bar.",
    example: "https://youtu.be/…",
  },
  facebook: {
    name: "Facebook",
    color: "var(--fb)",
    domains: ["facebook.com", "fb.watch", "fb.com"],
    path: "/facebook",
    headline: "Save Facebook videos and reels.",
    intro: "Works with public videos, reels and Watch links. Pick HD when the upload has it.",
    findLink: "Tap Share on the video, then Copy link. Links from posts limited to friends or groups won't work.",
    example: "https://www.facebook.com/reel/…",
  },
  instagram: {
    name: "Instagram",
    color: "var(--ig)",
    domains: ["instagram.com"],
    path: "/instagram",
    headline: "Save Instagram reels and video posts.",
    intro: "Paste a reel or video post from a public account and save it in the best quality Instagram serves.",
    findLink: "Tap the paper-plane icon under the reel, then Copy link.",
    example: "https://www.instagram.com/reel/…",
  },
  tiktok: {
    name: "TikTok",
    color: "var(--tt)",
    domains: ["tiktok.com"],
    path: "/tiktok",
    headline: "Save TikTok videos without the watermark.",
    intro: "Keep the clean original, the watermarked version, or just the sound.",
    findLink: "Tap Share on the video, then Copy link.",
    example: "https://www.tiktok.com/@user/video/…",
  },
};

const BLOCKED_HOSTS = new Set(["l.facebook.com", "lm.facebook.com"]);

export function parseLink(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** Platform from the link's real hostname; mirrors the server's check. */
export function detectPlatform(raw: string): Platform | null {
  const u = parseLink(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return null;
  for (const p of PLATFORMS) {
    if (PLATFORM_META[p].domains.some((d) => host === d || host.endsWith("." + d))) return p;
  }
  return null;
}
