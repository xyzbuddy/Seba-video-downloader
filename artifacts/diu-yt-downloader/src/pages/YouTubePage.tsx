import { useSearch } from "wouter";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import YouTubeSection from "@/components/sections/YouTubeSection";

export default function YouTubePage() {
  const search = useSearch();
  const autoUrl = new URLSearchParams(search).get("url") || undefined;

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex flex-col">
      <Header />
      <main className="flex-1 pt-16">
        <YouTubeSection autoUrl={autoUrl} />
      </main>
      <Footer />
    </div>
  );
}
