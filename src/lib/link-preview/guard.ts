/**
 * 링크 미리보기 프록시의 SSRF 가드.
 *
 * 미리보기는 남의 사이트를 **서버가** 읽어야 한다. 그 순간 서버는 사용자가 준 주소로
 * 요청을 보내는 도구가 되므로, 막지 않으면 로그인한 아무 사용자나 내부망·클라우드
 * 메타데이터(`169.254.169.254`)를 우리 서버를 통해 읽을 수 있다.
 *
 * 세 겹으로 막는다.
 *   1. 주소 자체 — http(s) 만, 자격증명 금지, 표준 포트만, 호스트가 사설 IP 리터럴이면 거부.
 *   2. 이름 해석 결과 — DNS 가 돌려준 **모든** 주소를 검사한다(DNS rebinding).
 *   3. 리다이렉트 — 수동으로 따라가며 홉마다 1·2 를 다시 본다(`fetchGuarded`).
 *
 * 1·2 를 나눈 이유: 1 은 순수 함수라 테스트가 싸고, 2 는 I/O 라 느리다. 둘 중 하나만
 * 있으면 뚫린다 — 1 만 있으면 `internal.example.com` 이 10.x 로 풀리고, 2 만 있으면
 * `file://`·비표준 포트가 그대로 나간다.
 */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

/** 점 넷짜리 IPv4 문자열이면 옥텟 배열, 아니면 null. */
function ipv4Octets(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : null;
}

/**
 * 이 주소로 나가면 안 되는가. IP 문자열만 받는다(호스트 이름은 해석한 뒤 넘긴다).
 * 판정할 수 없는 문자열은 **막는다** — 모르는 것을 통과시키는 쪽이 위험하다.
 */
export function isBlockedAddress(address: string): boolean {
  let host = address.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host) return true;

  const mapped = /^::ffff:(.+)$/.exec(host);
  if (mapped) return isBlockedAddress(mapped[1]);

  const v4 = ipv4Octets(host);
  if (v4) {
    const [a, b] = v4;
    if (a === 0 || a === 127 || a === 10) return true; // 이 호스트 · 루프백 · 사설
    if (a === 172 && b >= 16 && b <= 31) return true; // 사설
    if (a === 192 && b === 168) return true; // 사설
    if (a === 169 && b === 254) return true; // 링크로컬(클라우드 메타데이터)
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // 멀티캐스트·예약
    return false;
  }

  if (!host.includes(":")) return true; // IPv4 도 IPv6 도 아니다 — 해석되지 않은 이름
  if (host === "::" || host === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // fc00::/7 유니크 로컬
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // fe80::/10 링크로컬
  if (host.startsWith("ff")) return true; // 멀티캐스트
  return false;
}

/**
 * 미리보기를 시도해도 되는 주소인가. 통과하면 정규화된 URL(해시 제거)을 준다.
 * 호스트 이름의 해석 결과는 여기서 보지 않는다 — `fetchGuarded` 가 본다.
 */
/**
 * 모양만 본다 — http(s), 자격증명 없음, 해시 제거. 주소와 포트가 어디를 가리키는지는
 * 보지 않는다(`parsePreviewTarget` 이 본다). 캐시 키를 만들려면 주소 판정보다 먼저
 * 정규화가 필요해서 나눠 뒀다.
 */
export function normalizePreviewUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  url.hash = "";
  return url;
}

export function parsePreviewTarget(raw: string): URL | null {
  const url = normalizePreviewUrl(raw);
  if (!url) return null;
  // 표준 포트만. 임의 포트를 허용하면 프록시가 내부망 포트 스캐너가 된다.
  if (!ALLOWED_PORTS.has(url.port)) return null;

  let host = url.hostname.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (!host) return null;
  // 이름이 아니라 주소로 왔으면 지금 판정한다. `localhost` 는 해석을 기다릴 필요가 없다.
  if (host === "localhost" || host.endsWith(".localhost")) return null;
  if (host.startsWith("[") || ipv4Octets(host) || host.includes(":")) {
    if (isBlockedAddress(host)) return null;
  }
  return url;
}

/**
 * 프록시가 브라우저로 되돌려도 되는 이미지 타입인가.
 *
 * `image/*` 를 전부 통과시키면 **SVG** 가 함께 들어온다. SVG 는 이미지가 아니라 문서다 —
 * `<script>` 를 품고, 우리 출처(`/api/link-preview/image`)에서 열리므로 우리 쿠키·DOM 에
 * 닿는 XSS 가 된다. 미리보기 썸네일에 벡터가 필요하지도 않으므로 래스터만 통과시킨다.
 */
const SAFE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
]);

export function isSafeImageType(contentType: string): boolean {
  const base = contentType.split(";")[0].trim().toLowerCase();
  return SAFE_IMAGE_TYPES.has(base);
}
