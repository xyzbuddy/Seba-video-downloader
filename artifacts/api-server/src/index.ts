import app from "./app";
import { FFMPEG } from "./lib/media-utils";
import { warmWorker } from "./lib/ytdlp-worker";

// 8080 matches the website's dev proxy; hosts like Railway/Render set PORT themselves.
const PORT = parseInt(process.env.PORT || "8080", 10);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API Server running on http://0.0.0.0:${PORT}`);
  // Load yt-dlp in the background now, so the first lookup doesn't pay for it.
  warmWorker(FFMPEG);
});

export default app;
