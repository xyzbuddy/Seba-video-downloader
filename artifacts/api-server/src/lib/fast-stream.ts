/**
 * Instant-start downloads.
 *
 * The page's lookup already ran yt-dlp and got every stream URL. We keep that
 * result for a while, so clicking Download needs no second yt-dlp run:
 *   - one stream (pre-merged video, or audio)  → fetched in byte-range chunks
 *     and sent as it arrives, with a real Content-Length;
 *   - separate video + audio                   → both fetched in chunks and fed
 *     to ffmpeg over pipes, which joins them into a streamable MP4 on the fly.
 * The first bytes typically reach the browser in under a second.
 */
import { spawn } from "child_process";
import { Readable } from "stream";
import type { Request, Response } from "express";
import { FFMPEG, BROWSER_UA, commitDownload, type DownloadTarget } from "./media-utils";

// ── lookup cache ──────────────────────────────────────────────────────────────
const TTL_MS = 30 * 60_000;
const cache = new Map<string, { json: any; at: number }>();

export function rememberInfo(key: string, json: any) {
  cache.set(key, { json, at: Date.now() });
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

export function recallInfo(key: string): any | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.json;
}

export function forgetInfo(key: string) {
  cache.delete(key);
}

const inflight = new Map<string, Promise<any>>();

/** Cached lookup; concurrent callers for the same key share one yt-dlp run. */
export function cachedLookup(key: string, run: () => Promise<any>): Promise<any> {
  const hit = recallInfo(key);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(key);
  if (!p) {
    p = run()
      .then((json) => {
        rememberInfo(key, json);
        return json;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

// ── picking streams from a yt-dlp JSON ───────────────────────────────────────
interface Stream {
  id: string;
  url: string;
  headers: Record<string, string>;
  /** file extension when sent on its own */
  outExt: string;
  /** Content-Type when sent on its own */
  mime: string;
  /** size in bytes when yt-dlp reported it */
  size?: number;
  /**
   * Get a fresh URL for this same stream (same bytes). YouTube sometimes
   * starts refusing a link part-way through (403); the download then carries
   * on from the same byte with a new link instead of stopping.
   */
  refresh?: () => Promise<{ url: string; headers: Record<string, string> } | null>;
}

/**
 * Candidates are ranked best-first. YouTube sometimes refuses one stream (403)
 * while serving an equivalent one, so we fall through the list quickly.
 */
export type Selection =
  | { kind: "single"; streams: Stream[] }
  | { kind: "mux"; videos: Stream[]; audios: Stream[] };

const isHttp = (f: any) => typeof f.url === "string" && /^https?$/.test(f.protocol ?? "https");
const hasV = (f: any) => f.vcodec && f.vcodec !== "none";
const hasA = (f: any) => f.acodec && f.acodec !== "none";
const edge = (f: any) => (typeof f.width === "number" && typeof f.height === "number" ? Math.min(f.width, f.height) : f.height ?? 0);
const codecRank = (f: any) => (/^avc1|^h264/.test(f.vcodec) ? 3 : /^vp0?9/.test(f.vcodec) ? 2 : 1); // plays-everywhere first
// HDR streams look washed out on ordinary screens and players: prefer SDR
const sdr = (f: any) => Number(!f.dynamic_range || f.dynamic_range === "SDR");

function toStream(f: any): Stream {
  const audioOnly = !hasV(f);
  const webm = f.ext === "webm";
  return {
    id: String(f.format_id),
    url: f.url,
    headers: f.http_headers ?? {},
    outExt: webm ? "webm" : audioOnly ? "m4a" : "mp4",
    mime: `${audioOnly ? "audio" : "video"}/${webm ? "webm" : "mp4"}`,
    size: typeof f.filesize === "number" ? f.filesize : typeof f.filesize_approx === "number" ? f.filesize_approx : undefined,
  };
}

/**
 * Size of the file a download of `formatId` will actually produce: computed
 * from the same streams `pickStreams` chooses, so the size shown on the
 * quality button matches the downloaded file.
 */
export function selectionSize(json: any, formatId: string): number | undefined {
  const sel = pickStreams(json, formatId);
  if (!sel) return undefined;
  if (sel.kind === "single") return sel.streams[0]?.size;
  const v = sel.videos[0]?.size;
  const a = sel.audios[0]?.size;
  return v && a ? v + a : undefined;
}

function audioCandidates(formats: any[]): any[] {
  return formats
    .filter((f) => isHttp(f) && hasA(f) && !hasV(f))
    .sort(
      (a, b) =>
        Number(b.ext === "m4a") - Number(a.ext === "m4a") ||
        Number(!/drc/i.test(b.format_id)) - Number(!/drc/i.test(a.format_id)) ||
        (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0),
    )
    .slice(0, 4);
}

/**
 * A selection made of known direct URLs (TikTok/Instagram sources), ranked
 * best-first. `ext` is the file extension to save as.
 */
export function directSelection(
  sources: { url?: string; headers?: Record<string, string> }[],
  kind: "video" | "audio" = "video",
  ext = kind === "audio" ? "m4a" : "mp4",
): Selection | null {
  const mime = ext === "mp3" ? "audio/mpeg" : `${kind}/${ext === "m4a" ? "mp4" : ext}`;
  const streams = sources
    .filter((s): s is { url: string; headers?: Record<string, string> } => !!s.url)
    .map((s, i) => ({ id: `direct${i}`, url: s.url, headers: s.headers ?? {}, outExt: ext, mime }));
  return streams.length ? { kind: "single", streams } : null;
}

/** Choose the stream(s) for one of our format ids ("v1080", "audio", "best"). */
export function pickStreams(json: any, formatId: string): Selection | null {
  const formats: any[] = Array.isArray(json?.formats) ? json.formats : [];

  if (formatId === "audio") {
    const audios = audioCandidates(formats).map(toStream);
    return audios.length ? { kind: "single", streams: audios } : null;
  }

  const m = /^v(\d{3,4})$/.exec(formatId);
  const limit = m ? Number(m[1]) * 1.1 : formatId === "best" ? Infinity : null;
  if (limit === null) return null;

  const order = (a: any, b: any) =>
    edge(b) - edge(a) ||
    sdr(b) - sdr(a) ||
    codecRank(b) - codecRank(a) ||
    Number(b.ext === "mp4") - Number(a.ext === "mp4") ||
    (b.tbr ?? 0) - (a.tbr ?? 0);
  const muxed = formats.filter((f) => isHttp(f) && hasV(f) && hasA(f) && edge(f) <= limit).sort(order);
  const videos = formats.filter((f) => isHttp(f) && hasV(f) && !hasA(f) && edge(f) <= limit).sort(order);
  const audios = audioCandidates(formats);

  // Prefer separate streams at equal quality: YouTube throttles its old
  // pre-merged formats hard, while the separate ones are fast.
  if (muxed.length && (!videos.length || !audios.length || edge(muxed[0]) > edge(videos[0]))) {
    return { kind: "single", streams: muxed.filter((f) => edge(f) === edge(muxed[0])).map(toStream) };
  }
  if (videos.length && audios.length) {
    // every codec variant at the chosen resolution, best-supported first
    const sameRes = videos.filter((f) => edge(f) === edge(videos[0])).map(toStream);
    return { kind: "mux", videos: sameRes, audios: audios.map(toStream) };
  }
  return null;
}

// ── chunked fetching ──────────────────────────────────────────────────────────
const FIRST_CHUNK = 512 * 1024;
const CHUNK = 8 * 1024 * 1024;

function parallelFor(url: string): number {
  // googlevideo refuses more than ~2 concurrent ranges on one stream
  return /googlevideo\.com/.test(url) ? 2 : 3;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchRange(s: Stream, start: number, end: number, signal: AbortSignal): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (signal.aborted) throw new Error("aborted");
    const url = s.url;
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": BROWSER_UA, ...s.headers, Range: `bytes=${start}-${end}` },
        signal,
      });
      if (r.status !== 206 && r.status !== 200) {
        await r.body?.cancel();
        throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length !== end - start + 1 && r.status === 206) throw new Error(`short read ${buf.length}/${end - start + 1}`);
      return buf;
    } catch (err: any) {
      lastErr = err;
      if (signal.aborted) throw err;
      console.warn(`[fast-stream] stream ${s.id} bytes ${start}-${end} attempt ${attempt + 1} failed: ${String(err)}`);
      // Link refused part-way (YouTube does this without a PO token): get a
      // fresh link for the same stream and carry on from this byte.
      if ((err?.status === 403 || err?.status === 410) && s.refresh) {
        if (s.url === url) {
          const fresh = await s.refresh().catch(() => null);
          if (fresh) {
            s.url = fresh.url;
            s.headers = fresh.headers;
            console.warn(`[fast-stream] stream ${s.id}: got a fresh link, resuming at byte ${start}`);
          }
        }
        continue; // another chunk may have refreshed it already
      }
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

/**
 * Open a stream: the first small range is fetched before resolving, so a
 * refused or expired URL fails here, before anything is sent to the browser.
 */
export async function openChunked(s: Stream, signal: AbortSignal): Promise<{ total?: number; body: Readable }> {
  const r = await fetch(s.url, {
    headers: { "User-Agent": BROWSER_UA, ...s.headers, Range: `bytes=0-${FIRST_CHUNK - 1}` },
    signal,
  });

  if (r.status === 200 && r.body) {
    // server ignored Range: stream the whole response as it comes
    const len = Number(r.headers.get("content-length")) || undefined;
    return { total: len, body: Readable.fromWeb(r.body as any) };
  }
  if (r.status !== 206) {
    await r.body?.cancel();
    throw new Error(`HTTP ${r.status}`);
  }

  const total = Number(r.headers.get("content-range")?.split("/")[1]) || undefined;
  const first = Buffer.from(await r.arrayBuffer());
  const parallel = parallelFor(s.url);

  async function* chunks() {
    yield first;
    let pos = first.length;
    if (!total) {
      // unknown size: walk forward until a short chunk
      for (;;) {
        const buf = await fetchRange(s, pos, pos + CHUNK - 1, signal);
        if (!buf.length) return;
        yield buf;
        pos += buf.length;
        if (buf.length < CHUNK) return;
      }
    }
    const queue: Promise<Buffer>[] = [];
    while (pos < total || queue.length) {
      while (queue.length < parallel && pos < total) {
        const end = Math.min(total, pos + CHUNK) - 1;
        const p = fetchRange(s, pos, end, signal);
        p.catch(() => {}); // awaited below; avoid unhandled-rejection noise
        queue.push(p);
        pos = end + 1;
      }
      yield await queue.shift()!;
    }
  }

  return { total, body: Readable.from(chunks(), { objectMode: false }) };
}

// ── sending ───────────────────────────────────────────────────────────────────
/**
 * Start sending `sel` to the browser. Resolves `true` once bytes are flowing,
 * `false` (response untouched) if the streams can't be opened.
 */
export async function streamSelection(
  sel: Selection,
  req: Request,
  res: Response,
  target: DownloadTarget,
  /** fresh yt-dlp info for this video, used to replace links refused mid-way */
  freshInfo?: () => Promise<any>,
): Promise<boolean> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.on("close", abort);

  // One shared re-lookup for video and audio, at most a few per download.
  let refreshing: Promise<any> | null = null;
  let refreshedAt = 0;
  let refreshes = 0;
  const getFresh = (): Promise<any> => {
    if (refreshing && Date.now() - refreshedAt < 15_000) return refreshing;
    if (!freshInfo || refreshes >= 4) return Promise.resolve(null);
    refreshes++;
    refreshedAt = Date.now();
    req.log?.info?.({ refresh: refreshes }, "fast-stream: link refused mid-way, looking up fresh links");
    refreshing = freshInfo().catch(() => null);
    return refreshing;
  };
  const withRefresh = (s: Stream): Stream => {
    if (freshInfo && !s.id.startsWith("direct")) {
      s.refresh = async () => {
        const json = await getFresh();
        const f = json?.formats?.find((x: any) => String(x.format_id) === s.id && typeof x.url === "string");
        return f ? { url: f.url, headers: f.http_headers ?? {} } : null;
      };
    }
    return s;
  };

  /** Open the first candidate that the server accepts. */
  const openFirst = async (streams: Stream[], role: string) => {
    for (const s of streams.map(withRefresh)) {
      try {
        const opened = await openChunked(s, controller.signal);
        req.log?.info?.({ [role]: s.id }, "fast-stream: opened");
        return { stream: s, ...opened };
      } catch (err) {
        if (controller.signal.aborted) throw err;
        req.log?.info?.({ [role]: s.id, err: String(err) }, "fast-stream: candidate refused, trying next");
      }
    }
    throw new Error(`no ${role} stream could be opened`);
  };

  try {
    if (sel.kind === "single") {
      const { stream, total, body } = await openFirst(sel.streams, "stream");
      if (res.headersSent || controller.signal.aborted) {
        abort();
        return false;
      }
      target.filename = target.filename.replace(/\.[a-z0-9]+$/i, `.${stream.outExt}`);
      target.contentType = stream.mime;
      commitDownload(res, target, total);
      body.on("error", () => res.destroy());
      body.pipe(res);
      res.on("close", abort);
      return true;
    }

    const [video, audio] = await Promise.all([openFirst(sel.videos, "video"), openFirst(sel.audios, "audio")]);
    target.filename = target.filename.replace(/\.[a-z0-9]+$/i, ".mp4");
    target.contentType = "video/mp4";
    return await muxPipes(video.body, audio.body, req, res, target, abort);
  } catch (err) {
    req.log?.warn?.({ err: String(err) }, "fast-stream: could not open streams");
    abort();
    return false;
  }
}

function muxPipes(
  video: Readable,
  audio: Readable,
  req: Request,
  res: Response,
  target: DownloadTarget,
  abort: () => void,
): Promise<boolean> {
  const ff = spawn(
    FFMPEG,
    [
      "-hide_banner", "-loglevel", "error",
      "-i", "pipe:3",
      "-i", "pipe:4",
      "-map", "0:v:0", "-map", "1:a:0",
      "-c", "copy",
      "-f", "mp4",
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      "pipe:1",
    ],
    { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"], windowsHide: true },
  );

  let errText = "";
  ff.stderr!.on("data", (d: Buffer) => {
    errText = (errText + d.toString()).slice(-2000);
  });
  const vIn = ff.stdio[3] as NodeJS.WritableStream;
  const aIn = ff.stdio[4] as NodeJS.WritableStream;
  /** an input broke: ffmpeg might still exit 0 with what it had, so remember */
  let failed = false;
  const stop = () => {
    abort();
    video.destroy();
    audio.destroy();
    if (ff.exitCode === null && !ff.killed) ff.kill();
  };
  video.on("error", (err) => {
    failed = true;
    req.log?.warn?.({ err: String(err) }, "fast-stream: video input failed");
    stop();
  });
  audio.on("error", (err) => {
    failed = true;
    req.log?.warn?.({ err: String(err) }, "fast-stream: audio input failed");
    stop();
  });
  (vIn as any).on("error", () => {});
  (aIn as any).on("error", () => {});
  video.pipe(vIn);
  audio.pipe(aIn);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      stop();
      finish(false);
    }, 20000);

    ff.on("error", () => {
      stop();
      finish(false);
    });
    ff.on("close", (code) => {
      // code null = we stopped it (visitor cancelled); only real failures are worth a warning
      if (code !== 0 && code !== null) req.log?.warn?.({ code, ffmpeg: errText.trim() }, "fast-stream: ffmpeg exited");
      if (!settled) finish(false);
      else if (code === 0 && !failed) res.end();
      // broke mid-way: cut the connection so the browser marks the download
      // as failed instead of saving a short file as if it were complete
      else res.destroy();
    });

    ff.stdout!.once("data", (chunk: Buffer) => {
      if (settled || res.headersSent) {
        stop();
        finish(false);
        return;
      }
      commitDownload(res, target);
      res.write(chunk);
      // end the response ourselves, only after ffmpeg finished cleanly
      ff.stdout!.pipe(res, { end: false });
      req.on("close", stop);
      res.on("close", stop);
      finish(true);
    });
  });
}
