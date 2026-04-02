import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Spinner } from "@/components/ui/spinner";
import { useGetVideoInfo, getGetVideoInfoQueryKey } from "@workspace/api-client-react";
import { formatDuration, formatFileSize } from "@/lib/platformUtils";

const YT_COLOR = "#FF0000";

function isValidYoutubeUrl(url: string) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[a-zA-Z0-9_-]{11}/.test(url);
}

interface YouTubeSectionProps {
  autoUrl?: string;
}

export default function YouTubeSection({ autoUrl }: YouTubeSectionProps) {
  const [inputUrl, setInputUrl] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (autoUrl && isValidYoutubeUrl(autoUrl)) {
      setInputUrl(autoUrl);
      setSelectedFormatId(null);
      setActiveUrl(autoUrl);
    }
  }, [autoUrl]);

  // Auto-fetch on valid URL entry (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = inputUrl.trim();
      if (trimmed && isValidYoutubeUrl(trimmed) && trimmed !== activeUrl) {
        setSelectedFormatId(null);
        setActiveUrl(trimmed);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [inputUrl, activeUrl]);

  const { data: videoInfo, isLoading, isError } = useGetVideoInfo(
    { url: activeUrl },
    { query: { enabled: !!activeUrl && isValidYoutubeUrl(activeUrl), queryKey: getGetVideoInfoQueryKey({ url: activeUrl }), retry: 1 } }
  );

  useEffect(() => {
    if (isError) {
      toast({ title: "Error fetching video", description: "This video might be unavailable, private, or region-locked.", variant: "destructive" });
    }
  }, [isError, toast]);

  useEffect(() => {
    if (videoInfo?.formats?.length) {
      const preferred = videoInfo.formats.find(f => f.formatId === "height_1080") || videoInfo.formats[0];
      setSelectedFormatId(preferred.formatId);
    } else {
      setSelectedFormatId(null);
    }
  }, [videoInfo]);

  const selectedFormat = useMemo(() => {
    if (!videoInfo || !selectedFormatId) return null;
    return videoInfo.formats.find(f => f.formatId === selectedFormatId);
  }, [videoInfo, selectedFormatId]);

  const handlePaste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (isValidYoutubeUrl(text)) {
        setInputUrl(text); setSelectedFormatId(null); setActiveUrl(text);
      } else if (text) {
        toast({ title: "Not a YouTube link", description: "The clipboard doesn't contain a valid YouTube URL.", variant: "destructive" });
      } else {
        toast({ title: "Clipboard is empty", description: "Copy a YouTube link first." });
      }
    } catch {
      toast({ title: "Clipboard access denied", description: "Please paste the link directly into the field.", variant: "destructive" });
    }
  };

  const handleClear = () => { setInputUrl(""); setActiveUrl(""); setSelectedFormatId(null); };

  const handleDownload = () => {
    if (!selectedFormat || !activeUrl) return;
    const params = new URLSearchParams({
      url: activeUrl,
      formatId: selectedFormatId || "",
      quality: selectedFormat.quality,
      title: videoInfo?.title || "video",
    });
    window.location.href = `/api/youtube/download?${params.toString()}`;
    toast({ title: "Download started", description: `Preparing ${selectedFormat.quality} — this may take a moment while the video is processed.` });
  };

  return (
    <section id="youtube-section" className="py-12 px-4 border-t-4" style={{ borderColor: YT_COLOR }}>
      <div className="max-w-4xl mx-auto">
        {/* Section header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold" style={{ backgroundColor: YT_COLOR }}>
            <svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">YouTube Downloader</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Download YouTube videos in up to 4K quality</p>
          </div>
        </div>

        {/* URL input — no Fetch button, auto-triggers on valid URL */}
        <div className="flex items-center gap-2 bg-white dark:bg-gray-900 rounded-2xl border-2 border-gray-200 dark:border-gray-700 shadow focus-within:border-red-400 dark:focus-within:border-red-500 transition-colors p-2 mb-8">
          <svg className="w-5 h-5 ml-2 flex-shrink-0" viewBox="0 0 24 24" fill={YT_COLOR}><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>
          <input
            type="url"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const trimmed = inputUrl.trim();
                if (trimmed && isValidYoutubeUrl(trimmed)) { setSelectedFormatId(null); setActiveUrl(trimmed); }
              }
            }}
            disabled={isLoading}
            placeholder="Paste YouTube video link here..."
            className="flex-1 bg-transparent outline-none text-gray-900 dark:text-white placeholder:text-gray-400 text-base py-2 px-1"
          />
          {isLoading && <Spinner className="w-4 h-4 text-red-500 flex-shrink-0" />}
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

        {/* Loading skeleton */}
        <AnimatePresence>
          {isLoading && (
            <motion.div key="yt-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 flex gap-6 shadow">
              <div className="w-48 h-28 bg-gray-200 dark:bg-gray-800 rounded-xl animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-3 pt-2">
                <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-3/4" />
                <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-1/2" />
                <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-1/3" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Video preview card */}
        <AnimatePresence>
          {videoInfo && !isLoading && (
            <motion.div key="yt-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}
              className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-md"
            >
              <div className="flex flex-col sm:flex-row">
                <div className="sm:w-64 flex-shrink-0 relative">
                  <img src={videoInfo.thumbnail} alt={videoInfo.title} className="w-full h-44 sm:h-full object-cover" />
                  {videoInfo.duration && (
                    <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-0.5 rounded font-mono">
                      {formatDuration(videoInfo.duration)}
                    </span>
                  )}
                </div>
                <div className="flex-1 p-5 flex flex-col gap-4">
                  <div>
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 mb-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Ready to download
                    </div>
                    <h3 className="font-semibold text-gray-900 dark:text-white text-lg leading-snug line-clamp-2">{videoInfo.title}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{videoInfo.channelName}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Select Resolution</p>
                    <div className="flex flex-wrap gap-2">
                      {videoInfo.formats.map((fmt) => (
                        <button key={fmt.formatId} onClick={() => setSelectedFormatId(fmt.formatId)}
                          className={`flex flex-col items-center px-4 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${selectedFormatId === fmt.formatId ? "border-red-500 bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400" : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500"}`}
                        >
                          <span>{fmt.quality}</span>
                          {fmt.filesize && <span className="text-xs font-normal opacity-70 mt-0.5">{formatFileSize(fmt.filesize)}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button onClick={handleDownload} disabled={!selectedFormatId}
                    className="flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-white font-semibold text-sm transition-all shadow disabled:opacity-50 disabled:cursor-not-allowed self-start"
                    style={{ backgroundColor: YT_COLOR }}
                  >
                    <Download className="w-4 h-4" />
                    Download {selectedFormat?.quality}
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
