import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

for (const path of ["/robots.txt", "/sitemap.xml"]) {
  test(`${path}는 로그인 없이 공개 응답을 허용한다`, async () => {
    const response = await proxy(new NextRequest(`https://deskrpg.com${path}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });
}
