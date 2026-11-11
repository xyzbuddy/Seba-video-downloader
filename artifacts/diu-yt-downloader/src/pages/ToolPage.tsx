import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LinkForm } from "@/components/LinkForm";
import { ResultPanel, ResultSkeleton } from "@/components/ResultPanel";
import { HowItWorks, Questions } from "@/components/InfoSections";
import { fetchInfo, fetchPreview, type MediaInfo, type Preview } from "@/lib/api";
import { PLATFORMS, PLATFORM_META, detectPlatform, parseLink, type Platform } from "@/lib/platforms";

type Lookup =
  | { status: "idle" }
  | { status: "loading"; platform: Platform; link: string; preview?: Preview }
  | { status: "ready"; info: MediaInfo; link: string }
  | { status: "error"; message: string };

const HOME_HEADLINE = "Save videos from YouTube, Facebook, Instagram and TikTok.";
const HOME_INTRO = "Paste a link, pick a quality, and the file lands in your downloads. No account, no app, up to 4K.";

/**
 * Wrap platform names in the headline so they can light up.
 * Home page: a name lights up when a link from that platform is pasted.
 * Platform page: its own name is always in the brand color, and gains the
 * underline once a matching link is pasted.
 */
function Headline({ text, detected, page }: { text: string; detected: Platform | null; page?: Platform }) {
  const names = PLATFORMS.map((p) => PLATFORM_META[p].name);
  const parts = text.split(new RegExp(`(${names.join("|")})`));
  return (
    <>
      {parts.map((part, i) => {
        const p = PLATFORMS.find((x) => PLATFORM_META[x].name === part);
        if (!p) return <Fragment key={i}>{part}</Fragment>;
        const state = page
          ? p === page
            ? detected === p
              ? "active"
              : "brand"
            : undefined
          : !detected
            ? undefined
            : detected === p
              ? "active"
              : "dim";
        return (
          <span key={i} className="platform-name" data-state={state} style={{ ["--pc" as string]: PLATFORM_META[p].color }}>
            {part}
          </span>
        );
      })}
    </>
  );
}

export function ToolPage({ platform }: { platform?: Platform }) {
  const meta = platform ? PLATFORM_META[platform] : null;
  const [link, setLink] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const detected = detectPlatform(link);

  useEffect(() => {
    document.title = meta ? `${meta.name} video downloader | Seba` : "Seba Downloader";
  }, [meta]);

  const run = useCallback(async (raw: string) => {
    const value = raw.trim();
    abortRef.current?.abort();
    if (!value) {
      setLookup({ status: "error", message: "Paste a video link first." });
      return;
    }
    const found = detectPlatform(value);
    if (!found) {
      setLookup({
        status: "error",
        message: parseLink(value)
          ? "That link isn't from YouTube, Facebook, Instagram or TikTok. Copy the link from the video's Share button and try again."
          : "That doesn't look like a link. It should start with https://",
      });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLookup({ status: "loading", platform: found, link: value });

    // The quick preview (title, thumbnail) usually lands well before the full
    // lookup, so show the card with it while the qualities are still coming.
    let preview: Preview | null = null;
    fetchPreview(value, controller.signal).then((p) => {
      if (controller.signal.aborted || !p || (!p.title && !p.thumbnail)) return;
      preview = p;
      setLookup((prev) => (prev.status === "loading" && prev.link === value ? { ...prev, preview: p } : prev));
    });

    try {
      const info = await fetchInfo(value, controller.signal);
      if (controller.signal.aborted) return;
      const p = preview as Preview | null;
      setLookup({ status: "ready", info: { ...info, thumbnail: info.thumbnail || p?.thumbnail }, link: value });
      const url = new URL(window.location.href);
      url.searchParams.set("url", value);
      window.history.replaceState(window.history.state, "", url);
    } catch (err) {
      if (controller.signal.aborted) return;
      setLookup({ status: "error", message: (err as Error).message });
    }
  }, []);

  // Deep link: /youtube?url=…
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("url");
    if (initial) {
      setLink(initial);
      run(initial);
    }
    return () => abortRef.current?.abort();
  }, [run]);

  const clear = () => {
    abortRef.current?.abort();
    setLink("");
    setLookup({ status: "idle" });
    const url = new URL(window.location.href);
    url.searchParams.delete("url");
    window.history.replaceState(window.history.state, "", url);
  };

  let result: ReactNode = null;
  if (lookup.status === "loading" && lookup.preview) {
    const p = lookup.preview;
    result = (
      <ResultPanel
        key={lookup.link}
        info={{ platform: p.platform, title: p.title ?? "", author: p.author, thumbnail: p.thumbnail, shape: p.shape, formats: [] }}
        link={lookup.link}
        loadingFormats
      />
    );
  } else if (lookup.status === "loading") {
    result = <ResultSkeleton portrait={lookup.platform === "tiktok" || lookup.platform === "instagram"} />;
  } else if (lookup.status === "ready") {
    result = <ResultPanel key={lookup.link} info={lookup.info} link={lookup.link} />;
  }

  return (
    <main id="main" className="mx-auto max-w-5xl px-4 sm:px-6">
      <section className="pt-12 sm:pt-20" aria-labelledby="headline">
        <h1
          id="headline"
          className="max-w-[15ch] text-[clamp(2.6rem,7.5vw,5rem)] leading-[1.02] font-bold tracking-[-0.025em]"
        >
          <Headline text={meta ? meta.headline : HOME_HEADLINE} detected={detected} page={platform} />
        </h1>
        <p className="mt-6 max-w-[52ch] text-lg text-ink-soft sm:text-xl">{meta ? meta.intro : HOME_INTRO}</p>

        <div className="mt-10">
          <LinkForm
            value={link}
            detected={detected}
            busy={lookup.status === "loading"}
            error={lookup.status === "error" ? lookup.message : null}
            help={meta ? meta.findLink : "Links from YouTube, Facebook, Instagram and TikTok work. The video has to be public."}
            onChange={(v) => {
              setLink(v);
              if (lookup.status === "error") setLookup({ status: "idle" });
            }}
            onSubmit={run}
            onClear={clear}
          />
        </div>

        {result}
      </section>

      <HowItWorks platform={platform} />
      <Questions />
    </main>
  );
}
