import { useSearch } from "wouter";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import InstagramSection from "@/components/sections/InstagramSection";

export default function InstagramPage() {
  const search = useSearch();
  const autoUrl = new URLSearchParams(search).get("url") || undefined;

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex flex-col">
      <Header />
      <main className="flex-1 pt-16">
        <InstagramSection autoUrl={autoUrl} />
      </main>
      <Footer />
    </div>
  );
}
