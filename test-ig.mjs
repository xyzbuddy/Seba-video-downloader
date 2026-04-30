// Test direct HTML scraping approach for Instagram and Facebook
const igUrl = 'https://www.instagram.com/reel/C2OFZ2gS1Yx/';
const fbUrl = 'https://www.facebook.com/watch?v=1088460908815264';

// Instagram - scrape public page to get video URL
async function testInstagramScrape() {
  console.log('\n=== Instagram direct scrape ===');
  try {
    const shortcode = igUrl.match(/\/reel\/([^/?]+)/)?.[1];
    // Use the embed page - doesn't require login
    const r = await fetch(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Sec-Fetch-Dest': 'iframe',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    console.log('Status:', r.status);
    const html = await r.text();
    console.log('HTML length:', html.length);
    
    // Look for video URL in embed
    const videoUrls = html.match(/https:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/g) || [];
    console.log('Video URLs found:', videoUrls.length);
    videoUrls.slice(0, 2).forEach(u => console.log(u.substring(0, 100)));
    
    // Look for thumbnail
    const thumbUrls = html.match(/https:\/\/[^\s"'<>\\]+\.(jpg|jpeg|png)[^\s"'<>\\]*/g) || [];
    console.log('Thumbnails found:', thumbUrls.length);
    if (thumbUrls.length) console.log(thumbUrls[0].substring(0, 100));
    
    // Look for title/description
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    console.log('Title:', titleMatch?.[1]?.substring(0, 100));
  } catch(e) { console.log('Error:', e.message); }
}

// Facebook - try direct page scrape
async function testFacebookScrape() {
  console.log('\n=== Facebook direct scrape ===');
  try {
    const r = await fetch(fbUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    console.log('Status:', r.status);
    const html = await r.text();
    const videoUrls = html.match(/https:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/g) || [];
    console.log('MP4 URLs found:', videoUrls.length);
    videoUrls.slice(0, 3).forEach(u => console.log(u.substring(0, 100)));
    
    // Look for og:video
    const ogVideo = html.match(/og:video.*?content="([^"]+)"/)?.[1];
    console.log('OG Video:', ogVideo?.substring(0, 100));
  } catch(e) { console.log('Error:', e.message); }
}

// Also test the instagram embed JSON endpoint
async function testInstagramEmbed() {
  console.log('\n=== Instagram embed JSON ===');
  try {
    const shortcode = igUrl.match(/\/reel\/([^/?]+)/)?.[1];
    const r = await fetch(`https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`, {
      headers: {
        'User-Agent': 'Instagram 219.0.0.12.117 Android',
        'Accept': 'application/json',
        'X-IG-App-ID': '936619743392459',
      },
    });
    console.log('Status:', r.status);
    const text = await r.text();
    console.log(text.substring(0, 400));
  } catch(e) { console.log('Error:', e.message); }
}

await testInstagramScrape();
await testFacebookScrape();
await testInstagramEmbed();
