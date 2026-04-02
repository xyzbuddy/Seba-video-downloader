import { useRef, useState } from "react";
import { motion } from "framer-motion";
import Header from "@/components/Header";
import HeroSection from "@/components/sections/HeroSection";
import YouTubeSection from "@/components/sections/YouTubeSection";
import FacebookSection from "@/components/sections/FacebookSection";
import InstagramSection from "@/components/sections/InstagramSection";
import TikTokSection from "@/components/sections/TikTokSection";
import type { Platform } from "@/lib/platformUtils";

export default function Home() {
  const ytRef = useRef<HTMLDivElement>(null);
  const fbRef = useRef<HTMLDivElement>(null);
  const igRef = useRef<HTMLDivElement>(null);
  const ttRef = useRef<HTMLDivElement>(null);

  // State for hero auto-detect → pass URL to the matching section
  const [ytAutoUrl, setYtAutoUrl] = useState<string | undefined>();
  const [fbAutoUrl, setFbAutoUrl] = useState<string | undefined>();
  const [igAutoUrl, setIgAutoUrl] = useState<string | undefined>();
  const [ttAutoUrl, setTtAutoUrl] = useState<string | undefined>();

  const scrollToRef = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (ref.current) {
      const top = ref.current.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top, behavior: "smooth" });
    }
  };

  const handleNavClick = (sectionId: string) => {
    const refMap: Record<string, React.RefObject<HTMLDivElement | null>> = {
      youtube: ytRef,
      facebook: fbRef,
      instagram: igRef,
      tiktok: ttRef,
    };
    const ref = refMap[sectionId];
    if (ref) scrollToRef(ref);
  };

  const handleHeroSubmit = (url: string, platform: Platform) => {
    // Set the URL on the matching section, then scroll to it
    if (platform === "youtube") { setYtAutoUrl(url); setTimeout(() => scrollToRef(ytRef), 100); }
    if (platform === "facebook") { setFbAutoUrl(url); setTimeout(() => scrollToRef(fbRef), 100); }
    if (platform === "instagram") { setIgAutoUrl(url); setTimeout(() => scrollToRef(igRef), 100); }
    if (platform === "tiktok") { setTtAutoUrl(url); setTimeout(() => scrollToRef(ttRef), 100); }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header onNavClick={handleNavClick} />

      <main>
        <HeroSection onSubmit={handleHeroSubmit} />

        {/* Divider wave */}
        <div className="bg-white dark:bg-gray-900">
          <div ref={ytRef}>
            <YouTubeSection autoUrl={ytAutoUrl} />
          </div>
          <div ref={fbRef}>
            <FacebookSection autoUrl={fbAutoUrl} />
          </div>
          <div ref={igRef}>
            <InstagramSection autoUrl={igAutoUrl} />
          </div>
          <div ref={ttRef}>
            <TikTokSection autoUrl={ttAutoUrl} />
          </div>
        </div>

        {/* Footer */}
        <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 py-8 px-4 mt-0">
          <div className="max-w-4xl mx-auto text-center">
            <div className="flex items-center justify-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-green-600 flex items-center justify-center">
                <span className="text-white font-bold text-xs">D</span>
              </div>
              <span className="font-bold text-gray-900 dark:text-white">DIU <span className="text-green-600">Downloader</span></span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Download videos from YouTube, Facebook, Instagram &amp; TikTok — free &amp; fast.
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-600 mt-3">
              Made with ❤️ · For personal use only · Respect content creators' rights
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
