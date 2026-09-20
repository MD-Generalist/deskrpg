/**
 * 가드를 통과한 주소만, 상한을 걸고 받아 온다. 리다이렉트는 `fetch` 에 맡기지 않고
 * 직접 따라간다 — `redirect: "follow"` 는 중간 홉을 보여 주지 않으므로 "공인 주소가
 * 사설 주소로 튕기는" 전형적인 SSRF 우회를 그대로 통과시킨다.
 *
 * 상한 세 가지: 홉 수 · 바이트 수 · 시간. 셋 다 없으면 남의 서버가 우리 워커를 붙잡아
 * 둘 수 있다(무한 리다이렉트·무한 스트림·응답 없는 소켓).
 */
import { isAllowedPreviewUrlDefault } from "./guard-bridge";

export { isAllowedPreviewUrlDefault as isAllowedPreviewUrl };

const MAX_HOPS = 3;
const TIMEOUT_MS = 5_000;

export type FetchGuardedOptions = {
  /** 받아들일 content-type 의 앞부분(`text/html`·`image/`). */
  accept: string;
  /** 본문을 이 바이트에서 자른다. */
  maxBytes: number;
  /** 홉마다 이 주소로 나가도 되는지 묻는다. 기본값은 진짜 SSRF 가드다. */
  isAllowedUrl?: (url: URL) => Promise<boolean>;
};

export type FetchedBody = {
  /** 리다이렉트를 다 따라간 **최종** 주소. 상대 경로 이미지의 기준이 된다. */
  url: URL;
  body: string;
  contentType: string;
  bytes: Uint8Array;
};

/** 상한까지만 읽는다. 상한을 넘으면 연결을 끊는다 — 다 읽고 자르면 상한이 아니다. */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = maxBytes - total;
      chunks.push(value.length > room ? value.subarray(0, room) : value);
      total += Math.min(value.length, room);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export async function fetchGuarded(
  target: URL,
  options: FetchGuardedOptions,
): Promise<FetchedBody | null> {
  const isAllowed = options.isAllowedUrl ?? isAllowedPreviewUrlDefault;
  let url = target;
  const deadline = AbortSignal.timeout(TIMEOUT_MS);

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!(await isAllowed(url))) return null;

    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: deadline,
        headers: {
          // 봇으로 보이면 대부분의 사이트가 og 태그를 안 준다. 우리 정체는 밝힌다.
          "user-agent": "DeskRPG-LinkPreview/1.0 (+https://deskrpg.com)",
          accept: options.accept === "text/html" ? "text/html,*/*;q=0.5" : "image/*",
          "accept-language": "ko,en;q=0.8",
        },
      });
    } catch {
      return null;
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!location) return null;
      try {
        url = new URL(location, url);
      } catch {
        return null;
      }
      url.hash = "";
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.startsWith(options.accept)) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const bytes = await readCapped(res, options.maxBytes);
    return { url, bytes, contentType, body: new TextDecoder().decode(bytes) };
  }
  return null;
}
