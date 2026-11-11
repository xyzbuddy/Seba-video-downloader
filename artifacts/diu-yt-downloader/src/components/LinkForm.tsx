import { useRef, type FormEvent } from "react";
import { ClipboardPaste, Link2, LoaderCircle, X } from "lucide-react";
import { PlatformIcon } from "./Icons";
import { PLATFORM_META, type Platform } from "@/lib/platforms";

interface Props {
  value: string;
  detected: Platform | null;
  busy: boolean;
  error: string | null;
  help: string;
  onChange(value: string): void;
  onSubmit(value: string): void;
  onClear(): void;
}

const canReadClipboard = typeof navigator !== "undefined" && !!navigator.clipboard?.readText;

export function LinkForm({ value, detected, busy, error, help, onChange, onSubmit, onClear }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(value);
  };

  const pasteFromClipboard = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        onChange(text);
        onSubmit(text);
      } else {
        inputRef.current?.focus();
      }
    } catch {
      // Permission denied: let the person paste with the keyboard instead.
      inputRef.current?.focus();
    }
  };

  const describedBy = error ? "link-help link-error" : "link-help";

  return (
    <form onSubmit={submit} noValidate className="max-w-3xl">
      <label htmlFor="link" className="mb-2 block font-bold">
        Video link
      </label>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div
          className={`flex min-h-16 flex-1 items-center gap-1 rounded-2xl border-2 bg-surface pl-4 pr-1.5 transition-colors focus-within:border-brand ${
            error ? "border-danger" : "border-line"
          }`}
        >
          <span
            className="shrink-0 transition-colors"
            style={{ color: detected ? PLATFORM_META[detected].color : "var(--ink-soft)" }}
          >
            {detected ? <PlatformIcon platform={detected} className="size-6" /> : <Link2 className="size-6" aria-hidden />}
          </span>
          <input
            ref={inputRef}
            id="link"
            name="link"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Paste a video link"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text").trim();
              if (text) {
                e.preventDefault();
                onChange(text);
                onSubmit(text);
              }
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="h-14 min-w-0 flex-1 bg-transparent px-2 text-lg outline-none placeholder:text-ink-soft/80"
          />
          {value && !busy && (
            <button
              type="button"
              onClick={() => {
                onClear();
                inputRef.current?.focus();
              }}
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl text-ink-soft hover:text-ink"
              aria-label="Clear link"
            >
              <X className="size-5" aria-hidden />
            </button>
          )}
          {canReadClipboard && !value && (
            <button
              type="button"
              onClick={pasteFromClipboard}
              className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-3 font-bold text-ink-soft hover:bg-paper hover:text-ink"
            >
              <ClipboardPaste className="size-5" aria-hidden />
              Paste
            </button>
          )}
        </div>

        <button
          type="submit"
          disabled={busy}
          className="flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-brand px-7 text-lg font-bold text-brand-ink transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
        >
          {busy && <LoaderCircle className="size-5 animate-spin" aria-hidden />}
          {busy ? "Looking up" : "Find video"}
        </button>
      </div>

      <p id="link-help" className="mt-3 text-ink-soft">
        {help}
      </p>
      {error && (
        <p id="link-error" role="alert" className="mt-2 rounded-xl bg-danger-bg px-4 py-3 font-bold text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
