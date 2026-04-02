import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, ArrowRight, Download } from "lucide-react";
import { detectPlatform, type Platform } from "@/lib/platformUtils";
import { useToast } from "@/hooks/use-toast";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const PLATFORM_INFO: Record<
  Platform,
  { label: string; color: string; badgeBg: string; badgeText: string; desc: string }
> = {
  youtube: {
    label: "YouTube",
    color: "#FF0000",
    badgeBg: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900",
    badgeText: "text-red-600 dark:text-red-400",
    desc: "Download in up to 4K quality",
  },
  facebook: {
    label: "Facebook",
    color: "#1877F2",
    badgeBg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900",
    badgeText: "text-blue-600 dark:text-blue-400",
    desc: "HD and SD quality videos & reels",
  },
  instagram: {
    label: "Instagram",
    color: "#E1306C",
    badgeBg: "bg-pink-50 dark:bg-pink-950/30 border-pink-200 dark:border-pink-900",
    badgeText: "text-pink-600 dark:text-pink-400",
    desc: "Reels and posts in best quality",
  },
  tiktok: {
    label: "TikTok",
    color: "#EE1D52",
    badgeBg: "bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700",
    badgeText: "text-gray-900 dark:text-white",
    desc: "Download without watermark",
  },
};

const PLATFORM_CARDS = [
  { id: "youtube" as Platform, label: "YouTube Downloader", iconText: "▶", iconBg: "#FF0000", desc: "480p · 720p · 1080p · 4K" },
  { id: "facebook" as Platform, label: "Facebook Downloader", iconText: "f", iconBg: "#1877F2", desc: "HD and SD quality" },
  { id: "instagram" as Platform, label: "Instagram Downloader", iconText: "◎", iconBg: "linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)", desc: "Reels, posts in best quality" },
  { id: "tiktok" as Platform, label: "TikTok Downloader", iconText: "♪", iconBg: "#000", desc: "Without watermark support" },
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [detected, setDetected] = useState<Platform | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const handleChange = (val: string) => {
    setUrl(val);
    setDetected(detectPlatform(val.trim()) || null);
  };

  const handleClear = () => {
    setUrl("");
    setDetected(null);
  };

  const handlePaste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        handleChange(text);
        if (!detectPlatform(text)) {
          toast({
            title: "Not a supported link",
            description: "Please paste a YouTube, Facebook, Instagram, or TikTok URL.",
            variant: "destructive",
          });
        }
      } else {
        toast({ title: "Clipboard is empty", description: "Copy a video link first, then click Paste." });
      }
    } catch {
      toast({ title: "Clipboard access denied", description: "Please paste the link directly into the field.", variant: "destructive" });
    }
  };

  const handleDownload = () => {
    if (!detected || !url.trim()) return;
    navigate(`/${detected}?url=${encodeURIComponent(url.trim())}`);
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
                DIU Downloader —{" "}
                <span className="text-green-600">Download Videos</span>{" "}
                Free &amp; Fast
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
                  onKeyDown={(e) => { if (e.key === "Enter" && detected) handleDownload(); }}
                  placeholder="Paste your video link here..."
                  className="flex-1 bg-transparent outline-none text-gray-900 dark:text-white placeholder:text-gray-400 text-base py-2 px-1"
                  autoFocus
                />
                <AnimatePresence>
                  {url && (
                    <motion.button
                      type="button"
                      key="clear"
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.7 }}
                      transition={{ duration: 0.12 }}
                      onClick={handleClear}
                      className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </motion.button>
                  )}
                </AnimatePresence>
                <button
                  type="button"
                  onClick={handlePaste}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
                >
                  Paste
                </button>
              </div>

              {/* Platform badge + Download button */}
              <AnimatePresence mode="wait">
                {detected && platformInfo ? (
                  <motion.div
                    key={detected}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                    className="mt-5 flex flex-col items-center gap-4"
                  >
                    <span
                      className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium border ${platformInfo.badgeBg} ${platformInfo.badgeText}`}
                    >
                      <span
                        className="w-2 h-2 rounded-full animate-pulse"
                        style={{ backgroundColor: platformInfo.color }}
                      />
                      {platformInfo.label} link detected · {platformInfo.desc}
                    </span>
                    <motion.button
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={handleDownload}
                      className="flex items-center gap-2.5 px-8 py-3.5 rounded-xl text-white font-semibold text-base shadow-lg transition-all"
                      style={{ backgroundColor: platformInfo.color }}
                    >
                      <Download className="w-5 h-5" />
                      Download from {platformInfo.label}
                      <ArrowRight className="w-4 h-4" />
                    </motion.button>
                  </motion.div>
                ) : (
                  <motion.p
                    key="hint"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="mt-4 text-sm text-gray-400 dark:text-gray-500"
                  >
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
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6 text-center">
              Choose a Platform
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {PLATFORM_CARDS.map((card) => (
                <motion.button
                  key={card.id}
                  whileHover={{ y: -2, scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => navigate(`/${card.id}`)}
                  className="flex items-center gap-4 p-5 rounded-2xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-left hover:shadow-md transition-all group"
                >
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-xl font-bold flex-shrink-0"
                    style={{ background: card.iconBg }}
                  >
                    {card.iconText}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900 dark:text-white group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors">
                      {card.label}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{card.desc}</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-green-500 transition-colors flex-shrink-0" />
                </motion.button>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
