// Final comprehensive test for Instagram and Facebook
const http = require('http');
const https = require('https');
const { execFileSync } = require('child_process');
const path = require('path');

const YT_DLP = path.join(__dirname, 'artifacts', 'api-server', 'yt-dlp.exe');

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        ...headers,
      }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

async function main() {
  // Test 1: Instagram embed page
  console.log('=== Instagram /embed/ ===');
  try {
    const r = await httpsGet('https://www.instagram.com/p/C2OFZ2gS1Yx/embed/');
    console.log('Status:', r.status, 'Length:', r.body.length);
    const mp4s = r.body.match(/https:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/g) || [];
    console.log('MP4s:', mp4s.length, mp4s[0] && mp4s[0].substr(0,80));
  } catch(e) { console.log('Error:', e.message); }

  // Test 2: Facebook oembed
  console.log('\n=== Facebook oEmbed ===');
  try {
    const fbUrl = encodeURIComponent('https://www.facebook.com/watch?v=1088460908815264');
    const r = await httpsGet('https://www.facebook.com/plugins/video/oembed.json/?url=' + fbUrl);
    console.log('Status:', r.status);
    console.log(r.body.substr(0,300));
  } catch(e) { console.log('Error:', e.message); }

  // Test 3: Instagram via picnob
  console.log('\n=== Picnob Instagram ===');
  try {
    const r = await httpsGet('https://picnob.com/reel/C2OFZ2gS1Yx/');
    console.log('Status:', r.status, 'len:', r.body.length);
    const mp4s = r.body.match(/https:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/g) || [];
    console.log('MP4s:', mp4s.length, mp4s[0] && mp4s[0].substr(0,80));
  } catch(e) { console.log('Error:', e.message); }
}

main();
