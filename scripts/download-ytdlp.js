import fs from 'fs';
import path from 'path';
import https from 'https';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWindows = process.platform === 'win32';
const ytdlpName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const targetDir = path.resolve(__dirname, '../artifacts/api-server');
const targetFile = path.join(targetDir, ytdlpName);

// Standalone builds that don't need Python installed on the server.
const releaseAsset =
  process.platform === 'win32' ? 'yt-dlp.exe'
  : process.platform === 'darwin' ? 'yt-dlp_macos'
  : process.arch === 'arm64' ? 'yt-dlp_linux_aarch64'
  : 'yt-dlp_linux';
const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${releaseAsset}`;

// Vercel only builds the static frontend; the API server (Railway/Render/Replit) needs the binary.
if (process.env.VERCEL || process.env.SKIP_YTDLP_DOWNLOAD) {
  console.log("Skipping yt-dlp download (VERCEL / SKIP_YTDLP_DOWNLOAD set)");
  process.exit(0);
}

console.log(`Downloading yt-dlp from ${downloadUrl}...`);

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        return downloadFile(new URL(response.headers.location, url).toString(), dest).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Failed to download: ${response.statusCode}`));
      }

      // Write to a temp file and rename, so a failed download never leaves a broken binary.
      const tmp = `${dest}.download`;
      const file = fs.createWriteStream(tmp);
      response.pipe(file);
      response.on('error', (err) => { file.destroy(); fs.unlink(tmp, () => {}); reject(err); });
      file.on('error', (err) => { fs.unlink(tmp, () => {}); reject(err); });
      file.on('finish', () => {
        file.close(() => {
          try {
            fs.renameSync(tmp, dest);
            if (!isWindows) fs.chmodSync(dest, 0o755); // make executable on linux/mac
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    }).on('error', reject);
  });
}

downloadFile(downloadUrl, targetFile)
  .then(() => console.log('Successfully downloaded yt-dlp.'))
  .catch(err => console.error('Error downloading yt-dlp:', err))
  .finally(installPythonPackage);

/**
 * The API server keeps yt-dlp loaded in a Python worker so lookups skip the
 * executable's startup time. Install the package next to the server when Python
 * is available; without it the server simply uses the executable.
 */
function installPythonPackage() {
  const pydeps = path.join(targetDir, '.pydeps');
  const pythons = isWindows ? ['python', 'py'] : ['python3', 'python'];
  for (const py of pythons) {
    const probe = spawnSync(py, ['--version'], { stdio: 'ignore' });
    if (probe.status !== 0) continue;
    console.log(`Installing the yt-dlp Python package into ${pydeps} with ${py}...`);
    const r = spawnSync(
      py,
      ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--upgrade', '--target', pydeps, 'yt-dlp[default]'],
      { stdio: 'inherit' },
    );
    if (r.status === 0) console.log('yt-dlp Python package installed.');
    else console.warn('Could not install the yt-dlp Python package; lookups will use the slower executable.');
    return;
  }
  console.warn('Python not found; lookups will use the yt-dlp executable (a few seconds slower).');
}
