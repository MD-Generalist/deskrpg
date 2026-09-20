/**
 * 남의 HTML 에서 OpenGraph 값만 뽑는다. 정규식으로 `<meta>` 만 훑는다 — DOM 파서를
 * 서버에 들이면 남이 준 문서를 트리로 만드는 비용·표면이 함께 늘어난다. 우리가 쓰는 값은
 * 네 개(title·description·image·site_name)뿐이다.
 *
 * 순수 함수다. 네트워크를 보지 않는다 — 호출부가 이미 받아 온 본문을 넘긴다.
 */

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 300;

export type LinkPreview = {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
    const known = ENTITIES[name.toLowerCase()] ?? ENTITIES[name];
    if (known) return known;
    if (name.startsWith("#x") || name.startsWith("#X")) {
      const code = Number.parseInt(name.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (name.startsWith("#")) {
      const code = Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });
}

function clean(value: string | null, max: number): string | null {
  if (!value) return null;
  const folded = decodeEntities(value).replace(/\s+/g, " ").trim();
  if (!folded) return null;
  return folded.length > max ? folded.slice(0, max) : folded;
}

/** `<meta>` 태그 하나를 {키, 값} 으로. 속성 순서는 정해져 있지 않다. */
function metaTags(html: string): Array<{ key: string; content: string }> {
  const out: Array<{ key: string; content: string }> = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:property|name)\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
    if (!key || !content) continue;
    out.push({ key: key.toLowerCase(), content: content[1] ?? content[2] ?? content[3] ?? "" });
  }
  return out;
}

function absoluteHttpUrl(value: string | null, base: URL): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseOpenGraph(html: string, documentUrl: URL): LinkPreview | null {
  const metas = metaTags(html);
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const hit = metas.find((m) => m.key === key);
      if (hit && hit.content.trim()) return hit.content;
    }
    return null;
  };

  const htmlTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? null;
  const title = clean(pick("og:title", "twitter:title") ?? htmlTitle, TITLE_MAX);
  const description = clean(
    pick("og:description", "twitter:description", "description"),
    DESCRIPTION_MAX,
  );
  const image = absoluteHttpUrl(pick("og:image", "og:image:url", "twitter:image"), documentUrl);
  const siteName = clean(pick("og:site_name"), TITLE_MAX) ?? documentUrl.hostname;

  // 제목도 그림도 없으면 지금의 밑줄 링크보다 나을 것이 없다 — 카드를 만들지 않는다.
  if (!title && !image) return null;
  return { title, description, image, siteName };
}
