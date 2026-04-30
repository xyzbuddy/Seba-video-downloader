import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Instagram embed test
const shortcode = 'C2OFZ2gS1Yx';
const igEmbedUrl = 'https://www.instagram.com/p/' + shortcode + '/embed/captioned/';

const result = execFileSync('node', ['-e', `
const https = require('https');
const url = '${igEmbedUrl}';
const req = https.get(url, {headers: {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'}}, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    const vids = data.match(/https:\\/\\/[^\\s"'<>\\\\]+\\.mp4[^\\s"'<>\\\\]*/g) || [];
    const title = data.match(/<title>([^<]+)<\\/title>/);
    console.log('Status:', res.statusCode, 'HTML len:', data.length);
    console.log('Title:', title && title[1]);
    console.log('Videos:', vids.length, vids[0] && vids[0].substring(0,100));
  });
});
req.on('error', e => console.log('Error:', e.message));
`], { timeout: 15000, encoding: 'utf8' });

console.log(result);
