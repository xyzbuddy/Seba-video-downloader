import { useState } from "react";
import { useLocation } from "wouter";
import { Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "@/contexts/ThemeContext";

const NAV_ITEMS = [
  { path: "/", label: "Home", color: "#22c55e", exact: true },
  { path: "/youtube", label: "YouTube", color: "#FF0000" },
  { path: "/facebook", label: "Facebook", color: "#1877F2" },
  { path: "/instagram", label: "Instagram", color: "#C13584" },
  { path: "/tiktok", label: "TikTok", color: "#010101" },
];

function PillToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggleTheme}
      aria-label="Toggle theme"
      className="relative flex items-center w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none flex-shrink-0"
      style={{ backgroundColor: isDark ? "#1f2937" : "#22c55e" }}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="absolute w-5 h-5 rounded-full bg-white shadow-md"
        style={{ left: isDark ? "2px" : "calc(100% - 22px)" }}
      />
    </button>
  );
}

export default function Header() {
  const [location, navigate] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleNav = (path: string) => {
    navigate(path);
    setMenuOpen(false);
  };

  const isActive = (item: typeof NAV_ITEMS[number]) => {
    if (item.exact) return location === item.path;
    return location.startsWith(item.path);
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/95 dark:bg-gray-950/95 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          <div
            className="flex items-center gap-2.5 cursor-pointer"
            onClick={() => navigate("/")}
          >
            <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-sm">S</span>
            </div>
            <span className="font-bold text-lg text-gray-900 dark:text-white">
              Seba <span className="text-green-600">Downloader</span>
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item);
              return (
                <button
                  key={item.path}
                  onClick={() => handleNav(item.path)}
                  className="relative px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150"
                  style={active ? { backgroundColor: item.color, color: "#fff" } : {}}
                >
                  {!active && (
                    <span className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">
                      {item.label}
                    </span>
                  )}
                  {active && item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-3">
            <PillToggle />
            <button
              className="md:hidden p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menu"
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 overflow-hidden"
          >
            <div className="px-4 py-2 flex flex-col gap-1">
              {NAV_ITEMS.map((item) => {
                const active = isActive(item);
                return (
                  <button
                    key={item.path}
                    onClick={() => handleNav(item.path)}
                    className="w-full text-left px-4 py-3 rounded-lg text-sm font-semibold transition-all"
                    style={active ? { backgroundColor: item.color, color: "#fff" } : {}}
                  >
                    {!active && (
                      <span className="text-gray-600 dark:text-gray-300">{item.label}</span>
                    )}
                    {active && item.label}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
