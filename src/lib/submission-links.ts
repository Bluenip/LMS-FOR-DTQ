/**
 * A submission keeps its evidence links in the single `link` text field, one link per line, so
 * older single-link submissions stay valid and no schema change is needed.
 */
export const MAX_SUBMISSION_LINKS = 5;

export function parseSubmissionLinks(link: string | undefined | null): string[] {
  return (link || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function joinSubmissionLinks(links: string[]): string {
  return links
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

export function isWebLink(value: string): boolean {
  try {
    return ['https:', 'http:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export type LinkKind = 'canva' | 'slides' | 'drive' | 'youtube' | 'other';

function host(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function linkKind(value: string): LinkKind {
  const h = host(value);
  if (
    h === 'canva.com' ||
    h.endsWith('.canva.com') ||
    h === 'canva.link' ||
    h.endsWith('.canva.site')
  )
    return 'canva';
  if (h === 'docs.google.com' && /\/presentation\//.test(value)) return 'slides';
  if (h === 'drive.google.com' || h === 'docs.google.com') return 'drive';
  if (h === 'youtube.com' || h === 'm.youtube.com' || h === 'youtu.be') return 'youtube';
  return 'other';
}

export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  canva: 'Canva',
  slides: 'Google Slides',
  drive: 'Google Drive',
  youtube: 'YouTube',
  other: 'Liên kết',
};

/** Canva design links that can be shown in an iframe: /design/<id>/<token>/view (or /watch). */
export function canvaEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || host(value) !== 'canva.com') return null;
    const m = url.pathname.match(/^\/design\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/(view|watch)\/?$/);
    if (!m) return null;
    return `https://www.canva.com/design/${m[1]}/${m[2]}/view?embed`;
  } catch {
    return null;
  }
}

/** A Canva /edit link only opens for people invited to edit the design. */
export function isCanvaEditLink(value: string): boolean {
  try {
    const url = new URL(value);
    return host(value) === 'canva.com' && /^\/design\/[^/]+\/[^/]+\/edit\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}
