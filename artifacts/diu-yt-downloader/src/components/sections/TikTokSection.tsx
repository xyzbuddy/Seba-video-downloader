import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Spinner } from "@/components/ui/spinner";
import { formatDuration, formatFileSize } from "@/lib/platformUtils";

const TT_COLOR = "#EE1D52";
const TT_CYAN = "#69C9D0";
const TT_BLACK = "#010101";

// Proper TikTok logo with official cyan + red dual-shadow effect
const TT_PATH = "M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.83 1.54V6.78a4.85 4.85 0 01-1.06-.09z";

function TikTokLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-2 -2 28 28" fill="none">
      <path d={TT_PATH} fill={TT_CYAN} transform="translate(1,1)" />
      <path d={TT_PATH} fill={TT_COLOR} transform="translate(-1,-1)" />
      <path d={TT_PATH} fill="white" />
    </svg>
  );
}

function isValidTikTokUrl(url: string) {
  return /tiktok\.com/i.test(url);
}

async function fetchTikTokInfo(url: string) {
  const res = await fetch(`/api/media/info?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to fetch video info");
  }
  return res.json() as Promise<{
    platform: string;
    title: string;
    thumbnail?: string;
    duration?: number;
    author?: string;
    formats: { formatId: string; quality: string; label: string; filesize?: number }[];
  }>;
}

interface TikTokSectionProps {
  autoUrl?: string;
}

export default function TikTokSection({ autoUrl }: TikTokSectionProps) {
  const [inputUrl, setInputUrl] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [selectedFormatId, setSelectedFormatId] = useState<string>("no_watermark");
  const { toast } = useToast();

  useEffect(() => {
    if (autoUrl && isValidTikTokUrl(autoUrl)) {
      setInputUrl(autoUrl); setSelectedFormatId("no_watermark"); setActiveUrl(autoUrl);
    }
  }, [autoUrl]);

  // Auto-fetch on valid URL entry (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = inputUrl.trim();
      if (trimmed && isValidTikTokUrl(trimmed) && trimmed !== activeUrl) {
        setSelectedFormatId("no_watermark"); setActiveUrl(trimmed);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [inputUrl, activeUrl]);

  const { data: info, isLoading, isError, error } = useQuery({
    queryKey: ["tt-info", activeUrl],
    queryFn: () => fetchTikTokInfo(activeUrl),
    enabled: !!activeUrl && isValidTikTokUrl(activeUrl),
    retry: 1,
  });

  useEffect(() => {
    if (isError) toast({ title: "Error fetching TikTok", description: (error as Error)?.message || "This video might be private or unavailable.", variant: "destructive" });
  }, [isError, error, toast]);

  const handlePaste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (isValidTikTokUrl(text)) {
        setInputUrl(text); setSelectedFormatId("no_watermark"); setActiveUrl(text);
      } else if (text) {
        toast({ title: "Not a TikTok link", description: "The clipboard doesn't contain a valid TikTok URL.", variant: "destructive" });
      } else {
        toast({ title: "Clipboard is empty", description: "Copy a TikTok link first." });
      }
    } catch {
      toast({ title: "Clipboard access denied", description: "Please paste the link directly into the field.", variant: "destructive" });
    }
  };

  const handleClear = () => { setInputUrl(""); setActiveUrl(""); setSelectedFormatId("no_watermark"); };

  const selectedFormat = info?.formats.find(f => f.formatId === selectedFormatId);

  const handleDownload = () => {
    if (!info || !activeUrl) return;
    const noWatermark = selectedFormatId === "no_watermark";
    const params = new URLSearchParams({
      url: activeUrl,
      formatId: selectedFormatId,
      title: info.title || "tiktok_video",
      quality: noWatermark ? "NoWatermark" : "WithWatermark",
      noWatermark: noWatermark ? "true" : "false",
    });
    window.location.href = `/api/media/download?${params.toString()}`;
    toast({ title: "Download started", description: `Downloading TikTok video ${noWatermark ? "without watermark" : "with watermark"}...` });
  };

  return (
    <section id="tiktok-section" className="py-12 px-4 border-t-4" style={{ borderColor: TT_COLOR }}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          {/* Proper TikTok logo with dual-shadow on black background */}
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TT_BLACK }}>
            <TikTokLogo size={22} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">TikTok Downloader</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Download TikTok videos without watermark</p>
          </div>
        </div>

        {/* URL input — auto-triggers on valid URL, no Fetch button */}
        <div className="flex items-center gap-2 bg-white dark:bg-gray-900 rounded-2xl border-2 border-gray-200 dark:border-gray-700 shadow focus-within:border-[#EE1D52] dark:focus-within:border-[#EE1D52] transition-colors p-2 mb-8">
          {/* TikTok icon in input — dual shadow on dark pill */}
          <div className="w-6 h-6 ml-1 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TT_BLACK }}>
            <TikTokLogo size={14} />
          </div>
          <input
            type="url"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const trimmed = inputUrl.trim();
                if (trimmed && isValidTikTokUrl(trimmed)) { setSelectedFormatId("no_watermark"); setActiveUrl(trimmed); }
              }
            }}
            disabled={isLoading}
            placeholder="Paste TikTok video link here..."
            className="flex-1 bg-transparent outline-none text-gray-900 dark:text-white placeholder:text-gray-400 text-base py-2 px-1"
          />
          {isLoading && <Spinner className="w-4 h-4 flex-shrink-0" style={{ color: TT_COLOR }} />}
          <AnimatePresence>
            {inputUrl && (
              <motion.button type="button" key="clear" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.12 }} onClick={handleClear} className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <X className="w-4 h-4" />
              </motion.button>
            )}
          </AnimatePresence>
          <button type="button" onClick={handlePaste} disabled={isLoading} className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors whitespace-nowrap">
            Paste
          </button>
        </div>

        <AnimatePresence>
          {isLoading && (
            <motion.div key="tt-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 flex gap-6 shadow">
              <div className="w-36 h-48 bg-gray-200 dark:bg-gray-800 rounded-xl animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-3 pt-2">
                <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-3/4" />
                <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-1/2" />
                <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-1/3" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {info && !isLoading && (
            <motion.div key="tt-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
              className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-md"
            >
              <div className="flex flex-col sm:flex-row">
                {info.thumbnail && (
                  <div className="sm:w-40 flex-shrink-0 relative">
                    <img src={info.thumbnail} alt={info.title} className="w-full h-48 sm:h-full object-cover" />
                    {info.duration && (
                      <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-0.5 rounded font-mono">{formatDuration(info.duration)}</span>
                    )}
                  </div>
                )}
                <div className="flex-1 p-5 flex flex-col gap-4">
                  <div>
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 mb-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Ready to download
                    </div>
                    <h3 className="font-semibold text-gray-900 dark:text-white text-base leading-snug line-clamp-3">{info.title}</h3>
                    {info.author && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">@{info.author}</p>}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Download Options</p>
                    <div className="flex flex-wrap gap-2">
                      {info.formats.map((fmt) => (
                        <button key={fmt.formatId} onClick={() => setSelectedFormatId(fmt.formatId)}
                          className={`flex flex-col items-center px-4 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${selectedFormatId === fmt.formatId ? "border-[#EE1D52] bg-red-50 dark:bg-red-950/20 text-[#EE1D52]" : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-400"}`}
                        >
                          <span>{fmt.quality}</span>
                          {fmt.filesize && <span className="text-xs font-normal opacity-70 mt-0.5">{formatFileSize(fmt.filesize)}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button onClick={handleDownload} disabled={!info}
                    className="flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-white font-semibold text-sm transition-all shadow disabled:opacity-50 disabled:cursor-not-allowed self-start"
                    style={{ backgroundColor: TT_BLACK }}
                  >
                    <Download className="w-4 h-4" />
                    {selectedFormatId === "no_watermark" ? "Download Without Watermark ✅" : "Download With Watermark"}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
