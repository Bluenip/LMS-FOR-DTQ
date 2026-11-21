import { canvaEmbedUrl, isCanvaShortLink } from '@/lib/submission-links';

/**
 * Turns a Canva short share link (https://canva.link/<code>) into the embeddable view of its design
 * by reading where Canva redirects it, without following the redirect into Canva itself. Only
 * canva.link is ever contacted. Results (including "not a design") are cached for a day.
 */
const cache = new Map<string, { embed: string | null; until: number }>();
const DAY = 24 * 60 * 60 * 1000;
const MAX_CACHE = 2000;

export async function resolveCanvaShortLink(
  link: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<string | null> {
  if (!isCanvaShortLink(link)) return null;
  const key = new URL(link).pathname.replace(/\/$/, '');
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.embed;
  let url = `https://canva.link${key}`;
  let embed: string | null = null;
  // A short link may point to another short link; follow at most a few hops on canva.link.
  for (let hop = 0; hop < 3; hop++) {
    const response = await fetcher(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LMS link preview)' },
    });
    await response.body?.cancel().catch(() => undefined);
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) break;
    const next = new URL(location, url).toString();
    embed = canvaEmbedUrl(next);
    if (embed || !isCanvaShortLink(next)) break;
    url = next;
  }
  if (cache.size >= MAX_CACHE) cache.clear();
  // Network failures throw above and are not cached; a link that is not a design is.
  cache.set(key, { embed, until: now + DAY });
  return embed;
}
