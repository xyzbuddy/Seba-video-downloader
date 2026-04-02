import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, ArrowRight, Download } from "lucide-react";
import { detectPlatform, isValidYoutubeUrl, type Platform } from "@/lib/platformUtils";
import { useToast } from "@/hooks/use-toast";
import { Spinner } from "@/components/ui/spinner";
import { useGetVideoInfo, getGetVideoInfoQueryKey } from "@workspace/api-client-react";
import { formatFileSize } from "@/lib/platformUtils";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const PLATFORM_INFO: Record<Platform, { label: string; color: string; badgeBg: string; badgeText: string; desc: string }> = {
  youtube: { label: "YouTube", color: "#FF0000", badgeBg: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900", badgeText: "text-red-600 dark:text-red-400", desc: "480p · 720p · 1080p · 4K" },
  facebook: { label: "Facebook", color: "#1877F2", badgeBg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900", badgeText: "text-blue-600 dark:text-blue-400", desc: "HD and SD quality" },
  instagram: { label: "Instagram", color: "#E1306C", badgeBg: "bg-pink-50 dark:bg-pink-950/30 border-pink-200 dark:border-pink-900", badgeText: "text-pink-600 dark:text-pink-400", desc: "Best quality MP4" },
  tiktok: { label: "TikTok", color: "#EE1D52", badgeBg: "bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700", badgeText: "text-gray-900 dark:text-white", desc: "Without or with watermark" },
};

const PRESET_OPTS: Record<Exclude<Platform, "youtube">, { label: string; formatId: string; quality: string; noWatermark?: string }[]> = {
  facebook: [
    { label: "HD Quality", formatId: "best", quality: "HD" },
    { label: "SD Quality", formatId: "worst", quality: "SD" },
  ],
  instagram: [
    { label: "Best Quality (MP4)", formatId: "best", quality: "Best" },
  ],
  tiktok: [
    { label: "Without Watermark ✅", formatId: "no_watermark", quality: "NoWatermark", noWatermark: "true" },
    { label: "With Watermark", formatId: "with_watermark", quality: "WithWatermark", noWatermark: "false" },
  ],
};

const PLATFORM_CARDS = [
  { id: "youtube" as Platform, label: "YouTube Downloader", iconText: "▶", iconBg: "#FF0000", desc: "480p · 720p · 1080p · 4K" },
  { id: "facebook" as Platform, label: "Facebook Downloader", iconText: "f", iconBg: "#1877F2", desc: "HD and SD quality" },
  { id: "instagram" as Platform, label: "Instagram Downloader", iconText: "◎", iconBg: "linear-gradient(135deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)", desc: "Reels, posts in best quality" },
  { id: "tiktok" as Platform, label: "TikTok Downloader", iconText: "♪", iconBg: "#000", desc: "Without watermark support" },
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [detected, setDetected] = useState<Platform | null>(null);
  const [ytFetchUrl, setYtFetchUrl] = useState("");
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const handleChange = (val: string) => {
    setUrl(val);
    const platform = detectPlatform(val.trim()) || null;
    setDetected(platform);
    if (platform !== "youtube") setYtFetchUrl("");
  };

  const handleClear = () => { setUrl(""); setDetected(null); setYtFetchUrl(""); };

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

  // Debounce YouTube URL for info auto-fetch
  useEffect(() => {
    if (detected !== "youtube") { setYtFetchUrl(""); return; }
    const t = setTimeout(() => {
      const trimmed = url.trim();
      if (isValidYoutubeUrl(trimmed)) setYtFetchUrl(trimmed);
    }, 400);
    return () => clearTimeout(t);
  }, [url, detected]);

  const { data: ytInfo, isLoading: ytLoading, isError: ytError } = useGetVideoInfo(
    { url: ytFetchUrl },
    { query: { enabled: !!ytFetchUrl, queryKey: getGetVideoInfoQueryKey({ url: ytFetchUrl }), retry: 1 } }
  );

  const handleQuickDownload = (platform: Platform, formatId: string, quality: string, title?: string, noWatermark?: string) => {
    const encodedUrl = encodeURIComponent(url.trim());
    const encodedTitle = encodeURIComponent(title || `${platform}_video`);
    if (platform === "youtube") {
      window.location.href = `/api/youtube/download?url=${encodedUrl}&formatId=${formatId}&quality=${encodeURIComponent(quality)}&title=${encodedTitle}`;
    } else {
      let href = `/api/media/download?url=${encodedUrl}&formatId=${formatId}&quality=${encodeURIComponent(quality)}&title=${encodedTitle}`;
      if (noWatermark !== undefined) href += `&noWatermark=${noWatermark}`;
      window.location.href = href;
    }
    toast({ title: "Download started", description: `Preparing your ${quality} download...` });
  };

  const platformInfo = detected ? PLATFORM_INFO[detected] : null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />

      <main>
        {/* Hero */}
        <section className="pt-32 pb-20 px-4">
          <div className="max-w-3xl mx-auto text-center">
            <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4 leading-tight">
                DIU Downloader —{" "}<span className="text-green-600">Download Videos</span>{" "}Free &amp; Fast
              </h1>
              <p className="text-gray-500 dark:text-gray-400 text-lg mb-10">
                Paste any YouTube, Facebook, Instagram or TikTok link below
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
              {/* URL input */}
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

              {/* Platform detection + quality options */}
              <AnimatePresence mode="wait">
                {detected && platformInfo ? (
                  <motion.div key={detected} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className="mt-5 flex flex-col items-center gap-4">
                    {/* Platform badge */}
                    <span className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium border ${platformInfo.badgeBg} ${platformInfo.badgeText}`}>
                      <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: platformInfo.color }} />
                      {platformInfo.label} link detected · {platformInfo.desc}
                    </span>

                    {/* YouTube: auto-fetch quality options */}
                    {detected === "youtube" && (
                      ytLoading ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-2">
                          <Spinner className="w-4 h-4" />
                          <span>Fetching available qualities...</span>
                        </div>
                      ) : ytError ? (
                        <p className="text-sm text-red-500">Couldn't load video info. <button onClick={() => navigate(`/youtube?url=${encodeURIComponent(url.trim())}`)} className="underline">Try the YouTube page →</button></p>
                      ) : ytInfo?.formats ? (
                        <div className="flex flex-wrap justify-center gap-2">
                          {ytInfo.formats.map((fmt) => (
                            <motion.button key={fmt.formatId} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.96 }}
                              onClick={() => handleQuickDownload("youtube", fmt.formatId, fmt.quality, ytInfo.title)}
                              className="group flex flex-col items-center px-5 py-2.5 rounded-xl border-2 border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-600 hover:text-white hover:border-red-600 dark:hover:bg-red-600 dark:hover:text-white dark:hover:border-red-600 transition-all font-semibold text-sm"
                            >
                              <Download className="w-3.5 h-3.5 mb-0.5" />
                              <span>{fmt.quality}</span>
                              {fmt.filesize && <span className="text-xs font-normal opacity-70 mt-0.5">{formatFileSize(fmt.filesize)}</span>}
                            </motion.button>
                          ))}
                        </div>
                      ) : null
                    )}

                    {/* Facebook / Instagram / TikTok: preset quality buttons */}
                    {detected !== "youtube" && (
                      <div className="flex flex-wrap justify-center gap-2">
                        {PRESET_OPTS[detected as Exclude<Platform, "youtube">].map((opt) => (
                          <motion.button key={opt.formatId} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.96 }}
                            onClick={() => handleQuickDownload(detected, opt.formatId, opt.quality, undefined, opt.noWatermark)}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm text-white shadow-md transition-all hover:opacity-90"
                            style={{ backgroundColor: platformInfo.color }}
                          >
                            <Download className="w-4 h-4" />
                            {opt.label}
                          </motion.button>
                        ))}
                      </div>
                    )}

                    {/* Link to full platform page */}
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

        {/* Platform cards */}
        <section className="py-12 px-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6 text-center">Choose a Platform</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {PLATFORM_CARDS.map((card) => (
                <motion.button key={card.id} whileHover={{ y: -2, scale: 1.01 }} whileTap={{ scale: 0.98 }}
                  onClick={() => navigate(`/${card.id}`)}
                  className="flex items-center gap-4 p-5 rounded-2xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-left hover:shadow-md transition-all group"
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
        <section className="py-14 px-4 bg-gray-50 dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800">
          <div className="max-w-4xl mx-auto space-y-6">

            {/* Card 1 — Hero info */}
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4 }}
              className="bg-white dark:bg-gray-900 rounded-2xl p-8 border border-gray-200 dark:border-gray-800 shadow-sm"
            >
              <div className="text-4xl mb-4">🚀</div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">Download Videos Instantly with DIU Downloader</h3>
              <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
                DIU Downloader is your all-in-one solution for downloading high-quality videos from the world's most popular platforms. Designed with simplicity and performance in mind — paste your video link, choose your preferred quality, and download instantly. Completely free for lifetime use — no hidden charges, no subscriptions.
              </p>
            </motion.div>

            {/* Cards 2 + 3 — Two columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: 0.05 }}
                className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm"
              >
                <div className="text-3xl mb-3">🎯</div>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2">Download from Multiple Platforms in One Place</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  Supports 4 major platforms simultaneously — YouTube, Facebook, Instagram, and TikTok. From educational content to entertainment clips, grab everything with just a few clicks.
                </p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: 0.1 }}
                className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm"
              >
                <div className="text-3xl mb-3">🎥</div>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2">Download Videos in Stunning 4K Quality</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  Supports video downloads up to 4K resolution. No compression, no quality loss — just clean, high-definition downloads. Perfect for offline watching, content archiving, and educational purposes.
                </p>
              </motion.div>
            </div>

            {/* Card 4 — Steps */}
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: 0.1 }}
              className="bg-green-600 rounded-2xl p-8 text-white shadow-sm"
            >
              <div className="text-3xl mb-4">⚡️</div>
              <h3 className="text-xl font-bold mb-6">Fast, Simple &amp; User-Friendly — 3 Easy Steps</h3>
              <div className="flex flex-col sm:flex-row gap-6">
                {[
                  { step: "1", label: "Copy URL", desc: "Copy your video URL from any supported platform" },
                  { step: "2", label: "Paste &amp; Detect", desc: "Paste it into the input field — platform is auto-detected" },
                  { step: "3", label: "Download", desc: "Choose your quality and download starts immediately" },
                ].map((s) => (
                  <div key={s.step} className="flex items-start gap-3 flex-1">
                    <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold flex-shrink-0">{s.step}</div>
                    <div>
                      <p className="font-semibold" dangerouslySetInnerHTML={{ __html: s.label }} />
                      <p className="text-sm text-green-100 mt-0.5">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-sm text-green-100 mt-6 border-t border-white/20 pt-4">No login required. No software installation needed. Works on any device.</p>
            </motion.div>

            {/* Card 5 — Future */}
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: 0.1 }}
              className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm"
            >
              <div className="text-3xl mb-3">🔮</div>
              <h3 className="font-bold text-gray-900 dark:text-white mb-2">Future-Ready Platform</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Coming soon to DIU Downloader:</p>
              <div className="flex flex-wrap gap-2">
                {["More platform integrations", "Faster download speeds", "Audio-only (MP3) downloads", "Batch downloading options"].map((f) => (
                  <span key={f} className="px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
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
