import { useLocation } from "wouter";

export default function Footer() {
  const [, navigate] = useLocation();
  return (
    <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 py-8 px-4">
      <div className="max-w-4xl mx-auto text-center">
        <div
          className="flex items-center justify-center gap-2 mb-3 cursor-pointer group"
          onClick={() => navigate("/")}
        >
          <div className="w-7 h-7 rounded-lg bg-green-600 flex items-center justify-center">
            <span className="text-white font-bold text-xs">D</span>
          </div>
          <span className="font-bold text-gray-900 dark:text-white group-hover:text-green-600 transition-colors">
            DIU <span className="text-green-600">Downloader</span>
          </span>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Download videos from YouTube, Facebook, Instagram &amp; TikTok — free &amp; fast.
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-600 mt-3">
          Made with ❤️ · For personal use only · Respect content creators&apos; rights
        </p>
      </div>
    </footer>
  );
}
