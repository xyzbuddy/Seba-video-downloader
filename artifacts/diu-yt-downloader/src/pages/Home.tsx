import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, ArrowRight, Download } from "lucide-react";
import { detectPlatform, isValidYoutubeUrl, formatDuration, formatFileSize, type Platform } from "@/lib/platformUtils";
import { useToast } from "@/hooks/use-toast";
import { Spinner } from "@/components/ui/spinner";
import { useGetVideoInfo, getGetVideoInfoQueryKey } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { downloadFile } from "@/lib/downloadFile";
import { useTheme } from "@/contexts/ThemeContext";

const PLATFORM_INFO: Record<Platform, { label: string; color: string; badgeBg: string; badgeText: string; desc: string }> = {
  youtube: { label: "YouTube", color: "#FF0000", badgeBg: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900", badgeText: "text-red-600 dark:text-red-400", desc: "480p · 720p · 1080p · 4K" },
  facebook: { label: "Facebook", color: "#1877F2", badgeBg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900", badgeText: "text-blue-600 dark:text-blue-400", desc: "HD and SD quality" },
  instagram: { label: "Instagram", color: "#E1306C", badgeBg: "bg-pink-50 dark:bg-pink-950/30 border-pink-200 dark:border-pink-900", badgeText: "text-pink-600 dark:text-pink-400", desc: "Best quality MP4" },
  tiktok: { label: "TikTok", color: "#EE1D52", badgeBg: "bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700", badgeText: "text-gray-900 dark:text-white", desc: "Without or with watermark" },
};

const PLATFORM_CARDS = [
  { id: "youtube" as Platform, label: "YouTube Downloader", iconText: "▶", iconBg: "#FF0000", desc: "480p · 720p · 1080p · 4K" },
  { id: "facebook" as Platform, label: "Facebook Downloader", iconText: "f", iconBg: "#1877F2", desc: "HD and SD quality" },
  { id: "instagram" as Platform, label: "Instagram Downloader", iconText: "◎", iconBg: "linear-gradient(135deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)", desc: "Reels, posts in best quality" },
  { id: "tiktok" as Platform, label: "TikTok Downloader", iconText: "♪", iconBg: "#000", desc: "Without watermark support" },
];

type MediaInfo = {
  platform: string;
  title: string;
  thumbnail?: string;
  duration?: number;
  author?: string;
  formats: { formatId: string; quality: string; label: string; filesize?: number }[];
};

async function fetchMediaInfo(url: string): Promise<MediaInfo> {
  const res = await fetch(`/api/media/info?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || "Failed to fetch video info");
  }
  return res.json();
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [detected, setDetected] = useState<Platform | null>(null);
  const [ytFetchUrl, setYtFetchUrl] = useState("");
  const [mediaFetchUrl, setMediaFetchUrl] = useState("");
  const [ytSelectedFormat, setYtSelectedFormat] = useState<string | null>(null);
  const [mediaSelectedFormat, setMediaSelectedFormat] = useState<string | null>(null);
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [aboutCollapsedHeight, setAboutCollapsedHeight] = useState(120);
  const aboutFirstParaRef = useRef<HTMLParagraphElement>(null);
  const { theme } = useTheme();

  const measureAbout = useCallback(() => {
    if (aboutFirstParaRef.current) {
      const paraHeight = aboutFirstParaRef.current.getBoundingClientRect().height;
      setAboutCollapsedHeight(paraHeight + 8);
    }
  }, []);

  useEffect(() => {
    measureAbout();
    window.addEventListener("resize", measureAbout);
    return () => window.removeEventListener("resize", measureAbout);
  }, [measureAbout]);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const handleChange = (val: string) => {
    setUrl(val);
    const platform = detectPlatform(val.trim()) || null;
    if (platform !== detected) {
      setMediaFetchUrl("");
      setMediaSelectedFormat(null);
      setYtFetchUrl("");
      setYtSelectedFormat(null);
    }
    setDetected(platform);
  };

  const handleClear = () => {
    setUrl("");
    setDetected(null);
    setYtFetchUrl("");
    setMediaFetchUrl("");
    setYtSelectedFormat(null);
    setMediaSelectedFormat(null);
  };

  const handlePaste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        handleChange(text);
        if (!detectPlatform(text)) {
          toast({ title: "Not a supported link", description: "Please paste a YouTube, Facebook, Instagram, or TikTok URL.", variant: "destructive" });
        }
      } else {
        toast({ title: "Clipboard is empty", description: "Copy a video link first, then click Paste." });
      }
    } catch {
      toast({ title: "Clipboard access denied", description: "Please paste the link directly into the field.", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (detected !== "youtube") { setYtFetchUrl(""); return; }
    const t = setTimeout(() => {
      const trimmed = url.trim();
      if (isValidYoutubeUrl(trimmed)) setYtFetchUrl(trimmed);
    }, 400);
    return () => clearTimeout(t);
  }, [url, detected]);

  useEffect(() => {
    if (!detected || detected === "youtube") { setMediaFetchUrl(""); return; }
    const t = setTimeout(() => {
      const trimmed = url.trim();
      if (trimmed) setMediaFetchUrl(trimmed);
    }, 400);
    return () => clearTimeout(t);
  }, [url, detected]);

  const { data: ytInfo, isLoading: ytLoading, isError: ytError } = useGetVideoInfo(
    { url: ytFetchUrl },
    { query: { enabled: !!ytFetchUrl, queryKey: getGetVideoInfoQueryKey({ url: ytFetchUrl }), retry: 1 } }
  );

  const { data: mediaInfo, isLoading: mediaLoading, isError: mediaError } = useQuery({
    queryKey: ["home-media-info", mediaFetchUrl],
    queryFn: () => fetchMediaInfo(mediaFetchUrl),
    enabled: !!mediaFetchUrl,
    retry: 1,
  });

  useEffect(() => {
    if (ytInfo?.formats?.length) {
      const preferred = ytInfo.formats.find(f => f.formatId === "height_1080") || ytInfo.formats[0];
      setYtSelectedFormat(preferred.formatId);
    } else {
      setYtSelectedFormat(null);
    }
  }, [ytInfo]);

  useEffect(() => {
    if (mediaInfo?.formats?.length && detected !== "tiktok") {
      setMediaSelectedFormat(mediaInfo.formats[0].formatId);
    } else if (detected === "tiktok") {
      setMediaSelectedFormat("no_watermark");
    } else {
      setMediaSelectedFormat(null);
    }
  }, [mediaInfo, detected]);

  const selectedYtFormat = useMemo(() => {
    if (!ytInfo || !ytSelectedFormat) return null;
    return ytInfo.formats.find(f => f.formatId === ytSelectedFormat);
  }, [ytInfo, ytSelectedFormat]);

  const selectedMediaFormat = useMemo(() => {
    if (!mediaInfo || !mediaSelectedFormat) return null;
    return mediaInfo.formats.find(f => f.formatId === mediaSelectedFormat);
  }, [mediaInfo, mediaSelectedFormat]);

  const handleYtDownload = () => {
    if (!selectedYtFormat || !ytFetchUrl) return;
    const params = new URLSearchParams({
      url: ytFetchUrl,
      formatId: ytSelectedFormat || "",
      quality: selectedYtFormat.quality,
      title: ytInfo?.title || "video",
    });
    const safeTitle = (ytInfo?.title || "video").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 80) || "video";
    downloadFile(`/api/youtube/download?${params.toString()}`, `${safeTitle}.mp4`);
    toast({ title: "Download started", description: `Preparing ${selectedYtFormat.quality} — this may take a moment.` });
  };

  const handleMediaDownload = () => {
    if (!mediaInfo || !mediaFetchUrl || !mediaSelectedFormat) return;
    const fmt = selectedMediaFormat;
    const isTikTok = detected === "tiktok";
    const noWatermark = isTikTok && mediaSelectedFormat === "no_watermark";
    const params = new URLSearchParams({
      url: mediaFetchUrl,
      formatId: mediaSelectedFormat,
      title: mediaInfo.title || `${detected}_video`,
      quality: isTikTok ? (noWatermark ? "NoWatermark" : "WithWatermark") : (fmt?.quality || "Best"),
    });
    if (isTikTok) params.set("noWatermark", noWatermark ? "true" : "false");
    const safeTitle = (mediaInfo.title || `${detected}_video`).replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_").slice(0, 80) || "video";
    downloadFile(`/api/media/download?${params.toString()}`, `${safeTitle}.mp4`);
    toast({ title: "Download started", description: "Preparing your download..." });
  };

  const platformInfo = detected ? PLATFORM_INFO[detected] : null;
  const isLoading = detected === "youtube" ? ytLoading : mediaLoading;
  const isError = detected === "youtube" ? ytError : mediaError;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />

      <main>
        {/* Hero */}
        <section className="pt-32 pb-20 px-4">
          <div className="max-w-3xl mx-auto text-center">
            <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4 leading-tight">
                Seba Downloader —{" "}<span className="text-green-600">Download Videos</span>{" "}Free &amp; Fast
              </h1>
              <p className="text-gray-500 dark:text-gray-400 text-lg mb-10">
                Paste any YouTube, Facebook, Instagram or TikTok link below
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
              <div className="flex items-center gap-2 bg-white dark:bg-gray-900 rounded-2xl border-2 border-gray-200 dark:border-gray-700 shadow-lg focus-within:border-green-500 dark:focus-within:border-green-500 transition-colors p-2">
                <Search className="w-5 h-5 text-gray-400 ml-2 flex-shrink-0" />
                <input
                  type="url"
                  value={url}
                  onChange={(e) => handleChange(e.target.value)}
                  placeholder="Paste your video link here..."
                  className="flex-1 bg-transparent outline-none text-gray-900 dark:text-white placeholder:text-gray-400 text-base py-2 px-1"
                  autoFocus
                />
                <AnimatePresence>
                  {url && (
                    <motion.button type="button" key="clear" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.12 }} onClick={handleClear} className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                      <X className="w-4 h-4" />
                    </motion.button>
                  )}
                </AnimatePresence>
                <button type="button" onClick={handlePaste} className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors whitespace-nowrap">
                  Paste
                </button>
              </div>

              <AnimatePresence mode="wait">
                {detected && platformInfo ? (
                  <motion.div key={detected} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className="mt-5 flex flex-col items-center gap-4">
                    <span className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium border ${platformInfo.badgeBg} ${platformInfo.badgeText}`}>
                      <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: platformInfo.color }} />
                      {platformInfo.label} link detected · {platformInfo.desc}
                    </span>

                    {/* Loading skeleton */}
                    {isLoading && (
                      <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 flex gap-6 shadow">
                        <div className={`bg-gray-200 dark:bg-gray-800 rounded-xl animate-pulse flex-shrink-0 ${detected === "tiktok" ? "w-36 h-48" : "w-48 h-28"}`} />
                        <div className="flex-1 space-y-3 pt-2">
                          <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-3/4" />
                          <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-1/2" />
                          <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-1/3" />
                        </div>
                      </div>
                    )}

                    {/* Error state */}
                    {isError && !isLoading && (
                      <p className="text-sm text-red-500">
                        Couldn't load video info.{" "}
                        <button onClick={() => navigate(`/${detected}?url=${encodeURIComponent(url.trim())}`)} className="underline">
                          Try the {platformInfo.label} page →
                        </button>
                      </p>
                    )}

                    {/* YouTube rich card */}
                    {detected === "youtube" && ytInfo && !ytLoading && (
                      <motion.div
                        key="yt-home-card"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.3 }}
                        className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-md text-left"
                      >
                        <div className="flex flex-col sm:flex-row">
                          <div className="sm:w-64 flex-shrink-0 relative">
                            <img src={ytInfo.thumbnail} alt={ytInfo.title} className="w-full h-44 sm:h-full object-cover" />
                            {ytInfo.duration && (
                              <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-0.5 rounded font-mono">
                                {formatDuration(ytInfo.duration)}
                              </span>
                            )}
                          </div>
                          <div className="flex-1 p-5 flex flex-col gap-4">
                            <div>
                              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 mb-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Ready to download
                              </div>
                              <h3 className="font-semibold text-gray-900 dark:text-white text-lg leading-snug line-clamp-2">{ytInfo.title}</h3>
                              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{ytInfo.channelName}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Select Resolution</p>
                              <div className="flex flex-wrap gap-2">
                                {ytInfo.formats.map((fmt) => (
                                  <button key={fmt.formatId} onClick={() => setYtSelectedFormat(fmt.formatId)}
                                    className={`flex flex-col items-center px-4 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${ytSelectedFormat === fmt.formatId ? "border-red-500 bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400" : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500"}`}
                                  >
                                    <span>{fmt.quality}</span>
                                    {fmt.filesize && <span className="text-xs font-normal opacity-70 mt-0.5">{formatFileSize(fmt.filesize)}</span>}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <button onClick={handleYtDownload} disabled={!ytSelectedFormat}
                              className="flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-white font-semibold text-sm transition-all shadow disabled:opacity-50 disabled:cursor-not-allowed self-start"
                              style={{ backgroundColor: "#FF0000" }}
                            >
                              <Download className="w-4 h-4" />
                              Download {selectedYtFormat?.quality}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* Facebook rich card */}
                    {detected === "facebook" && mediaInfo && !mediaLoading && (
                      <motion.div
                        key="fb-home-card"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.3 }}
                        className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-md text-left"
                      >
                        <div className="flex flex-col sm:flex-row">
                          {mediaInfo.thumbnail && (
                            <div className="sm:w-64 flex-shrink-0 relative">
                              <img src={mediaInfo.thumbnail} alt={mediaInfo.title} className="w-full h-44 sm:h-full object-cover" />
                              {mediaInfo.duration && (
                                <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-0.5 rounded font-mono">{formatDuration(mediaInfo.duration)}</span>
                              )}
                            </div>
                          )}
                          <div className="flex-1 p-5 flex flex-col gap-4">
                            <div>
                              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 mb-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Ready to download
                              </div>
                              <h3 className="font-semibold text-gray-900 dark:text-white text-lg leading-snug line-clamp-2">{mediaInfo.title}</h3>
                              {mediaInfo.author && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{mediaInfo.author}</p>}
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Select Quality</p>
                              <div className="flex flex-wrap gap-2">
                                {mediaInfo.formats.map((fmt) => (
                                  <button key={fmt.formatId} onClick={() => setMediaSelectedFormat(fmt.formatId)}
                                    className={`flex flex-col items-center px-4 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${mediaSelectedFormat === fmt.formatId ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400" : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-400"}`}
                                  >
                                    <span>{fmt.quality}</span>
                                    {fmt.filesize && <span className="text-xs font-normal opacity-70 mt-0.5">{formatFileSize(fmt.filesize)}</span>}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <button onClick={handleMediaDownload} disabled={!mediaSelectedFormat}
                              className="flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-white font-semibold text-sm transition-all shadow disabled:opacity-50 disabled:cursor-not-allowed self-start"
                              style={{ backgroundColor: "#1877F2" }}
                            >
                              <Download className="w-4 h-4" /> Download {selectedMediaFormat?.quality}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* Instagram rich card */}
                    {detected === "instagram" && mediaInfo && !mediaLoading && (
                      <motion.div
                        key="ig-home-card"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.3 }}
                        className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-md text-left"
                      >
                        <div className="flex flex-col sm:flex-row">
                          {mediaInfo.thumbnail && (
                            <div className="sm:w-48 flex-shrink-0 relative">
                              <img src={mediaInfo.thumbnail} alt={mediaInfo.title} className="w-full h-48 sm:h-full object-cover" />
                              {mediaInfo.duration && (
                                <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-0.5 rounded font-mono">{formatDuration(mediaInfo.duration)}</span>
                              )}
                            </div>
                          )}
                          <div className="flex-1 p-5 flex flex-col gap-4">
                            <div>
                              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 mb-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Ready to download
                              </div>
                              <h3 className="font-semibold text-gray-900 dark:text-white text-lg leading-snug line-clamp-3">{mediaInfo.title}</h3>
                              {mediaInfo.author && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">@{mediaInfo.author}</p>}
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Format</p>
                              <div className="flex flex-wrap gap-2">
                                {mediaInfo.formats.map((fmt) => (
                                  <button key={fmt.formatId} onClick={() => setMediaSelectedFormat(fmt.formatId)}
                                    className={`flex flex-col items-center px-4 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${mediaSelectedFormat === fmt.formatId ? "border-pink-500 bg-pink-50 dark:bg-pink-950/20 text-pink-600 dark:text-pink-400" : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-400"}`}
                                  >
                                    <span>{fmt.quality}</span>
                                    {fmt.filesize && <span className="text-xs font-normal opacity-70 mt-0.5">{formatFileSize(fmt.filesize)}</span>}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <button onClick={handleMediaDownload} disabled={!mediaSelectedFormat}
                              className="flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-white font-semibold text-sm transition-all shadow disabled:opacity-50 disabled:cursor-not-allowed self-start bg-gradient-to-r from-[#f09433] to-[#bc1888]"
                            >
                              <Download className="w-4 h-4" /> Download Best Quality
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* TikTok rich card */}
                    {detected === "tiktok" && mediaInfo && !mediaLoading && (
                      <motion.div
                        key="tt-home-card"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.3 }}
                        className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-md text-left"
                      >
                        <div className="flex flex-col sm:flex-row">
                          {mediaInfo.thumbnail && (
                            <div className="sm:w-40 flex-shrink-0 relative">
                              <img src={mediaInfo.thumbnail} alt={mediaInfo.title} className="w-full h-48 sm:h-full object-cover" />
                              {mediaInfo.duration && (
                                <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-0.5 rounded font-mono">{formatDuration(mediaInfo.duration)}</span>
                              )}
                            </div>
                          )}
                          <div className="flex-1 p-5 flex flex-col gap-4">
                            <div>
                              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 mb-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Ready to download
                              </div>
                              <h3 className="font-semibold text-gray-900 dark:text-white text-base leading-snug line-clamp-3">{mediaInfo.title}</h3>
                              {mediaInfo.author && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">@{mediaInfo.author}</p>}
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Download Options</p>
                              <div className="flex flex-wrap gap-2">
                                {mediaInfo.formats.map((fmt) => (
                                  <button key={fmt.formatId} onClick={() => setMediaSelectedFormat(fmt.formatId)}
                                    className={`flex flex-col items-center px-4 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${mediaSelectedFormat === fmt.formatId ? "border-[#EE1D52] bg-red-50 dark:bg-red-950/20 text-[#EE1D52]" : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-400"}`}
                                  >
                                    <span>{fmt.quality}</span>
                                    {fmt.filesize && <span className="text-xs font-normal opacity-70 mt-0.5">{formatFileSize(fmt.filesize)}</span>}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <button onClick={handleMediaDownload} disabled={!mediaInfo}
                              className="flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-white font-semibold text-sm transition-all shadow disabled:opacity-50 disabled:cursor-not-allowed self-start"
                              style={{ backgroundColor: "#010101" }}
                            >
                              <Download className="w-4 h-4" />
                              {mediaSelectedFormat === "no_watermark" ? "Download Without Watermark ✅" : "Download With Watermark"}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    <button onClick={() => navigate(`/${detected}?url=${encodeURIComponent(url.trim())}`)} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors underline underline-offset-2">
                      Open {platformInfo.label} Downloader for more options →
                    </button>
                  </motion.div>
                ) : (
                  <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4 text-sm text-gray-400 dark:text-gray-500">
                    Supports YouTube · Facebook · Instagram · TikTok
                  </motion.p>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        </section>

        {/* About Section */}
        <section className="py-16 px-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
          <div className="max-w-3xl mx-auto">
            <div className="border-l-4 border-green-500 pl-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1 text-center" style={{ textAlign: "left" }}>About Seba Downloader</h2>
              <div className="w-16 h-1 bg-green-500 rounded mb-6 mt-1" />
              <div className="relative">
                <div
                  className="space-y-4 text-gray-500 dark:text-gray-400 leading-relaxed text-base overflow-hidden"
                  style={{
                    maxHeight: aboutExpanded ? 9999 : aboutCollapsedHeight,
                    transition: "max-height 0.5s ease",
                  }}
                >
                  <p ref={aboutFirstParaRef}>
                    In today's internet landscape, most video downloader tools come with limitations — either they are paid, filled with intrusive ads, or restrict users with download limits and low-quality outputs. Many platforms claim to be free, but in reality, essential features like HD or 4K downloads are locked behind subscriptions. This creates frustration, especially for students, content learners, and everyday users who just want simple, reliable access to videos offline.
                  </p>
                  <p>
                    Seba Downloader was built to solve these exact problems. We believe downloading content should be straightforward, fast, and completely accessible to everyone. That's why our platform is designed to be 100% free for lifetime, with no hidden charges and no forced upgrades. Unlike many existing tools, we support high-quality downloads up to 4K, ensuring users don't have to compromise on clarity.
                  </p>
                  <p>
                    We also prioritize a clean and distraction-free experience. At launch, Seba Downloader runs without ads, because we understand how disruptive excessive advertising can be — especially when you're trying to quickly download a lecture before class, save a tutorial for offline practice, or keep a favorite video for later viewing in low-network areas.
                  </p>
                  <p>
                    From students downloading educational videos, freelancers saving client references, to casual users collecting entertainment content — Seba Downloader is built for real-life needs. And this is just the beginning. We are continuously working to improve performance, add new features, and expand platform support to make this tool even more powerful and user-friendly in the future.
                  </p>
                </div>
                {!aboutExpanded && (
                  <div
                    className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none"
                    style={{
                      background: `linear-gradient(to bottom, transparent, ${theme === "dark" ? "#111827" : "white"})`,
                    }}
                  />
                )}
              </div>
              <div className="flex justify-center mt-4">
                <button
                  onClick={() => setAboutExpanded((prev) => !prev)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <span>{aboutExpanded ? "Show Less" : "Read More"}</span>
                  <span
                    style={{
                      display: "inline-block",
                      transition: "transform 0.3s ease",
                      transform: aboutExpanded ? "rotate(180deg)" : "rotate(0deg)",
                    }}
                  >
                    ↓
                  </span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Platform cards */}
        <section className="py-12 px-4 bg-gray-50 dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6 text-center">Choose a Platform</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {PLATFORM_CARDS.map((card) => (
                <motion.button key={card.id} whileHover={{ y: -2, scale: 1.01 }} whileTap={{ scale: 0.98 }}
                  onClick={() => navigate(`/${card.id}`)}
                  className="flex items-center gap-4 p-5 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-left hover:shadow-md transition-all group"
                >
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-xl font-bold flex-shrink-0" style={{ background: card.iconBg }}>
                    {card.iconText}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900 dark:text-white group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors">{card.label}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{card.desc}</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-green-500 transition-colors flex-shrink-0" />
                </motion.button>
              ))}
            </div>
          </div>
        </section>

        {/* Informative content section */}
        <section className="py-14 px-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
          <div className="max-w-4xl mx-auto space-y-6">

            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4 }}
              className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-8 border border-gray-200 dark:border-gray-700 shadow-sm"
            >
              <div className="text-4xl mb-4">🚀</div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">Download Videos Instantly with Seba Downloader</h3>
              <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
                Seba Downloader is your all-in-one solution for downloading high-quality videos from the world's most popular platforms. Designed with simplicity and performance in mind — paste your video link, choose your preferred quality, and download instantly. Completely free for lifetime use — no hidden charges, no subscriptions.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: 0.05 }}
                className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm"
              >
                <div className="text-3xl mb-3">🎯</div>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2">Download from Multiple Platforms in One Place</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  Supports 4 major platforms simultaneously — YouTube, Facebook, Instagram, and TikTok. From educational content to entertainment clips, grab everything with just a few clicks.
                </p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: 0.1 }}
                className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm"
              >
                <div className="text-3xl mb-3">🎥</div>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2">Download Videos in Stunning 4K Quality</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  Supports video downloads up to 4K resolution. No compression, no quality loss — just clean, high-definition downloads. Perfect for offline watching, content archiving, and educational purposes.
                </p>
              </motion.div>
            </div>

            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: 0.1 }}
              className="bg-green-600 rounded-2xl p-8 text-white shadow-sm"
            >
              <div className="text-3xl mb-4">⚡️</div>
              <h3 className="text-xl font-bold mb-6">Fast, Simple &amp; User-Friendly — 3 Easy Steps</h3>
              <div className="flex flex-col sm:flex-row gap-6">
                {[
                  { step: "1", label: "Copy URL", desc: "Copy your video URL from any supported platform" },
                  { step: "2", label: "Paste & Detect", desc: "Paste it into the input field — platform is auto-detected" },
                  { step: "3", label: "Download", desc: "Choose your quality and download starts immediately" },
                ].map((s) => (
                  <div key={s.step} className="flex items-start gap-3 flex-1">
                    <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold flex-shrink-0">{s.step}</div>
                    <div>
                      <p className="font-semibold">{s.label}</p>
                      <p className="text-sm text-green-100 mt-0.5">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-sm text-green-100 mt-6 border-t border-white/20 pt-4">No login required. No software installation needed. Works on any device.</p>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: 0.1 }}
              className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm"
            >
              <div className="text-3xl mb-3">🔮</div>
              <h3 className="font-bold text-gray-900 dark:text-white mb-2">Future-Ready Platform</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Coming soon to Seba Downloader:</p>
              <div className="flex flex-wrap gap-2">
                {["More platform integrations", "Faster download speeds", "Audio-only (MP3) downloads", "Batch downloading options"].map((f) => (
                  <span key={f} className="px-3 py-1.5 rounded-full bg-white dark:bg-gray-700 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600">
                    {f}
                  </span>
                ))}
              </div>
            </motion.div>

          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
