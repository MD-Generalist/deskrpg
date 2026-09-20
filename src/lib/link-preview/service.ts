/**
 * 링크 미리보기 조회 — 가드·상한·파싱·캐시를 한자리에 묶는다. 라우트는 이 함수를 부르는
 * 얇은 핸들러여야 한다(`src/app/api/AGENTS` 의 규약).
 *
 * 캐시는 프로세스 메모리에 둔다. 미리보기는 남의 공개 페이지의 요약이라 사용자별로 다르지
 * 않고, 잃어도 다시 받아 오면 된다 — DB 테이블을 만들 값이 아니다. **실패도 캐시한다**:
 * 죽은 주소가 섞인 보고서를 열 때마다 같은 주소를 다시 두드리지 않기 위해서다.
 */
import { fetchGuarded, type FetchGuardedOptions } from "./fetch";
import { parseOpenGraph, type LinkPreview } from "./parse";
import { normalizePreviewUrl } from "./guard";

const HTML_MAX_BYTES = 512 * 1024;
const TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;

type Entry = { at: number; value: LinkPreview | null };
const cache = new Map<string, Entry>();

export function clearLinkPreviewCache(): void {
  cache.clear();
}

/** 이미지는 남의 CDN 을 브라우저가 직접 물지 않게 우리 라우트로 돌린다. */
export function proxiedImageUrl(imageUrl: string): string {
  return `/api/link-preview/image?url=${encodeURIComponent(imageUrl)}`;
}

function remember(key: string, value: LinkPreview | null): LinkPreview | null {
  if (cache.size >= CACHE_MAX) {
    // 삽입 순서가 곧 오래된 순서다(갱신 시 delete 후 set). 가장 오래된 하나를 버린다.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.delete(key);
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function buildLinkPreview(
  rawUrl: string,
  options?: Pick<FetchGuardedOptions, "isAllowedUrl">,
): Promise<LinkPreview | null> {
  // 주소가 어디를 가리키는지는 `fetchGuarded` 가 홉마다 본다 — 여기서는 모양만 본다.
  const target = normalizePreviewUrl(rawUrl);
  if (!target) return null;
  const key = target.toString();

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const fetched = await fetchGuarded(target, {
    accept: "text/html",
    maxBytes: HTML_MAX_BYTES,
    isAllowedUrl: options?.isAllowedUrl,
  });
  if (!fetched) return remember(key, null);

  const parsed = parseOpenGraph(fetched.body, fetched.url);
  if (!parsed) return remember(key, null);
  return remember(key, { ...parsed, image: parsed.image ? proxiedImageUrl(parsed.image) : null });
}
