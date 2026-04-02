import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Spinner } from "@/components/ui/spinner";
import { formatDuration, formatFileSize } from "@/lib/platformUtils";

const IG_COLOR = "#C13584";

function isValidInstagramUrl(url: string) {
  return /instagram\.com/i.test(url);
}

async function fetchIgInfo(url: string) {
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

interface InstagramSectionProps {
  autoUrl?: string;
}

export default function InstagramSection({ autoUrl }: InstagramSectionProps) {
  const [inputUrl, setInputUrl] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (autoUrl && isValidInstagramUrl(autoUrl)) {
      setInputUrl(autoUrl); setSelectedFormatId(null); setActiveUrl(autoUrl);
    }
  }, [autoUrl]);

  // Auto-fetch on valid URL entry (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = inputUrl.trim();
      if (trimmed && isValidInstagramUrl(trimmed) && trimmed !== activeUrl) {
        setSelectedFormatId(null); setActiveUrl(trimmed);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [inputUrl, activeUrl]);

  const { data: info, isLoading, isError, error } = useQuery({
    queryKey: ["ig-info", activeUrl],
    queryFn: () => fetchIgInfo(activeUrl),
    enabled: !!activeUrl && isValidInstagramUrl(activeUrl),
    retry: 1,
  });

  useEffect(() => {
    if (info?.formats?.length && !selectedFormatId) setSelectedFormatId(info.formats[0].formatId);
  }, [info, selectedFormatId]);

  useEffect(() => {
    if (isError) toast({ title: "Error fetching reel", description: (error as Error)?.message || "This post might be private or unavailable.", variant: "destructive" });
  }, [isError, error, toast]);

  const handlePaste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (isValidInstagramUrl(text)) {
        setInputUrl(text); setSelectedFormatId(null); setActiveUrl(text);
      } else if (text) {
        toast({ title: "Not an Instagram link", description: "The clipboard doesn't contain a valid Instagram URL.", variant: "destructive" });
      } else {
        toast({ title: "Clipboard is empty", description: "Copy an Instagram link first." });
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
      title: info?.title || "instagram_video",
      quality: selectedFormat.quality,
    });
    window.location.href = `/api/media/download?${params.toString()}`;
    toast({ title: "Download started", description: "Downloading your Instagram video..." });
  };

  return (
    <section id="instagram-section" className="py-12 px-4 border-t-4" style={{ borderColor: IG_COLOR }}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white bg-gradient-to-br from-[#f09433] via-[#dc2743] to-[#bc1888]">
            <svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" /></svg>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Instagram Downloader</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Download Instagram reels and videos in best quality</p>
          </div>
        </div>

        {/* URL input — auto-triggers on valid URL, no Fetch button */}
        <div className="flex items-center gap-2 bg-white dark:bg-gray-900 rounded-2xl border-2 border-gray-200 dark:border-gray-700 shadow focus-within:border-pink-400 dark:focus-within:border-pink-500 transition-colors p-2 mb-8">
          <svg className="w-5 h-5 ml-2 flex-shrink-0" viewBox="0 0 24 24" fill="url(#igGrad2)">
            <defs><linearGradient id="igGrad2" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#f09433" /><stop offset="50%" stopColor="#dc2743" /><stop offset="100%" stopColor="#bc1888" /></linearGradient></defs>
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
          </svg>
          <input
            type="url"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const trimmed = inputUrl.trim();
                if (trimmed && isValidInstagramUrl(trimmed)) { setSelectedFormatId(null); setActiveUrl(trimmed); }
              }
            }}
            disabled={isLoading}
            placeholder="Paste Instagram reel or post link here..."
            className="flex-1 bg-transparent outline-none text-gray-900 dark:text-white placeholder:text-gray-400 text-base py-2 px-1"
          />
          {isLoading && <Spinner className="w-4 h-4 text-pink-500 flex-shrink-0" />}
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
            <motion.div key="ig-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 flex gap-6 shadow">
              <div className="w-48 h-28 bg-gray-200 dark:bg-gray-800 rounded-xl animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-3 pt-2">
                <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-3/4" />
                <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-1/2" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {info && !isLoading && (
            <motion.div key="ig-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
              className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-md"
            >
              <div className="flex flex-col sm:flex-row">
                {info.thumbnail && (
                  <div className="sm:w-48 flex-shrink-0 relative">
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
                    <h3 className="font-semibold text-gray-900 dark:text-white text-lg leading-snug line-clamp-3">{info.title}</h3>
                    {info.author && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">@{info.author}</p>}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Format</p>
                    <div className="flex flex-wrap gap-2">
                      {info.formats.map((fmt) => (
                        <button key={fmt.formatId} onClick={() => setSelectedFormatId(fmt.formatId)}
                          className={`flex flex-col items-center px-4 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${selectedFormatId === fmt.formatId ? "border-pink-500 bg-pink-50 dark:bg-pink-950/20 text-pink-600 dark:text-pink-400" : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-400"}`}
                        >
                          <span>{fmt.quality}</span>
                          {fmt.filesize && <span className="text-xs font-normal opacity-70 mt-0.5">{formatFileSize(fmt.filesize)}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button onClick={handleDownload} disabled={!selectedFormatId}
                    className="flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-white font-semibold text-sm transition-all shadow disabled:opacity-50 disabled:cursor-not-allowed self-start bg-gradient-to-r from-[#f09433] to-[#bc1888]"
                  >
                    <Download className="w-4 h-4" /> Download Best Quality
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
