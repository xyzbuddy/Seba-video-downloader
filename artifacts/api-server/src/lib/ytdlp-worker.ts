/**
 * Talks to ytdlp_worker.py, a long-running Python process with yt-dlp loaded,
 * so lookups skip yt-dlp's 1–3 s startup. If Python or the yt-dlp package
 * isn't installed, `workerLookup` returns null and callers use the executable.
 */
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "child_process";
import path from "path";
import fs from "fs";
import { logger } from "./logger";

const SCRIPT = path.join(__dirname, "..", "ytdlp_worker.py");

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

let proc: ChildProcessWithoutNullStreams | null = null;
let ready: Promise<boolean> | null = null;
let disabledUntil = 0;
let nextId = 1;
const pending = new Map<string, Pending>();

function findPython(): string | null {
  const candidates = process.env.SEBA_PYTHON
    ? [process.env.SEBA_PYTHON]
    : process.platform === "win32"
      ? ["python", "py"]
      : ["python3", "python"];
  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"], { stdio: "ignore", windowsHide: true });
      return c;
    } catch {}
  }
  return null;
}

function start(ffmpeg: string): Promise<boolean> {
  if (ready) return ready;
  ready = new Promise<boolean>((resolveReady) => {
    const python = fs.existsSync(SCRIPT) ? findPython() : null;
    if (!python) {
      logger.info("yt-dlp worker unavailable (no Python or worker script); using the executable");
      resolveReady(false);
      return;
    }

    const child = spawn(python, ["-u", SCRIPT], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", SEBA_FFMPEG: path.isAbsolute(ffmpeg) ? ffmpeg : "" },
    });
    proc = child;
    let buf = "";
    let isReady = false;

    child.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if ("ready" in msg) {
          isReady = !!msg.ready;
          logger.info({ version: msg.version, error: msg.error }, isReady ? "yt-dlp worker ready" : "yt-dlp worker failed to start");
          resolveReady(isReady);
          continue;
        }
        const p = pending.get(String(msg.id));
        if (!p) continue;
        pending.delete(String(msg.id));
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.info);
        else p.reject(new Error(msg.error || "yt-dlp error"));
      }
    });
    child.stderr.on("data", () => {}); // yt-dlp prints progress noise; ignore

    const onExit = () => {
      if (proc === child) proc = null;
      ready = null;
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error("yt-dlp worker exited"));
        pending.delete(id);
      }
      if (!isReady) {
        // don't retry a broken setup on every request
        disabledUntil = Date.now() + 10 * 60_000;
        resolveReady(false);
      }
    };
    child.on("error", onExit);
    child.on("exit", onExit);

    setTimeout(() => {
      if (!isReady) {
        logger.warn("yt-dlp worker took too long to start");
        child.kill();
      }
    }, 30_000).unref();
  });
  return ready;
}

/** Warm the worker at server start so the first lookup is fast too. */
export function warmWorker(ffmpeg: string) {
  void start(ffmpeg);
}

/**
 * Look a URL up in the worker. Resolves to the yt-dlp info JSON, rejects with
 * yt-dlp's error, or resolves `null` when the worker isn't available.
 */
export async function workerLookup(url: string, client: string | null, ffmpeg: string, timeoutMs = 45_000): Promise<any | null> {
  if (Date.now() < disabledUntil) return null;
  const ok = await start(ffmpeg);
  if (!ok || !proc) return null;

  const id = String(nextId++);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("yt-dlp worker timed out"));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    proc!.stdin.write(JSON.stringify({ id, url, client }) + "\n");
  });
}
