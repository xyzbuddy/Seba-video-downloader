import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, ArrowRight } from "lucide-react";
import { detectPlatform, type Platform } from "@/lib/platformUtils";
import { useToast } from "@/hooks/use-toast";

interface HeroSectionProps {
  onSubmit: (url: string, platform: Platform) => void;
}

const PLATFORM_BADGES: Record<Platform, { label: string; color: string; bg: string }> = {
  youtube: { label: "YouTube link detected ✓", color: "text-red-600", bg: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" },
  facebook: { label: "Facebook link detected ✓", color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800" },
  instagram: { label: "Instagram link detected ✓", color: "text-pink-600", bg: "bg-pink-50 dark:bg-pink-950/30 border-pink-200 dark:border-pink-800" },
  tiktok: { label: "TikTok link detected ✓", color: "text-gray-900 dark:text-white", bg: "bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700" },
};

const PLATFORM_ICONS = [
  { label: "YouTube", color: "#FF0000", icon: "▶" },
  { label: "Facebook", color: "#1877F2", icon: "f" },
  { label: "Instagram", color: "#C13584", icon: "◎" },
  { label: "TikTok", color: "#EE1D52", icon: "♪" },
];

export default function HeroSection({ onSubmit }: HeroSectionProps) {
  const [url, setUrl] = useState("");
  const [detected, setDetected] = useState<Platform | null>(null);
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
        const platform = detectPlatform(text);
        if (!platform) {
          toast({ title: "Not a supported link", description: "Please paste a YouTube, Facebook, Instagram, or TikTok URL.", variant: "destructive" });
        }
      } else {
        toast({ title: "Clipboard is empty", description: "Copy a video link first, then click Paste." });
      }
    } catch {
      toast({ title: "Clipboard access denied", description: "Please paste the link directly into the field.", variant: "destructive" });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    const platform = detectPlatform(trimmed);
    if (!platform) {
      toast({ title: "Unsupported link", description: "Please enter a YouTube, Facebook, Instagram, or TikTok URL.", variant: "destructive" });
      return;
    }
    onSubmit(trimmed, platform);
  };

  return (
    <section className="pt-28 pb-16 px-4">
      <div className="max-w-3xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4 leading-tight">
            Seba Downloader —{" "}
            <span className="text-green-600">Download Videos</span>{" "}
            Free &amp; Fast
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-lg mb-8">
            Paste any YouTube, Facebook, Instagram or TikTok link below
          </p>
        </motion.div>

        <motion.form
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          onSubmit={handleSubmit}
          className="flex items-center gap-2 bg-white dark:bg-gray-900 rounded-2xl border-2 border-gray-200 dark:border-gray-700 shadow-lg focus-within:border-green-500 dark:focus-within:border-green-500 transition-colors p-2"
        >
          <Search className="w-5 h-5 text-gray-400 ml-2 flex-shrink-0" />
          <input
            type="url"
            value={url}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Paste your video link here..."
            className="flex-1 bg-transparent outline-none text-gray-900 dark:text-white placeholder:text-gray-400 text-base py-2 px-1"
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
          <button
            type="submit"
            disabled={!detected}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-semibold text-sm transition-all shadow-sm disabled:cursor-not-allowed whitespace-nowrap"
          >
            Download <ArrowRight className="w-4 h-4" />
          </button>
        </motion.form>

        {/* Platform detection badge */}
        <AnimatePresence>
          {detected && (
            <motion.div
              key={detected}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="mt-3 inline-block"
            >
              <span className={`inline-block px-4 py-1.5 rounded-full text-sm font-medium border ${PLATFORM_BADGES[detected].bg} ${PLATFORM_BADGES[detected].color}`}>
                {PLATFORM_BADGES[detected].label}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Platform icons */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex items-center justify-center gap-6 mt-10"
        >
          {PLATFORM_ICONS.map((p) => (
            <div key={p.label} className="flex flex-col items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg font-bold shadow-sm"
                style={{ backgroundColor: p.color }}
              >
                {p.icon}
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400">{p.label}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
