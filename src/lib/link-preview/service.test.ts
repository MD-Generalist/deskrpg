import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";

import { buildLinkPreview, clearLinkPreviewCache, proxiedImageUrl } from "./service";
import { isAllowedPreviewUrl } from "./fetch";

const allowAll = async (url: URL) =>
  url.hostname === "127.0.0.1" || (await isAllowedPreviewUrl(url));

async function serve(body: string): Promise<{ origin: string; close: () => void; hits: number }> {
  const state = { hits: 0 };
  const server: Server = createServer((_req, res) => {
    state.hits++;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    close: () => server.close(),
    get hits() {
      return state.hits;
    },
  };
}

test("og 태그가 있는 페이지는 미리보기로 돌아오고 이미지는 우리 프록시를 거친다", async () => {
  clearLinkPreviewCache();
  const s = await serve(
    `<meta property="og:title" content="제목"><meta property="og:image" content="/a.png">`,
  );
  try {
    const got = await buildLinkPreview(`${s.origin}/p`, {
      isAllowedUrl: allowAll,
      isAllowedAddress: () => true,
    });
    assert.equal(got?.title, "제목");
    assert.equal(got?.image, proxiedImageUrl(`${s.origin}/a.png`));
    assert.ok(got?.image?.startsWith("/api/link-preview/image?"), "이미지는 직접 물리지 않는다");
  } finally {
    s.close();
  }
});

test("같은 주소를 두 번 물어도 남의 서버는 한 번만 부른다", async () => {
  clearLinkPreviewCache();
  const s = await serve(`<title>한 번만</title>`);
  try {
    await buildLinkPreview(`${s.origin}/p`, {
      isAllowedUrl: allowAll,
      isAllowedAddress: () => true,
    });
    await buildLinkPreview(`${s.origin}/p`, {
      isAllowedUrl: allowAll,
      isAllowedAddress: () => true,
    });
    assert.equal(s.hits, 1);
  } finally {
    s.close();
  }
});

test("실패도 캐시한다 — 죽은 주소를 화면마다 다시 두드리지 않는다", async () => {
  clearLinkPreviewCache();
  const first = await buildLinkPreview("http://169.254.169.254/latest/meta-data/", {
    isAllowedUrl: allowAll,
    isAllowedAddress: () => true,
  });
  assert.equal(first, null);
  // 가드가 거부하는 주소라 두 번째도 null 이고, 어느 쪽도 요청을 보내지 않는다.
  assert.equal(
    await buildLinkPreview("http://169.254.169.254/latest/meta-data/", {
      isAllowedUrl: allowAll,
      isAllowedAddress: () => true,
    }),
    null,
  );
});

test("가드가 거부하는 주소는 조회하지 않는다", async () => {
  clearLinkPreviewCache();
  for (const bad of ["file:///etc/passwd", "http://localhost/", "https://a:b@example.com/"]) {
    assert.equal(
      await buildLinkPreview(bad, { isAllowedUrl: allowAll, isAllowedAddress: () => true }),
      null,
      bad,
    );
  }
});
