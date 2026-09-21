import { NextResponse, type NextRequest } from "next/server";

import { eq } from "drizzle-orm";

import { db, gatewayResources } from "@/db";
import { decryptGatewayToken, getOwnedGatewayResource } from "@/lib/gateway-resources";
import {
  buildPluginCacheUpdate,
  buildPluginInfoCacheUpdate,
} from "@/lib/hermes/plugin-cache-update";
import { probeDeskrpgPluginWithInfo } from "@/lib/hermes/plugin-capability";
import { createPluginClient } from "@/lib/hermes/plugin-client";
import { sameOriginMutation } from "@/lib/hermes/setup/policy";
import { transportFetch } from "@/lib/hermes/setup/transport";
import { applyWorkerPlugin } from "@/lib/hermes/worker-plugin";
import { ERROR_CODE_HEADER } from "@/lib/i18n/error-codes";
import { getUserId } from "@/lib/internal-rpc";

export const runtime = "nodejs";

/**
 * 칸반 워커·크론이 뜨는 직원 프로필 홈에도 플러그인을 둔다(게이트웨이 소유자 전용).
 *
 * 플러그인 `POST /deskrpg/worker-plugin` 을 소유자 키로 부르고, 끝나면 플러그인 정보를 **다시
 * 읽어 캐시를 채운다** — 캐시는 최대 1시간 낡으므로 그러지 않으면 적용했는데도 경고가 남는다.
 * 짧은 호출(직원마다 파일 둘)이라 플러그인 갱신처럼 잡으로 돌리지 않는다.
 *
 * 플러그인 갱신 라우트와 같은 가드를 쓴다: 소유자만, 같은 출처의 변경만.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  }
  // 직원들의 Hermes 설정 파일을 바꾸는 동작이다 — 다른 사이트가 링크 한 번으로 걸 수 없게 한다.
  if (
    !sameOriginMutation(
      req.headers.get("origin"),
      req.headers.get("host"),
      req.headers.get("sec-fetch-site"),
    )
  ) {
    return NextResponse.json(
      { errorCode: "setup_bad_origin", error: "setup_bad_origin" },
      { status: 403 },
    );
  }

  const { id } = await params;
  const resource = await getOwnedGatewayResource(userId, id);
  if (!resource) {
    // 남의 게이트웨이와 없는 게이트웨이를 구분하지 않는다 — 존재 여부를 흘리지 않는다.
    return NextResponse.json({ errorCode: "not_found", error: "not found" }, { status: 404 });
  }

  // deskrpg-allow-token-arg: 응답이 아니라 서버가 Hermes 를 부를 때 쓰는 인자다.
  const token = decryptGatewayToken(resource.tokenEncrypted);
  const client = createPluginClient({ baseUrl: resource.baseUrl, defaultToken: token });

  const outcome = await applyWorkerPlugin({
    ensure: () => client.ensureWorkerPlugin(),
    refreshCache: async () => {
      const probed = await probeDeskrpgPluginWithInfo({
        fetchImpl: transportFetch,
        baseUrl: resource.baseUrl,
        // deskrpg-allow-token-arg: 응답이 아니라 서버가 Hermes 를 부를 때 쓰는 인자다.
        token,
      });
      await db
        .update(gatewayResources)
        .set({
          ...buildPluginCacheUpdate(probed.capability),
          ...buildPluginInfoCacheUpdate(probed.info),
        })
        .where(eq(gatewayResources.id, id));
    },
  });

  if (!outcome.ok) {
    // 게이트웨이 프록시 라우트들과 같이 200 + errorCode — Cloudflare 가 5xx 본문을 갈아치운다.
    return NextResponse.json(
      { errorCode: outcome.errorCode, error: outcome.errorCode },
      { status: 200, headers: { [ERROR_CODE_HEADER]: outcome.errorCode } },
    );
  }
  return NextResponse.json(
    { results: outcome.results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
