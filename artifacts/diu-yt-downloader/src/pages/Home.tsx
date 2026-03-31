import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Download, Youtube, Info, AlertCircle, Play, Eye } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Import generated API hooks and types
import {
  useGetVideoInfo,
  getGetVideoInfoQueryKey,
  useGetDownloadUrl,
  getGetDownloadUrlQueryKey
} from "@workspace/api-client-react";

export default function Home() {
  const [inputUrl, setInputUrl] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);
  
  const { toast } = useToast();

  // Basic client-side validation
  const isValidYoutubeUrl = (url: string) => {
    return /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[a-zA-Z0-9_-]{11}/.test(url);
  };

  const handleFetch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputUrl.trim()) return;
    
    if (!isValidYoutubeUrl(inputUrl)) {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid YouTube video link.",
        variant: "destructive"
      });
      return;
    }
    
    // Clear previously selected format when fetching new video
    setSelectedFormatId(null);
    setActiveUrl(inputUrl);
  };

  // Auto-fetch when a valid YouTube URL is detected in the input
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = inputUrl.trim();
      if (trimmed && isValidYoutubeUrl(trimmed) && trimmed !== activeUrl) {
        setSelectedFormatId(null);
        setActiveUrl(trimmed);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [inputUrl]);

  // Video Info Query
  const { 
    data: videoInfo, 
    isLoading: isFetchingInfo,
    isError: isInfoError,
    error: infoError
  } = useGetVideoInfo(
    { url: activeUrl },
    { 
      query: { 
        enabled: !!activeUrl && isValidYoutubeUrl(activeUrl),
        queryKey: getGetVideoInfoQueryKey({ url: activeUrl }),
        retry: 1,
      } 
    }
  );

  useEffect(() => {
    if (isInfoError) {
      toast({
        title: "Error fetching video",
        description: "This video might be unavailable, private, or region-locked.",
        variant: "destructive"
      });
    }
  }, [isInfoError, toast]);

  // Selected Format for download
  const selectedFormat = useMemo(() => {
    if (!videoInfo || !selectedFormatId) return null;
    return videoInfo.formats.find(f => f.formatId === selectedFormatId);
  }, [videoInfo, selectedFormatId]);

  // Download URL Query (triggered manually via refetch)
  const {
    refetch: triggerDownload,
    isFetching: isGettingDownloadUrl
  } = useGetDownloadUrl(
    { 
      url: activeUrl, 
      formatId: selectedFormatId || "", 
      quality: selectedFormat?.quality || "" 
    },
    {
      query: {
        enabled: false,
        queryKey: getGetDownloadUrlQueryKey({ 
          url: activeUrl, 
          formatId: selectedFormatId || "", 
          quality: selectedFormat?.quality || "" 
        })
      }
    }
  );

  const handleDownload = async () => {
    if (!selectedFormat) return;
    
    try {
      const { data } = await triggerDownload();
      if (data && data.downloadUrl) {
        window.open(data.downloadUrl, '_blank');
        toast({
          title: "Download started",
          description: `Downloading ${selectedFormat.quality} video...`,
        });
      } else {
        throw new Error("No download URL returned");
      }
    } catch (err) {
      toast({
        title: "Download failed",
        description: "Failed to generate a download link. Please try another resolution.",
        variant: "destructive"
      });
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "";
    const mb = bytes / (1024 * 1024);
    if (mb < 1000) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  };

  const formatViews = (views?: number) => {
    if (!views) return "";
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M views`;
    if (views >= 1000) return `${(views / 1000).toFixed(1)}K views`;
    return `${views} views`;
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-between p-4 md:p-8 lg:p-12">
      
      {/* Main Content Wrapper */}
      <main className="w-full max-w-4xl flex-1 flex flex-col items-center justify-center gap-12 mt-10 md:mt-20 mb-20">
        
        {/* Header */}
        <div className="text-center space-y-4 w-full">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center justify-center gap-3 bg-secondary/10 px-4 py-2 rounded-full border border-secondary/20 mb-4"
          >
            <Youtube className="w-5 h-5 text-primary" />
            <span className="text-sm font-semibold text-secondary-foreground">DIU YT Downloader</span>
          </motion.div>
          
          <motion.h1 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-4xl md:text-6xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-br from-white to-white/60 drop-shadow-sm"
          >
            Powerful YouTube <br className="hidden md:block"/> Video Downloader
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-muted-foreground text-lg md:text-xl max-w-xl mx-auto font-medium"
          >
            Paste your link below to fetch metadata, choose your preferred resolution, and download fast & free.
          </motion.p>
        </div>

        {/* Input Form */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="w-full max-w-3xl relative z-10"
        >
          <form 
            onSubmit={handleFetch}
            className="relative flex items-center w-full bg-input/50 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl overflow-hidden focus-within:ring-2 focus-within:ring-primary/50 transition-all duration-300"
          >
            <div className="pl-6 pr-2 text-muted-foreground flex-shrink-0">
              <Youtube className="w-6 h-6 opacity-60" />
            </div>
            <Input 
              type="url"
              data-testid="input-youtube-url"
              placeholder="Paste YouTube link here..."
              className="flex-1 h-16 md:h-20 text-lg md:text-xl bg-transparent border-0 focus-visible:ring-0 px-2 rounded-none placeholder:text-muted-foreground/60 text-white"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              disabled={isFetchingInfo}
            />
            <div className="pr-2 md:pr-3">
              <Button 
                type="submit" 
                size="lg"
                disabled={!inputUrl.trim() || isFetchingInfo}
                data-testid="button-fetch-video"
                className="h-12 md:h-14 px-6 md:px-10 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold text-lg transition-all duration-300 shadow-[0_0_20px_-5px_hsl(var(--primary))] hover:shadow-[0_0_30px_-5px_hsl(var(--primary))] disabled:opacity-50 disabled:shadow-none"
              >
                {isFetchingInfo ? <Spinner className="w-5 h-5 mr-2" /> : "Paste"}
              </Button>
            </div>
          </form>
        </motion.div>

        {/* Preview & Results Area */}
        <AnimatePresence mode="wait">
          {isFetchingInfo && (
            <motion.div 
              key="loading"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-3xl glass-card rounded-3xl border border-white/5 p-6 space-y-6"
            >
              <div className="flex flex-col md:flex-row gap-6">
                <Skeleton className="w-full md:w-[320px] aspect-video rounded-2xl bg-white/5" />
                <div className="flex-1 space-y-4 py-2">
                  <Skeleton className="h-8 w-3/4 bg-white/5" />
                  <Skeleton className="h-6 w-1/2 bg-white/5" />
                  <Skeleton className="h-4 w-1/3 bg-white/5 mt-4" />
                </div>
              </div>
              <Skeleton className="h-24 w-full bg-white/5 rounded-2xl mt-8" />
            </motion.div>
          )}

          {videoInfo && !isFetchingInfo && !isInfoError && (
            <motion.div 
              key="result"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, type: "spring", bounce: 0.4 }}
              className="w-full max-w-4xl"
            >
              <Card className="bg-card/40 backdrop-blur-xl border-white/10 shadow-2xl overflow-hidden rounded-3xl">
                <CardContent className="p-0">
                  <div className="flex flex-col md:flex-row border-b border-white/10">
                    {/* Thumbnail Section */}
                    <div className="w-full md:w-[40%] lg:w-[45%] relative group">
                      <div className="aspect-video relative overflow-hidden bg-black/50">
                        <img 
                          src={videoInfo.thumbnail} 
                          alt={videoInfo.title} 
                          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                          data-testid="img-video-thumbnail"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                        <div className="absolute bottom-3 right-3 bg-black/80 backdrop-blur-sm text-white text-xs font-mono px-2 py-1 rounded flex items-center gap-1.5 border border-white/10">
                          <Play className="w-3 h-3 text-primary" />
                          {videoInfo.durationFormatted}
                        </div>
                      </div>
                    </div>
                    
                    {/* Info Section */}
                    <div className="flex-1 p-6 md:p-8 flex flex-col justify-center">
                      <Badge variant="outline" className="w-fit mb-3 bg-secondary/10 text-secondary border-secondary/30">
                        Ready to download
                      </Badge>
                      <h2 
                        className="text-2xl font-bold leading-tight mb-2 line-clamp-2 text-white"
                        data-testid="text-video-title"
                        title={videoInfo.title}
                      >
                        {videoInfo.title}
                      </h2>
                      
                      <div className="flex flex-wrap items-center gap-4 text-muted-foreground mt-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                            <Youtube className="w-4 h-4 text-white" />
                          </div>
                          <span className="font-medium text-white/90" data-testid="text-channel-name">
                            {videoInfo.channelName}
                          </span>
                        </div>
                        {videoInfo.viewCount && (
                          <div className="flex items-center gap-1.5 text-sm">
                            <Eye className="w-4 h-4 opacity-60" />
                            {formatViews(videoInfo.viewCount)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Resolution Selection Area */}
                  <div className="p-6 md:p-8 bg-black/20">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Download className="w-5 h-5 text-primary" />
                        Select Resolution
                      </h3>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
                      {videoInfo.formats.map((format) => {
                        const isSelected = selectedFormatId === format.formatId;
                        return (
                          <button
                            key={format.formatId}
                            data-testid={`card-format-${format.formatId}`}
                            onClick={() => setSelectedFormatId(format.formatId)}
                            className={`
                              relative flex flex-col items-center justify-center p-4 rounded-2xl border transition-all duration-300
                              ${isSelected 
                                ? 'bg-primary/10 border-primary shadow-[0_0_15px_-3px_hsl(var(--primary)/0.3)]' 
                                : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                              }
                            `}
                          >
                            {isSelected && (
                              <motion.div 
                                layoutId="activeFormat"
                                className="absolute inset-0 rounded-2xl border-2 border-primary"
                                initial={false}
                                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                              />
                            )}
                            <span className={`text-xl font-bold mb-1 ${isSelected ? 'text-primary' : 'text-white'}`}>
                              {format.quality}
                            </span>
                            <div className="flex items-center gap-2 text-xs font-mono">
                              <span className="uppercase text-muted-foreground">{format.ext}</span>
                              {format.filesize && (
                                <>
                                  <span className="text-white/20">•</span>
                                  <span className="text-muted-foreground">{formatFileSize(format.filesize)}</span>
                                </>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Download Action */}
                    <div className="flex justify-center">
                      <Button
                        size="lg"
                        data-testid="button-download"
                        disabled={!selectedFormatId || isGettingDownloadUrl}
                        onClick={handleDownload}
                        className={`
                          w-full md:w-auto min-w-[280px] h-16 rounded-xl text-lg font-bold transition-all duration-300
                          ${selectedFormatId 
                            ? 'bg-primary hover:bg-primary/90 text-white animate-[pulse-glow_2s_infinite]' 
                            : 'bg-white/5 text-white/40 cursor-not-allowed'
                          }
                        `}
                      >
                        {isGettingDownloadUrl ? (
                          <>
                            <Spinner className="w-5 h-5 mr-3" />
                            Generating Link...
                          </>
                        ) : selectedFormatId ? (
                          <>
                            <Download className="w-6 h-6 mr-3" />
                            Download {selectedFormat?.quality}
                          </>
                        ) : (
                          "Select a resolution above"
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {isInfoError && !isFetchingInfo && (
            <motion.div 
              key="error"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-2xl bg-destructive/10 border border-destructive/30 text-destructive-foreground p-6 rounded-2xl flex flex-col items-center text-center gap-4 mt-8"
            >
              <AlertCircle className="w-12 h-12 text-destructive" />
              <div>
                <h3 className="text-xl font-semibold mb-2">Failed to fetch video</h3>
                <p className="text-white/70">
                  {infoError?.message || "The video might be unavailable, private, or region-locked. Please check the URL and try again."}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </main>

      {/* Footer */}
      <footer className="w-full py-6 flex flex-col items-center justify-center gap-2 border-t border-white/5 text-center mt-auto">
        <div className="flex items-center gap-2 opacity-60">
          <Youtube className="w-4 h-4" />
          <span className="font-semibold tracking-wide">DIU YT Downloader</span>
        </div>
        <p className="text-xs text-muted-foreground max-w-md">
          <span className="flex items-center justify-center gap-1 mb-1">
            <Info className="w-3 h-3" /> For educational purposes only.
          </span>
          Please respect YouTube's Terms of Service and copyright laws. Do not download copyrighted material without permission.
        </p>
      </footer>
    </div>
  );
}
