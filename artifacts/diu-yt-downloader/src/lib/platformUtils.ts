export type Platform = "youtube" | "facebook" | "instagram" | "tiktok";

export function detectPlatform(url: string): Platform | null {
  if (/youtu(be\.com|\.be)/i.test(url)) return "youtube";
  if (/facebook\.com|fb\.watch|m\.facebook\.com/i.test(url)) return "facebook";
  if (/instagram\.com/i.test(url)) return "instagram";
  if (/tiktok\.com/i.test(url)) return "tiktok";
  return null;
}

export function formatDuration(seconds?: number): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const PLATFORM_CONFIG = {
  youtube: {
    label: "YouTube",
    color: "#FF0000",
    bgClass: "bg-[#FF0000]",
    textClass: "text-[#FF0000]",
    borderClass: "border-[#FF0000]",
    ringClass: "ring-[#FF0000]",
    lightBgClass: "bg-red-50 dark:bg-red-950/20",
    placeholder: "Paste YouTube video link here...",
  },
  facebook: {
    label: "Facebook",
    color: "#1877F2",
    bgClass: "bg-[#1877F2]",
    textClass: "text-[#1877F2]",
    borderClass: "border-[#1877F2]",
    ringClass: "ring-[#1877F2]",
    lightBgClass: "bg-blue-50 dark:bg-blue-950/20",
    placeholder: "Paste Facebook video or reel link here...",
  },
  instagram: {
    label: "Instagram",
    color: "#C13584",
    bgClass: "bg-gradient-to-r from-[#f09433] to-[#bc1888]",
    textClass: "text-[#C13584]",
    borderClass: "border-[#C13584]",
    ringClass: "ring-[#C13584]",
    lightBgClass: "bg-pink-50 dark:bg-pink-950/20",
    placeholder: "Paste Instagram reel or post link here...",
  },
  tiktok: {
    label: "TikTok",
    color: "#EE1D52",
    bgClass: "bg-black",
    textClass: "text-[#EE1D52]",
    borderClass: "border-[#EE1D52]",
    ringClass: "ring-[#EE1D52]",
    lightBgClass: "bg-gray-50 dark:bg-gray-950/20",
    placeholder: "Paste TikTok video link here...",
  },
} as const;
