import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Spinner } from "@/components/ui/spinner";
import { formatDuration, formatFileSize } from "@/lib/platformUtils";

const FB_COLOR = "#1877F2";

function isValidFacebookUrl(url: string) {
  return /facebook\.com|fb\.watch|m\.facebook\.com/i.test(url);
}

async function fetchFbInfo(url: string) {
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

const HOW_TO_STEPS = [
  { icon: "🔗", text: "Copy the Facebook video or reel URL (must be public)" },
  { icon: "📋", text: "Paste it into the input field above" },
  { icon: "✅", text: "Choose HD or SD quality and download" },
];

const FEATURE_CARDS = [
  { icon: "📹", title: "HD & SD Quality", desc: "Choose the resolution that suits your needs" },
  { icon: "🎬", title: "Reels & Videos", desc: "Supports Facebook reels and regular videos" },
  { icon: "⚡", title: "Instant Download", desc: "No waiting — downloads start immediately" },
  { icon: "🆓", title: "100% Free", desc: "No registration, no fees, no limits" },
];

interface FacebookSectionProps {
  autoUrl?: string;
}

export default function FacebookSection({ autoUrl }: FacebookSectionProps) {
  const [inputUrl, setInputUrl] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (autoUrl && isValidFacebookUrl(autoUrl)) {
      setInputUrl(autoUrl); setSelectedFormatId(null); setActiveUrl(autoUrl);
    }
  }, [autoUrl]);

  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = inputUrl.trim();
      if (trimmed && isValidFacebookUrl(trimmed) && trimmed !== activeUrl) {
        setSelectedFormatId(null); setActiveUrl(trimmed);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [inputUrl, activeUrl]);

  const { data: info, isLoading, isError, error } = useQuery({
    queryKey: ["fb-info", activeUrl],
    queryFn: () => fetchFbInfo(activeUrl),
    enabled: !!activeUrl && isValidFacebookUrl(activeUrl),
    retry: 1,
  });

  useEffect(() => {
    if (info?.formats?.length && !selectedFormatId) setSelectedFormatId(info.formats[0].formatId);
  }, [info, selectedFormatId]);

  useEffect(() => {
    if (isError) toast({ title: "Error fetching video", description: (error as Error)?.message || "Video might be private or unavailable.", variant: "destructive" });
  }, [isError, error, toast]);

  const handlePaste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (isValidFacebookUrl(text)) {
        setInputUrl(text); setSelectedFormatId(null); setActiveUrl(text);
      } else if (text) {
        toast({ title: "Not a Facebook link", description: "The clipboard doesn't contain a valid Facebook URL.", variant: "destructive" });
      } else {
        toast({ title: "Clipboard is empty", description: "Copy a Facebook link first." });
      }
    } catch {
      toast({ title: "Clipboard access denied", description: "Please paste the link directly into the field.", variant: "destructive" });
    }
  };

  const handleClear = () => { setInputUrl(""); setActiveUrl(""); setSelectedFormatId(null); };

  const selectedFormat = info?.formats.find(f => f.formatId === selectedFormatId);

  const handleDownload = () => {
    if (!selectedFormat || !activeUrl) return;
    const params = new URLSearchParams({
      url: activeUrl,
      formatId: selectedFormat.formatId,
      title: info?.title || "facebook_video",
      quality: selectedFormat.quality,
    });
    window.location.href = `/api/media/download?${params.toString()}`;
    toast({ title: "Download started", description: `Downloading ${selectedFormat.quality} video...` });
  };

  const showInfo = !isLoading && !info;

  return (
    <section id="facebook-section" className="py-12 px-4 border-t-4" style={{ borderColor: FB_COLOR }}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg" style={{ backgroundColor: FB_COLOR }}>
            <svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Facebook Downloader</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Download Facebook videos and reels in HD or SD</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-white dark:bg-gray-900 rounded-2xl border-2 border-gray-200 dark:border-gray-700 shadow focus-within:border-blue-400 dark:focus-within:border-blue-500 transition-colors p-2 mb-8">
          <svg className="w-5 h-5 ml-2 flex-shrink-0" viewBox="0 0 24 24" fill={FB_COLOR}><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
          <input
            type="url"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const trimmed = inputUrl.trim();
                if (trimmed && isValidFacebookUrl(trimmed)) { setSelectedFormatId(null); setActiveUrl(trimmed); }
              }
            }}
            disabled={isLoading}
            placeholder="Paste Facebook video link here..."
            className="flex-1 bg-transparent outline-none text-gray-900 dark:text-white placeholder:text-gray-400 text-base py-2 px-1"
          />
          {isLoading && <Spinner className="w-4 h-4 flex-shrink-0" style={{ color: FB_COLOR }} />}
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
            <motion.div key="fb-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 flex gap-6 shadow">
              <div className="w-48 h-28 bg-gray-200 dark:bg-gray-800 rounded-xl animate-pulse flex-shrink-0" />
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
            <motion.div key="fb-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
              className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-md"
            >
              <div className="flex flex-col sm:flex-row">
                {info.thumbnail && (
                  <div className="sm:w-64 flex-shrink-0 relative">
                    <img src={info.thumbnail} alt={info.title} className="w-full h-44 sm:h-full object-cover" />
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
                    <h3 className="font-semibold text-gray-900 dark:text-white text-lg leading-snug line-clamp-2">{info.title}</h3>
                    {info.author && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{info.author}</p>}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Select Quality</p>
                    <div className="flex flex-wrap gap-2">
                      {info.formats.map((fmt) => (
                        <button key={fmt.formatId} onClick={() => setSelectedFormatId(fmt.formatId)}
                          className={`flex flex-col items-center px-4 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${selectedFormatId === fmt.formatId ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400" : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-400"}`}
                        >
                          <span>{fmt.quality}</span>
                          {fmt.filesize && <span className="text-xs font-normal opacity-70 mt-0.5">{formatFileSize(fmt.filesize)}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button onClick={handleDownload} disabled={!selectedFormatId}
                    className="flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-white font-semibold text-sm transition-all shadow disabled:opacity-50 disabled:cursor-not-allowed self-start"
                    style={{ backgroundColor: FB_COLOR }}
                  >
                    <Download className="w-4 h-4" /> Download {selectedFormat?.quality}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Informative content — shown only when no result */}
        <AnimatePresence>
          {showInfo && (
            <motion.div key="fb-info" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }} className="space-y-6 mt-2">
              <div className="bg-gray-50 dark:bg-[#1e2433] rounded-2xl p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="font-bold text-gray-900 dark:text-white mb-5 text-base">How to Download Facebook Videos</h3>
                <div className="flex flex-col sm:flex-row gap-4">
                  {HOW_TO_STEPS.map((s, i) => (
                    <div key={i} className="flex items-start gap-3 flex-1">
                      <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center text-sm font-bold text-blue-600 dark:text-blue-400 flex-shrink-0">{i + 1}</div>
                      <div className="pt-1">
                        <span className="text-lg mr-1">{s.icon}</span>
                        <span className="text-sm text-gray-600 dark:text-gray-300">{s.text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {FEATURE_CARDS.map((c, i) => (
                  <div key={i} className="bg-gray-50 dark:bg-[#1e2433] rounded-xl p-4 border border-gray-200 dark:border-gray-700 flex items-start gap-3">
                    <span className="text-2xl flex-shrink-0">{c.icon}</span>
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white text-sm">{c.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{c.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-start gap-2 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800/50 rounded-xl p-3">
                <span className="text-base flex-shrink-0">⚠️</span>
                <p className="text-sm text-yellow-800 dark:text-yellow-300">Only public Facebook videos and reels can be downloaded.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
