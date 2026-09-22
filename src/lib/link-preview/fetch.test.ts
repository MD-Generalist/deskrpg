import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";

import { fetchGuarded, isAllowedPreviewUrl } from "./fetch";

/**
 * 테스트 서버는 루프백에 있고 진짜 가드는 루프백을 막는다. 그래서 **127.0.0.1 만** 예외로
 * 열고 나머지 판정은 진짜 가드에 맡긴다 — 사설망 리다이렉트 테스트가 의미를 잃지 않는다.
 */
const allowAll = async (url: URL) =>
  url.hostname === "127.0.0.1" || (await isAllowedPreviewUrl(url));

async function serve(
  handler: (url: string) => { status?: number; headers?: Record<string, string>; body?: string },
): Promise<{ origin: string; close: () => void; hits: string[] }> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    hits.push(req.url ?? "");
    const out = handler(req.url ?? "");
    res.writeHead(out.status ?? 200, { "content-type": "text/html", ...(out.headers ?? {}) });
    res.end(out.body ?? "");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  return { origin: `http://127.0.0.1:${addr.port}`, close: () => server.close(), hits };
}

test("본문을 받아 오고 최종 주소를 함께 준다", async () => {
  const s = await serve(() => ({ body: "<title>안녕</title>" }));
  try {
    const got = await fetchGuarded(new URL(`${s.origin}/p`), {
      accept: "text/html",
      maxBytes: 1024,
      isAllowedUrl: allowAll,
      isAllowedAddress: () => true,
    });
    assert.equal(got?.body, "<title>안녕</title>");
    assert.equal(got?.url.toString(), `${s.origin}/p`);
  } finally {
    s.close();
  }
});

test("상한을 넘는 본문은 잘라서 준다 — 무한 스트림에 매달리지 않는다", async () => {
  const s = await serve(() => ({ body: "x".repeat(5000) }));
  try {
    const got = await fetchGuarded(new URL(`${s.origin}/big`), {
      accept: "text/html",
      maxBytes: 100,
      isAllowedUrl: allowAll,
      isAllowedAddress: () => true,
    });
    assert.equal(got?.body.length, 100);
  } finally {
    s.close();
  }
});

test("content-type 이 맞지 않으면 버린다", async () => {
  const s = await serve(() => ({ headers: { "content-type": "application/pdf" }, body: "%PDF" }));
  try {
    assert.equal(
      await fetchGuarded(new URL(`${s.origin}/f.pdf`), {
        accept: "text/html",
        maxBytes: 1024,
        isAllowedUrl: allowAll,
        isAllowedAddress: () => true,
      }),
      null,
    );
  } finally {
    s.close();
  }
});

test("리다이렉트를 직접 따라가고 홉마다 주소를 다시 검사한다", async () => {
  const s = await serve((url) =>
    url === "/a" ? { status: 302, headers: { location: "/b" } } : { body: "<title>도착</title>" },
  );
  try {
    const got = await fetchGuarded(new URL(`${s.origin}/a`), {
      accept: "text/html",
      maxBytes: 1024,
      isAllowedUrl: allowAll,
      isAllowedAddress: () => true,
    });
    assert.equal(got?.url.pathname, "/b");
    assert.deepEqual(s.hits, ["/a", "/b"]);
  } finally {
    s.close();
  }
});

test("사설망으로 리다이렉트하면 거기서 멈춘다 — 이 가드의 존재 이유다", async () => {
  const s = await serve(() => ({
    status: 302,
    headers: { location: "http://169.254.169.254/latest/meta-data/" },
  }));
  try {
    assert.equal(
      await fetchGuarded(new URL(`${s.origin}/a`), {
        accept: "text/html",
        maxBytes: 1024,
        isAllowedUrl: allowAll,
        isAllowedAddress: () => true,
      }),
      null,
    );
  } finally {
    s.close();
  }
});

test("리다이렉트가 너무 길면 포기한다", async () => {
  let n = 0;
  const s = await serve(() => ({ status: 302, headers: { location: `/hop${n++}` } }));
  try {
    assert.equal(
      await fetchGuarded(new URL(`${s.origin}/a`), {
        accept: "text/html",
        maxBytes: 1024,
        isAllowedUrl: allowAll,
        isAllowedAddress: () => true,
      }),
      null,
    );
    assert.ok(s.hits.length <= 3, `홉이 너무 많다: ${s.hits.length}`);
  } finally {
    s.close();
  }
});

test("가드가 거부한 주소에는 요청 자체를 보내지 않는다", async () => {
  const s = await serve(() => ({ body: "<title>x</title>" }));
  try {
    assert.equal(
      await fetchGuarded(new URL(`${s.origin}/p`), {
        accept: "text/html",
        maxBytes: 1024,
        isAllowedUrl: async () => false,
      }),
      null,
    );
    assert.deepEqual(s.hits, []);
  } finally {
    s.close();
  }
});

test("연결 직전의 주소 검사가 기본값이면 루프백에는 붙지 못한다 — rebinding 을 여기서 막는다", async () => {
  const s = await serve(() => ({ body: "<title>x</title>" }));
  try {
    // 주소 정책만 기본값으로 둔다(URL 정책은 열어 둔다) — 소켓이 물 IP 에서 걸린다.
    const got = await fetchGuarded(new URL(`${s.origin}/p`), {
      accept: "text/html",
      maxBytes: 1024,
      isAllowedUrl: async () => true,
    });
    assert.equal(got, null);
    assert.deepEqual(s.hits, []);
  } finally {
    s.close();
  }
});

test("IPv4-mapped IPv6 로 리다이렉트해도 거기서 멈춘다 — 홉마다 같은 판정을 한다", async () => {
  const s = await serve(() => ({ status: 302, headers: { location: "http://[::ffff:7f00:1]/" } }));
  try {
    // URL 정책은 기본값(진짜 가드)으로 두고 첫 홉만 연다 — 둘째 홉에서 걸려야 한다.
    const got = await fetchGuarded(new URL(`${s.origin}/a`), {
      accept: "text/html",
      maxBytes: 1024,
      isAllowedUrl: allowAll,
      isAllowedAddress: (a) => a === "127.0.0.1",
    });
    assert.equal(got, null);
    assert.deepEqual(s.hits, ["/a"]);
  } finally {
    s.close();
  }
});

test("압축된 응답은 받지 않는다 — 상한이 압축 전 바이트면 상한이 아니다", async () => {
  const s = await serve(() => ({
    headers: { "content-encoding": "gzip" },
    body: "not really gzip",
  }));
  try {
    assert.equal(
      await fetchGuarded(new URL(`${s.origin}/z`), {
        accept: "text/html",
        maxBytes: 1024,
        isAllowedUrl: allowAll,
        isAllowedAddress: () => true,
      }),
      null,
    );
  } finally {
    s.close();
  }
});

test("느린 조각 본문도 전체 8초가 지나면 버린다", { timeout: 12000 }, async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.write("start");
    const interval = setInterval(() => res.write("x"), 1000);
    res.on("close", () => clearInterval(interval));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const started = Date.now();
  try {
    const got = await fetchGuarded(new URL(`http://127.0.0.1:${address.port}/`), {
      accept: "text/html",
      maxBytes: 1024,
      isAllowedUrl: allowAll,
      isAllowedAddress: () => true,
    });
    assert.equal(got, null);
    assert.ok(Date.now() - started < 10000);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("헤더를 보내지 않는 서버도 전체 예산 안에 끝난다", { timeout: 12000 }, async () => {
  const server = createServer(() => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const started = Date.now();
  try {
    const got = await fetchGuarded(new URL(`http://127.0.0.1:${address.port}/`), {
      accept: "text/html",
      maxBytes: 1024,
      isAllowedUrl: allowAll,
      isAllowedAddress: () => true,
    });
    assert.equal(got, null);
    assert.ok(Date.now() - started < 10000);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("리다이렉트마다 시계를 다시 시작하지 않는다", { timeout: 12000 }, async () => {
  const server = createServer((req, res) => {
    setTimeout(() => {
      if (res.destroyed) return;
      const n = Number(req.url?.slice(1) ?? 0);
      if (n < 2) res.writeHead(302, { location: `/${n + 1}` }).end();
      else res.writeHead(200, { "content-type": "text/html" }).end("done");
    }, 3000);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const started = Date.now();
  try {
    const got = await fetchGuarded(new URL(`http://127.0.0.1:${address.port}/0`), {
      accept: "text/html",
      maxBytes: 1024,
      isAllowedUrl: allowAll,
      isAllowedAddress: () => true,
    });
    assert.equal(got, null);
    assert.ok(Date.now() - started < 10000);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("본문이 끝나지 않는 리다이렉트의 이전 소켓을 닫는다", async () => {
  let closed = false;
  const server = createServer((req, res) => {
    if (req.url === "/first") {
      res.writeHead(302, { location: "/final" });
      res.write("unused");
      res.on("close", () => {
        closed = true;
      });
      return;
    }
    res.writeHead(200, { "content-type": "text/html" }).end("done");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const got = await fetchGuarded(new URL(`http://127.0.0.1:${address.port}/first`), {
      accept: "text/html",
      maxBytes: 1024,
      isAllowedUrl: allowAll,
      isAllowedAddress: () => true,
    });
    assert.equal(got?.body, "done");
    for (let i = 0; i < 20 && !closed; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(closed, true);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
