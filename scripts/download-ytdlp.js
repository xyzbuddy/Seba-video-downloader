import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWindows = process.platform === 'win32';
const ytdlpName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const targetDir = path.resolve(__dirname, '../artifacts/api-server');
const targetFile = path.join(targetDir, ytdlpName);

const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlpName}`;

console.log(`Downloading yt-dlp from ${downloadUrl}...`);

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to download: ${response.statusCode}`));
      }

      const file = fs.createWriteStream(dest);
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        if (!isWindows) {
          fs.chmodSync(dest, 0o755); // make executable on linux/mac
        }
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

downloadFile(downloadUrl, targetFile)
  .then(() => console.log('Successfully downloaded yt-dlp.'))
  .catch(err => console.error('Error downloading yt-dlp:', err));
