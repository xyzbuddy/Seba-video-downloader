import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync = promisify(execFile);
const YT_DLP = path.join(process.cwd(), 'artifacts/api-server/yt-dlp' + (process.platform === 'win32' ? '.exe' : ''));

async function test() {
  if (!fs.existsSync(YT_DLP)) {
     console.error("YT_DLP missing:", YT_DLP);
     return;
  }
  
  try {
    console.log("Running yt-dlp...");
    const { stdout, stderr } = await execFileAsync(
      YT_DLP,
      [
        "--dump-json",
        "--no-playlist",
        "--no-warnings",
        "--extractor-args", "youtube:player_client=android",
        "https://youtu.be/i6QekQlGd3s"
      ],
      { timeout: 35000, maxBuffer: 10 * 1024 * 1024 }
    );
    console.log("Success! Output size:", stdout.length, "bytes");
    const json = JSON.parse(stdout);
    console.log("Title:", json.title);
  } catch(e) {
    console.error("Error Message:", e.message);
    if (e.stdout) console.error("Stdout length:", e.stdout.length);
    if (e.stderr) console.error("Stderr:", e.stderr);
  }
}
test();
