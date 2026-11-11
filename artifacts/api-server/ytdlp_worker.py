"""
Long-running yt-dlp worker.

Starting the yt-dlp executable costs ~1-3 s per lookup. This process imports
yt-dlp once and answers lookups over stdin/stdout, one JSON object per line:

  request : {"id": "1", "url": "https://...", "client": "web_embedded" | null}
  response: {"id": "1", "ok": true, "info": {...}}  or  {"id": "1", "ok": false, "error": "..."}

The first line written is {"ready": true, "version": "..."} once yt-dlp loaded.
"""
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(here, ".pydeps"))

try:
    import yt_dlp  # noqa: E402
except Exception as exc:  # pragma: no cover - reported to the parent
    sys.stdout.write(json.dumps({"ready": False, "error": f"cannot import yt_dlp: {exc}"}) + "\n")
    sys.stdout.flush()
    sys.exit(1)

out_lock = threading.Lock()
local = threading.local()


def send(obj):
    line = json.dumps(obj, ensure_ascii=False, default=str)
    with out_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def ydl_for(client):
    """One YoutubeDL per thread and client, reused so caches stay warm."""
    cache = getattr(local, "ydls", None)
    if cache is None:
        cache = local.ydls = {}
    if client not in cache:
        yt_args = {"skip": ["hls"]}  # HLS formats are never used; saves a request
        if client:
            yt_args["player_client"] = [client]
        cache[client] = yt_dlp.YoutubeDL(
            {
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
                "skip_download": True,
                "socket_timeout": 20,
                "extractor_args": {"youtube": yt_args},
                # use whichever JS runtime is installed for YouTube's challenges
                "js_runtimes": {"deno": {}, "node": {}},
                "ffmpeg_location": os.environ.get("SEBA_FFMPEG") or None,
            }
        )
    return cache[client]


def handle(req):
    rid = req.get("id")
    try:
        ydl = ydl_for(req.get("client") or None)
        info = ydl.sanitize_info(ydl.extract_info(req["url"], download=False))
        send({"id": rid, "ok": True, "info": info})
    except Exception as exc:
        send({"id": rid, "ok": False, "error": str(exc)})


def main():
    send({"ready": True, "version": yt_dlp.version.__version__})
    pool = ThreadPoolExecutor(max_workers=int(os.environ.get("SEBA_WORKER_THREADS", "4")))
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            continue
        pool.submit(handle, req)
    pool.shutdown(wait=False)


if __name__ == "__main__":
    main()
