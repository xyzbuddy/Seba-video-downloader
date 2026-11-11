<p align="center">
  <img src="artifacts/diu-yt-downloader/public/favicon.svg" width="72" height="72" alt="Seba logo" />
</p>

<h1 align="center">Seba Downloader</h1>

<p align="center">
  Save videos from <b>YouTube</b>, <b>Facebook</b>, <b>Instagram</b> and <b>TikTok</b>.<br />
  Paste a link, pick a quality, and the download starts in under a second. No account, no app, up to 4K.
</p>

---

## What it does

| | |
|---|---|
| **One box for four sites** | Paste any YouTube, Facebook, Instagram or TikTok link. The site is recognised from the link's real address, and its name lights up in the headline. |
| **Every quality the upload has** | YouTube from 360p up to 4K, Facebook HD and SD, Instagram in the best available quality, TikTok with or without the watermark. |
| **Audio only** | Save just the sound (M4A, or MP3 for TikTok). |
| **Fast** | The title and thumbnail appear in about 0.3 s. Downloads start in under half a second, even for 1080p and 4K. |
| **Honest sizes** | The size on each quality button is the size of the file you actually get. |
| **Light and dark** | Opens light; the switch in the header changes to dark and remembers it. |
| **Accessible** | Works by keyboard and screen reader, respects "reduce motion", and fits phone screens. |

## How it's fast

Most downloaders make you wait while the server fetches the whole video. Seba doesn't:

1. **Lookup once.** When you paste a link, the server finds every stream URL with [yt-dlp](https://github.com/yt-dlp/yt-dlp) (or TikWM / Instagram's embed page) and keeps the result for 30 minutes. Clicking Download needs no second lookup.
2. **yt-dlp stays loaded.** A small Python worker keeps yt-dlp in memory, so lookups skip its startup time (about 1–3 s each).
3. **Stream while fetching.** The file is fetched in parallel byte-range chunks and sent to your browser as it arrives.
4. **Join on the fly.** For HD YouTube and Facebook, picture and sound are separate streams. ffmpeg joins them into a streamable MP4 while the download is already running.
5. **Recover mid-download.** If YouTube starts refusing a link part-way (it does this to some sessions), the server gets a fresh link and carries on from the same byte, so the download doesn't break.
6. **Never a fake "complete".** If something does fail, the connection is cut, so the browser shows the download as failed instead of saving a short file.

If the fast path can't be used, the server falls back to letting yt-dlp download and merge the file first, with a live progress bar on the page.

## Project layout

This is a pnpm workspace.

```text
artifacts/
├── api-server/                 Express 5 API (TypeScript, bundled with esbuild)
│   ├── src/routes/media.ts       /api/preview, /api/info, /api/download, /api/progress
│   ├── src/platforms/            youtube.ts, facebook.ts, instagram.ts, tiktok.ts, preview.ts
│   ├── src/lib/fast-stream.ts    lookup cache, stream picking, chunked fetch, live mux, resume
│   ├── src/lib/media-utils.ts    URL checks, yt-dlp/ffmpeg helpers, slow-path download
│   ├── src/lib/ytdlp-worker.ts   talks to the Python worker
│   └── ytdlp_worker.py           keeps yt-dlp loaded between lookups
└── diu-yt-downloader/          The website (React 19, Vite, Tailwind CSS 4, wouter)
    ├── src/pages/ToolPage.tsx    home page and the four platform pages
    └── src/components/           LinkForm, ResultPanel, header, footer, info sections
scripts/download-ytdlp.js       postinstall: fetches yt-dlp and installs the Python worker's package
Dockerfile                      one container: server + website + ffmpeg + Python + yt-dlp
render.yaml / railway.toml      one-click deploy settings for Render and Railway
```

## API

All endpoints are `GET` and take the video link as `url`.

| Endpoint | Returns |
|---|---|
| `/api/preview?url=` | Title, author and thumbnail, usually within a second |
| `/api/info?url=` | Everything above plus the list of qualities (`formats`) with sizes |
| `/api/download?url=&format=&title=&token=` | The file. `format` is an id from `/api/info` (`v1080`, `v720`, `audio`, `nowm`, `best`, …) |
| `/api/progress?token=` | How far a slow-path download has got (used for the progress bar) |
| `/api/healthz` | `{ "status": "ok" }` |

Errors come back as JSON, `{ "error": "message a person can act on" }`.

## Run it locally

**You need:** Node.js 20+ (24 recommended), and ffmpeg on your PATH. Python 3 is optional but makes lookups a few seconds faster.

```bash
npx pnpm@10.33.0 install
```

This also downloads yt-dlp next to the API server and, when Python is available, installs the yt-dlp package for the background worker into `artifacts/api-server/.pydeps`.

Start the API server (port 8080):

```bash
cd artifacts/api-server
npx pnpm@10.33.0 run dev
```

In a second terminal, start the website (port 5173):

```bash
cd artifacts/diu-yt-downloader
npx pnpm@10.33.0 run dev
```

Then open <http://localhost:5173>.

> **Windows PowerShell:** if you see "running scripts is disabled on this system", type `npx.cmd` instead of `npx`. Run each command on its own line, because Windows PowerShell 5 doesn't understand `&&`.

Check everything compiles:

```bash
npx pnpm@10.33.0 run typecheck
```

## Deploy

The website alone can live on Vercel, but downloads need a real server: it runs yt-dlp and ffmpeg and streams large files, which serverless platforms can't do. The included `Dockerfile` packs the API server, ffmpeg, Python and yt-dlp into one container.

**Render, one click (free plan works).** The repo includes a Render Blueprint, `render.yaml`.

1. In Render, choose **New → Blueprint**, pick this repository, then **Apply**.
2. Wait for the first deploy (the Docker build takes a few minutes).
3. Open `https://seba-video-downloader.onrender.com/api/healthz`. It should answer `{"status":"ok"}`. The whole site works at `https://seba-video-downloader.onrender.com`.

Every push to `main` redeploys automatically. On Render's free plan the server sleeps after 15 minutes without visits, and the first request afterwards takes about a minute.

**Vercel (website) + Render (downloads).** `artifacts/diu-yt-downloader/vercel.json` already forwards `/api/*` to `https://seba-video-downloader.onrender.com`, so the Vercel site works as soon as the Render service is live. If Render gave your service a different address, change that one `destination` line and push.

**Railway.** `railway.toml` builds the same `Dockerfile`; create a project from this repository and it deploys as is.

**Any other server (VPS, Fly.io, Koyeb, …).** Build and run the `Dockerfile`, or without Docker: `pnpm install && pnpm run build`, then `pnpm run start` (needs ffmpeg; Python 3 makes lookups faster).

### Settings

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | API server port |
| `API_URL` | `http://127.0.0.1:8080` | Where the website's dev server forwards `/api` |
| `SEBA_PYTHON` | `python3` / `python` | Python used for the yt-dlp worker |
| `SEBA_WORKER_THREADS` | `4` | Lookups the worker runs at the same time |
| `SKIP_YTDLP_DOWNLOAD` | unset | Set to skip downloading yt-dlp during install |
| `LOG_LEVEL` | `info` | Server log level |

## Good to know

- **YouTube looks a video up in about 3–5 s.** Most of that is yt-dlp solving YouTube's JavaScript challenge, which every video needs. The title and thumbnail show before that.
- **Only public videos work.** Private, age-restricted and members-only videos, Facebook posts shared with friends or groups, and private Instagram accounts can't be downloaded.
- **Keep yt-dlp updated.** YouTube changes often; when downloads start failing, update yt-dlp first (re-run `pnpm install`, or `python -m pip install -U --target artifacts/api-server/.pydeps "yt-dlp[default]"`).
- **Size while downloading.** For HD videos that are joined on the fly, the browser can't show the total size while downloading. The size on the quality button is the size of the finished file.

## Responsible use

Seba is for saving videos you have the right to keep: your own uploads, or videos whose creators allow downloading. Respect copyright and each platform's terms, and credit the people who made the work.

## Credits

Built by [xyzbuddy](https://github.com/xyzbuddy). Uses [yt-dlp](https://github.com/yt-dlp/yt-dlp), [ffmpeg](https://ffmpeg.org), and [TikWM](https://www.tikwm.com) for TikTok.
