import { useSearch } from "wouter";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FacebookSection from "@/components/sections/FacebookSection";

export default function FacebookPage() {
  const search = useSearch();
  const autoUrl = new URLSearchParams(search).get("url") || undefined;

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex flex-col">
      <Header />
      <main className="flex-1 pt-16">
        <FacebookSection autoUrl={autoUrl} />
      </main>
      <Footer />
    </div>
  );
}
