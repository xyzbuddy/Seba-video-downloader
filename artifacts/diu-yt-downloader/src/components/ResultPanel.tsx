import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Clock3, Download, LoaderCircle } from "lucide-react";
import { PlatformIcon } from "./Icons";
import { startDownload, type MediaFormat, type MediaInfo } from "@/lib/api";
import { formatDuration, formatSize } from "@/lib/format";
import { PLATFORM_META } from "@/lib/platforms";

type DlState =
  | { state: "idle" }
  | { state: "preparing"; phase?: "starting" | "downloading" | "merging" | "sending"; percent?: number }
  | { state: "started" }
  | { state: "error"; message: string };

function defaultFormat(formats: MediaFormat[]): string {
  const preferred = ["v1080", "nowm", "v720", "best"];
  return (preferred.find((id) => formats.some((f) => f.id === id)) ?? formats[0]?.id) || "";
}

function buttonText(f: MediaFormat | undefined): string {
  if (!f) return "Download";
  if (f.kind === "audio") return "Download audio";
  if (f.id === "nowm") return "Download without watermark";
  if (f.id === "wm") return "Download with watermark";
  if (f.id === "best") return "Download video";
  return `Download ${f.label}`;
}

/**
 * `loadingFormats`: the card was opened from the quick preview and the quality
 * list is still on its way. Title and thumbnail show already.
 */
export function ResultPanel({ info, link, loadingFormats = false }: { info: MediaInfo; link: string; loadingFormats?: boolean }) {
  const [formatId, setFormatId] = useState(() => defaultFormat(info.formats));
  const [dl, setDl] = useState<DlState>({ state: "idle" });
  const [thumbFailed, setThumbFailed] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cancelRef.current?.(), []);

  // pick a default once the quality list arrives after the preview
  useEffect(() => {
    if (info.formats.length && !info.formats.some((f) => f.id === formatId)) setFormatId(defaultFormat(info.formats));
  }, [info.formats, formatId]);

  // a better thumbnail may arrive with the full lookup
  useEffect(() => setThumbFailed(false), [info.thumbnail]);

  const selected = info.formats.find((f) => f.id === formatId);
  const meta = PLATFORM_META[info.platform];
  const duration = formatDuration(info.duration);
  const portrait = info.shape === "portrait";
  const preparing = dl.state === "preparing";

  const download = () => {
    if (!selected || preparing) return;
    setDl({ state: "preparing" });
    cancelRef.current = startDownload({ url: link, format: selected.id, title: info.title }, (e) => {
      if (e.state === "progress") setDl({ state: "preparing", phase: e.phase, percent: e.percent });
      else if (e.state === "started") setDl({ state: "started" });
      else setDl({ state: "error", message: e.message });
    });
  };

  return (
    <section aria-labelledby="result-title" className="reveal mt-10 max-w-3xl rounded-3xl border border-line bg-surface p-4 sm:p-6">
      <div className={`flex flex-col gap-5 ${portrait ? "sm:flex-row" : "md:flex-row"}`}>
        <div
          className={`relative shrink-0 self-start overflow-hidden rounded-2xl bg-paper ${
            portrait ? "mx-auto aspect-[9/16] w-40 sm:mx-0" : "aspect-video w-full md:w-72"
          }`}
        >
          {info.thumbnail && !thumbFailed ? (
            <img
              src={info.thumbnail}
              alt=""
              referrerPolicy="no-referrer"
              loading="lazy"
              decoding="async"
              onError={() => setThumbFailed(true)}
              className="size-full object-cover"
            />
          ) : (
            <div className="grid size-full place-items-center" style={{ color: meta.color }}>
              <PlatformIcon platform={info.platform} className="size-10" />
            </div>
          )}
          {duration && (
            <span className="absolute right-2 bottom-2 rounded-md bg-black/75 px-1.5 py-0.5 text-sm font-bold text-white tabular-nums">
              {duration}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-bold" style={{ color: meta.color }}>
            <PlatformIcon platform={info.platform} className="size-4" />
            {meta.name}
          </p>
          {info.title ? (
            <h2 id="result-title" className="mt-1 line-clamp-3 text-xl leading-snug font-bold sm:text-2xl">
              {info.title}
            </h2>
          ) : (
            <h2 id="result-title" className="mt-2 space-y-2">
              <span className="sr-only">Loading video details</span>
              <span className="skeleton block h-6 w-11/12 rounded" aria-hidden />
              <span className="skeleton block h-6 w-2/3 rounded" aria-hidden />
            </h2>
          )}
          {(info.author || duration) && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-ink-soft">
              {info.author && <li>{info.author}</li>}
              {duration && (
                <li className="flex items-center gap-1.5">
                  <Clock3 className="size-4" aria-hidden />
                  <span className="sr-only">Length </span>
                  {duration}
                </li>
              )}
            </ul>
          )}

          {loadingFormats ? (
            <div className="mt-5" aria-busy="true">
              <p className="mb-2 font-bold">Quality</p>
              <div className="flex flex-wrap gap-2" aria-hidden>
                {[64, 64, 72, 104].map((w, i) => (
                  <span key={i} className="skeleton block h-11 rounded-full" style={{ width: w + 16 }} />
                ))}
              </div>
              <p className="mt-2 text-ink-soft">Finding the available qualities.</p>
            </div>
          ) : info.formats.length > 1 ? (
            <fieldset className="mt-5" disabled={preparing}>
              <legend className="mb-2 font-bold">Quality</legend>
              <div className="flex flex-wrap gap-2">
                {info.formats.map((f) => {
                  const size = formatSize(f.size);
                  return (
                    <label
                      key={f.id}
                      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-line px-4 transition-colors hover:border-ink-soft has-checked:border-ink has-checked:bg-ink has-checked:text-paper has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand has-disabled:cursor-not-allowed"
                    >
                      <input
                        type="radio"
                        name="quality"
                        value={f.id}
                        checked={formatId === f.id}
                        onChange={() => {
                          setFormatId(f.id);
                          if (dl.state !== "preparing") setDl({ state: "idle" });
                        }}
                        className="sr-only"
                      />
                      <span className="font-bold">{f.label}</span>
                      {size && <span className="text-sm opacity-75">{size}</span>}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : (
            selected && (
              <p className="mt-5 text-ink-soft">
                {selected.label === "Best available" ? "Saved in the best quality available." : selected.label}
                {formatSize(selected.size) ? `, about ${formatSize(selected.size)}` : ""}
              </p>
            )
          )}

          <button
            type="button"
            onClick={download}
            disabled={!selected || preparing || loadingFormats}
            className="mt-5 flex min-h-14 w-full cursor-pointer items-center justify-center gap-2.5 rounded-2xl bg-action px-6 text-lg font-bold text-action-ink transition-colors hover:bg-action-hover disabled:cursor-wait disabled:opacity-80 sm:w-auto"
          >
            {preparing || loadingFormats ? (
              <LoaderCircle className="size-5 animate-spin" aria-hidden />
            ) : (
              <Download className="size-5" aria-hidden />
            )}
            {preparing ? "Preparing file" : loadingFormats ? "Download" : buttonText(selected)}
          </button>

          {dl.state === "preparing" && dl.phase === "downloading" && (
            <div
              role="progressbar"
              aria-label="Preparing file"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={dl.percent ?? 0}
              className="mt-4 h-2 overflow-hidden rounded-full bg-line"
            >
              <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${dl.percent ?? 0}%` }} />
            </div>
          )}

          <div aria-live="polite" className="mt-3 min-h-6">
            {dl.state === "preparing" && (
              <p className="text-ink-soft">
                {dl.phase === "downloading"
                  ? `Fetching the video, ${dl.percent ?? 0}% done. Your download starts when it reaches 100%.`
                  : dl.phase === "merging"
                    ? "Joining picture and sound. Almost ready."
                    : dl.phase === "sending"
                      ? "Starting your download."
                      : "Getting the file ready. High qualities and long videos can take a minute."}
              </p>
            )}
            {dl.state === "started" && (
              <p className="flex items-start gap-2 font-bold text-ok">
                <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
                Download started. You'll find it in your browser's downloads
                {formatSize(selected?.size) ? `; the finished file is about ${formatSize(selected?.size)}.` : "."}
              </p>
            )}
            {dl.state === "error" && (
              <p role="alert" className="flex items-start gap-2 font-bold text-danger">
                <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
                {dl.message}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ResultSkeleton({ portrait }: { portrait: boolean }) {
  return (
    <section aria-busy="true" className="mt-10 max-w-3xl rounded-3xl border border-line bg-surface p-4 sm:p-6">
      <div className={`flex flex-col gap-5 ${portrait ? "sm:flex-row" : "md:flex-row"}`}>
        <div className={`skeleton shrink-0 self-start rounded-2xl ${portrait ? "mx-auto aspect-[9/16] w-40 sm:mx-0" : "aspect-video w-full md:w-72"}`} />
        <div className="flex-1 space-y-3 pt-1">
          <div className="skeleton h-4 w-24 rounded" />
          <div className="skeleton h-7 w-11/12 rounded" />
          <div className="skeleton h-7 w-2/3 rounded" />
          <p className="pt-3 text-ink-soft">Looking up the video. This usually takes a few seconds.</p>
        </div>
      </div>
    </section>
  );
}
