/**
 * 가드를 통과한 주소만, 상한을 걸고 받아 온다.
 *
 * `fetch` 가 아니라 `node:http(s)` 를 쓴다. 이유는 하나다 — **실제로 연결하는 주소**를
 * 볼 수 있어야 한다. 미리 DNS 를 확인한 뒤 `fetch` 에 호스트 이름을 넘기면 그 사이에 이름이
 * 다시 풀린다(DNS rebinding): 검사 때는 공인 주소, 연결 때는 10.x 가 될 수 있다.
 * `lookup` 훅은 소켓이 실제로 물 주소를 우리에게 주므로 그 틈이 없다.
 *
 * 리다이렉트도 직접 따라간다 — 자동 추적은 중간 홉을 보여 주지 않아 "공인 주소가 사설
 * 주소로 튕기는" 전형적인 우회를 통과시킨다.
 *
 * 상한 세 가지: 홉 수 · 바이트 수 · 시간. 셋 다 없으면 남의 서버가 우리 워커를 붙잡아 둔다.
 */
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";

import { isBlockedAddress, parsePreviewTarget } from "./guard";

const MAX_HOPS = 3;
const TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 8_000;

export type FetchGuardedOptions = {
  /** 받아들일 content-type 의 앞부분(`text/html`·`image/`). */
  accept: string;
  /** 본문을 이 바이트에서 자른다. */
  maxBytes: number;
  /** 홉마다 이 주소(모양·포트·호스트)로 나가도 되는지 묻는다. 기본값은 진짜 가드다. */
  isAllowedUrl?: (url: URL) => Promise<boolean>;
  /** 소켓이 실제로 물 IP 를 검사한다. 기본값은 사설·루프백·링크로컬 차단. */
  isAllowedAddress?: (address: string) => boolean;
};

export type FetchedBody = {
  /** 리다이렉트를 다 따라간 **최종** 주소. 상대 경로 이미지의 기준이 된다. */
  url: URL;
  body: string;
  contentType: string;
  bytes: Uint8Array;
};

/** 기본 주소 정책. 이름 해석 결과가 하나라도 사설이면 연결하지 않는다. */
export async function isAllowedPreviewUrl(url: URL): Promise<boolean> {
  return parsePreviewTarget(url.toString()) !== null;
}

type Hop = {
  status: number;
  /** `identity` 를 요청했는데도 압축해 보내는 서버가 있다 — 그런 응답은 버린다. */
  encoding: string;
  location: string | null;
  contentType: string;
  message: IncomingMessage;
};

/** 호스트가 이름이 아니라 주소면 DNS 를 타지 않는다 — `lookup` 훅이 불리지 않는다. */
function hostIsAddressLiteral(hostname: string): boolean {
  const host = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

function openHop(
  url: URL,
  isAllowedAddress: (address: string) => boolean,
  signal: AbortSignal,
): Promise<Hop | null> {
  if (signal.aborted) return Promise.resolve(null);
  // IP 리터럴은 `lookup` 을 거치지 않으므로 여기서 같은 정책을 적용한다.
  if (hostIsAddressLiteral(url.hostname)) {
    const literal = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
    if (!isAllowedAddress(literal)) return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    let settled = false;
    const done = (value: Hop | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const req = send(
      url,
      {
        // 소켓이 실제로 물 주소를 여기서 본다 — 이름을 미리 확인하는 방식의 빈틈(rebinding)을 없앤다.
        lookup: (hostname, options, callback) => {
          dnsLookup(hostname, { ...(options as object), all: true }, (err, addresses) => {
            const list = (addresses ?? []) as LookupAddress[];
            if (err || list.length === 0) {
              callback(err ?? new Error("dns_empty"), "", 4);
              return;
            }
            const safe = list.filter((a) => isAllowedAddress(a.address));
            if (safe.length === 0) {
              callback(new Error("blocked_address"), "", 4);
              return;
            }
            // `all` 을 되돌려 달라고 한 호출에는 배열을, 아니면 첫 주소를 준다.
            if ((options as { all?: boolean }).all) {
              (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, safe);
            } else {
              callback(null, safe[0].address, safe[0].family);
            }
          });
        },
        headers: {
          // 봇으로 보이면 대부분의 사이트가 og 태그를 안 준다. 우리 정체는 밝힌다.
          "user-agent": "DeskRPG-LinkPreview/1.0 (+https://deskrpg.com)",
          accept: "text/html,image/*;q=0.9,*/*;q=0.5",
          "accept-language": "ko,en;q=0.8",
          // 압축을 받지 않는다. 우리는 바이트 상한을 **받은 그대로** 센다 — 압축된 본문을
          // 받으면 512KB 상한이 압축 전 기준이 되어 gzip 폭탄에 의미가 없어진다.
          "accept-encoding": "identity",
        },
      },
      (res) => {
        done({
          encoding: (res.headers["content-encoding"] ?? "").toString().toLowerCase(),
          status: res.statusCode ?? 0,
          location: (res.headers.location as string | undefined) ?? null,
          contentType: (res.headers["content-type"] ?? "").toString().toLowerCase(),
          message: res,
        });
      },
    );
    // 전체 예산이 끝나면 DNS·헤더·본문 중 어느 단계에 있든 소켓을 끊는다.
    const abort = () => req.destroy(new Error("deadline"));
    signal.addEventListener("abort", abort, { once: true });
    req.on("close", () => signal.removeEventListener("abort", abort));
    if (signal.aborted) req.destroy(new Error("deadline"));
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("timeout")));
    req.on("error", () => done(null));
    req.end();
  });
}

/** 상한까지만 읽는다. 상한을 넘으면 연결을 끊는다 — 다 읽고 자르면 상한이 아니다. */
function readCapped(
  message: IncomingMessage,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const finish = () => resolve(new Uint8Array(Buffer.concat(chunks, total)));
    const abort = () => message.destroy(new Error("deadline"));
    signal.addEventListener("abort", abort, { once: true });
    message.on("close", () => signal.removeEventListener("abort", abort));
    if (signal.aborted) message.destroy(new Error("deadline"));
    message.on("data", (chunk: Buffer) => {
      const room = maxBytes - total;
      if (room <= 0) {
        message.destroy();
        finish();
        return;
      }
      const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
      chunks.push(piece);
      total += piece.length;
      if (total >= maxBytes) {
        message.destroy();
        finish();
      }
    });
    message.on("end", finish);
    message.on("error", finish);
    message.on("close", finish);
  });
}

export async function fetchGuarded(
  target: URL,
  options: FetchGuardedOptions,
): Promise<FetchedBody | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
  // 주소 검사도 비동기 작업이다. 검사 자체가 멎어도 전체 예산에서 빠져나온다.
  const expired = new Promise<null>((resolve) => {
    controller.signal.addEventListener("abort", () => resolve(null), { once: true });
  });
  try {
    return await Promise.race([fetchWithinDeadline(target, options, controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithinDeadline(
  target: URL,
  options: FetchGuardedOptions,
  signal: AbortSignal,
): Promise<FetchedBody | null> {
  const isAllowed = options.isAllowedUrl ?? isAllowedPreviewUrl;
  const isAllowedAddress = options.isAllowedAddress ?? ((a: string) => !isBlockedAddress(a));
  let url = target;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (signal.aborted || !(await isAllowed(url)) || signal.aborted) return null;

    const res = await openHop(url, isAllowedAddress, signal);
    if (!res) return null;
    if (signal.aborted) {
      res.message.destroy();
      return null;
    }

    if (res.status >= 300 && res.status < 400) {
      // 리다이렉트 본문은 사용하지 않는다. 흘려 보내면 이전 홉의 소켓이 계속 열린다.
      res.message.destroy();
      if (!res.location) return null;
      try {
        url = new URL(res.location, url);
      } catch {
        return null;
      }
      url.hash = "";
      continue;
    }

    const compressed = res.encoding !== "" && res.encoding !== "identity";
    if (
      compressed ||
      res.status < 200 ||
      res.status >= 300 ||
      !res.contentType.startsWith(options.accept)
    ) {
      res.message.destroy();
      return null;
    }
    const bytes = await readCapped(res.message, options.maxBytes, signal);
    if (signal.aborted) return null;
    return {
      url,
      bytes,
      contentType: res.contentType,
      body: new TextDecoder().decode(bytes),
    };
  }
  return null;
}
