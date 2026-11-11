import { Link } from "wouter";
import { LogoMark } from "./Icons";
import { PLATFORMS, PLATFORM_META } from "@/lib/platforms";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:grid-cols-[1fr_auto] sm:px-6">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5 font-display text-lg font-bold">
            <LogoMark className="size-7" />
            Seba Downloader
          </div>
          <p className="mt-3 text-ink-soft">
            Free and without an account. Only save videos you have the right to keep, and credit the people who made
            them.
          </p>
          <p className="mt-4 text-sm text-ink-soft">
            Made by{" "}
            <a className="underline underline-offset-2 hover:text-ink" href="https://github.com/xyzbuddy" target="_blank" rel="noopener noreferrer">
              xyzbuddy on GitHub
            </a>{" "}
            and{" "}
            <a
              className="underline underline-offset-2 hover:text-ink"
              href="https://www.linkedin.com/in/imxyzbuddy/"
              target="_blank"
              rel="noopener noreferrer"
            >
              LinkedIn
            </a>
            .
          </p>
        </div>
        <nav aria-label="Downloaders">
          <ul className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-1">
            {PLATFORMS.map((p) => (
              <li key={p}>
                <Link href={PLATFORM_META[p].path} className="inline-flex min-h-11 items-center text-ink-soft hover:text-ink">
                  {PLATFORM_META[p].name} downloader
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
