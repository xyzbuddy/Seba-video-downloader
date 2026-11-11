import { Link, useLocation } from "wouter";
import { Moon, Sun } from "lucide-react";
import { LogoMark } from "./Icons";
import { PLATFORMS, PLATFORM_META } from "@/lib/platforms";
import { useTheme } from "@/lib/theme";

export function SiteHeader() {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2.5 rounded-md font-display text-xl font-bold tracking-tight"
          aria-label="Seba Downloader home"
        >
          <LogoMark className="size-8" />
          <span>Seba</span>
        </Link>

        <nav aria-label="Platforms" className="order-3 -mx-2 flex w-full sm:order-none sm:mx-0 sm:w-auto sm:flex-1">
          <ul className="flex w-full justify-between sm:justify-start sm:gap-1">
            {PLATFORMS.map((p) => {
              const meta = PLATFORM_META[p];
              const active = location === meta.path;
              return (
                <li key={p}>
                  <Link
                    href={meta.path}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 items-center rounded-md px-2 text-[0.95rem] transition-colors sm:px-3 ${
                      active ? "font-bold text-ink" : "text-ink-soft hover:text-ink"
                    }`}
                    style={active ? { boxShadow: `inset 0 -3px 0 ${meta.color}` } : undefined}
                  >
                    {meta.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <button
          type="button"
          onClick={toggle}
          className="ml-auto grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft transition-colors hover:bg-surface hover:text-ink sm:ml-0"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
        </button>
      </div>
    </header>
  );
}
