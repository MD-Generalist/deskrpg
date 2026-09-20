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
import { isIPv4, isIPv6 } from "node:net";

const ALLOWED_PORTS = new Set(["", "80", "443"]);

/** 점 넷짜리 IPv4 문자열이면 옥텟 배열, 아니면 null. */
function ipv4Octets(host: string): number[] | null {
  if (!isIPv4(host)) return null;
  return host.split(".").map(Number);
}

/**
 * IPv6 문자열을 16바이트로 펼친다. 파싱할 수 없으면 null.
 *
 * 문자열 정규식으로 IPv6 를 판정하면 반드시 뚫린다 — WHATWG URL 파서가
 * `[::ffff:127.0.0.1]` 을 **16진 표기** `[::ffff:7f00:1]` 로 정규화하기 때문이다
 * (2026-09-20 실측: 그 형태로 루프백·사설망·169.254 가 전부 통과했다). 표기를 비교하지 말고
 * 바이트로 펼쳐서 판정한다.
 */
function ipv6Bytes(host: string): Uint8Array | null {
  if (!isIPv6(host)) return null;
  let text = host;
  // 끝에 점 넷 IPv4 가 붙은 형태(`::ffff:127.0.0.1`)는 16진 두 그룹으로 바꿔 둔다.
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail) {
    const v4 = ipv4Octets(tail[1]);
    if (!v4) return null;
    const hex = `${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
    text = text.slice(0, tail.index) + hex;
  }
  const [left, right, ...extra] = text.split("::");
  if (extra.length > 0) return null;
  const head = left ? left.split(":") : [];
  const tailGroups = right === undefined ? [] : right ? right.split(":") : [];
  const fill = 8 - head.length - tailGroups.length;
  if (right === undefined ? head.length !== 8 : fill < 0) return null;
  const groups = right === undefined ? head : [...head, ...Array(fill).fill("0"), ...tailGroups];

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const value = Number.parseInt(groups[i] || "0", 16);
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) return null;
    bytes[i * 2] = value >> 8;
    bytes[i * 2 + 1] = value & 0xff;
  }
  return bytes;
}

/** IPv4 는 차단 목록으로 판정한다 — 공인 대역이 훨씬 넓어 목록이 짧다. */
function isBlockedIpv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  if (a === 0 || a === 127 || a === 10) return true; // 이 호스트 · 루프백 · 사설
  if (a === 172 && b >= 16 && b <= 31) return true; // 사설
  if (a === 192 && b === 168) return true; // 사설
  if (a === 169 && b === 254) return true; // 링크로컬(클라우드 메타데이터)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF 프로토콜 할당 · 문서용
  if (a === 198 && (b === 18 || b === 19)) return true; // 벤치마크
  if (a === 198 && b === 51 && c === 100) return true; // 문서용
  if (a === 203 && b === 0 && c === 113) return true; // 문서용
  if (a >= 224) return true; // 멀티캐스트 · 예약 · 브로드캐스트
  return false;
}

/** 앞 `bits` 비트가 접두사와 같은가. */
function hasPrefix(bytes: Uint8Array, prefix: number[], bits: number): boolean {
  for (let i = 0; i < bits; i++) {
    const bit = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
    const want = (prefix[i >> 3] >> (7 - (i & 7))) & 1;
    if (bit !== want) return false;
  }
  return true;
}

/** 안에 IPv4 를 품는 IPv6 대역이면 그 IPv4 를, 아니면 null. */
function embeddedIpv4(bytes: Uint8Array): number[] | null {
  const last4 = [bytes[12], bytes[13], bytes[14], bytes[15]];
  // ::ffff:0:0/96 (IPv4-mapped) · ::/96 (IPv4-compatible) · ::ffff:0:0:0/96 (IPv4-translated)
  const first10Zero = bytes.slice(0, 10).every((b) => b === 0);
  if (
    first10Zero &&
    ((bytes[10] === 0xff && bytes[11] === 0xff) || (bytes[10] === 0 && bytes[11] === 0))
  ) {
    return last4;
  }
  if (bytes.slice(0, 8).every((b) => b === 0) && bytes[8] === 0xff && bytes[9] === 0xff)
    return last4;
  // 64:ff9b::/96 · 64:ff9b:1::/48 (NAT64)
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b)
    return last4;
  // 2002::/16 (6to4) — 안쪽 v4 가 진짜 목적지다.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return [bytes[2], bytes[3], bytes[4], bytes[5]];
  return null;
}

/**
 * IPv6 는 **허용 목록**으로 판정한다 — 차단 목록은 새 표기가 나올 때마다 뚫린다.
 * 글로벌 유니캐스트(`2000::/3`)만 통과시키고, 그 안에서도 v4 를 품거나 특수 용도인
 * 대역은 따로 쳐낸다.
 */
function isBlockedIpv6(bytes: Uint8Array): boolean {
  const v4 = embeddedIpv4(bytes);
  if (v4) return isBlockedIpv4(v4);
  if (!hasPrefix(bytes, [0x20], 3)) return true; // 2000::/3 밖은 전부 차단
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return true; // 2001::/32 Teredo
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // 2001:db8::/32 문서용
  return false;
}

/**
 * 이 주소로 나가면 안 되는가. IP 문자열만 받는다(호스트 이름은 해석한 뒤 넘긴다).
 * 판정할 수 없는 문자열은 **막는다** — 모르는 것을 통과시키는 쪽이 위험하다.
 */
export function isBlockedAddress(address: string): boolean {
  let host = address.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  // 스코프 식별자(`fe80::1%en0`)는 주소가 아니다 — 떼고 본다.
  const percent = host.indexOf("%");
  if (percent !== -1) host = host.slice(0, percent);
  if (!host) return true;

  const v4 = ipv4Octets(host);
  if (v4) return isBlockedIpv4(v4);

  const bytes = ipv6Bytes(host);
  if (bytes) return isBlockedIpv6(bytes);

  return true; // IPv4 도 IPv6 도 아니다 — 해석되지 않은 이름
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
  // 이름이 아니라 주소로 왔으면 지금 판정한다(IPv6 리터럴은 대괄호가 벗겨져 온다).
  const literal = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (isIPv4(literal) || isIPv6(literal)) {
    if (isBlockedAddress(literal)) return null;
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
