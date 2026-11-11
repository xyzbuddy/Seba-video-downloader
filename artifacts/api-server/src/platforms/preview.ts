/**
 * Quick previews (title, author, thumbnail) from each platform's lightweight
 * public endpoints, so the page can show the video within a second while the
 * full lookup with quality options is still running.
 */
import { type Platform, parseMediaUrl, cleanFacebookTitle } from "../lib/media-utils";
import { youtubeId } from "./youtube";

export interface Preview {
  platform: Platform;
  title?: string;
  author?: string;
  thumbnail?: string;
  shape: "landscape" | "portrait";
}

async function getJson(url: string, timeoutMs = 4000): Promise<any | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

function metaContent(html: string, prop: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]*content="([^"]*)"|<meta[^>]+content="([^"]*)"[^>]*(?:property|name)="${prop}"`, "i");
  const m = html.match(re);
  const v = m?.[1] ?? m?.[2];
  return v ? decodeEntities(v) : undefined;
}

export async function getPreview(platform: Platform, url: string): Promise<Preview> {
  if (platform === "youtube") {
    const id = youtubeId(url);
    const portrait = /\/shorts\//.test(url);
    const oe = id
      ? await getJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`)
      : null;
    return {
      platform,
      title: oe?.title,
      author: oe?.author_name,
      thumbnail: id ? `https://i.ytimg.com/vi/${id}/${portrait ? "oardefault" : "hqdefault"}.jpg` : undefined,
      shape: portrait ? "portrait" : "landscape",
    };
  }

  if (platform === "tiktok") {
    const oe = await getJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    return {
      platform,
      title: oe?.title || undefined,
      author: oe?.author_unique_id ? `@${oe.author_unique_id}` : oe?.author_name,
      thumbnail: oe?.thumbnail_url,
      shape: "portrait",
    };
  }

  if (platform === "facebook") {
    // Facebook serves Open Graph tags to its own link-preview crawler.
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" },
        signal: AbortSignal.timeout(4000),
      });
      const html = r.ok ? await r.text() : "";
      const title = metaContent(html, "og:title");
      return {
        platform,
        title: title && !/^facebook$/i.test(title) ? cleanFacebookTitle(title).slice(0, 140) || undefined : undefined,
        thumbnail: metaContent(html, "og:image"),
        shape: /\/reel\//.test(parseMediaUrl(url)?.pathname ?? "") ? "portrait" : "landscape",
      };
    } catch {
      return { platform, shape: "landscape" };
    }
  }

  // Instagram's full lookup is already about a second; no separate preview.
  return { platform, shape: "portrait" };
}
