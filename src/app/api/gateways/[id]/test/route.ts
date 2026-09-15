import { transportFetch } from "@/lib/hermes/setup/transport";
import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";

import { eq } from "drizzle-orm";

import { db, gatewayResources } from "@/db";
import {
  decryptGatewayToken,
  getAccessibleGatewayResource,
  persistGatewayValidationState,
} from "@/lib/gateway-resources";
import { probeHermesGateway } from "@/lib/hermes/gateway-probe";
import {
  buildPluginCacheUpdate,
  buildPluginInfoCacheUpdate,
} from "@/lib/hermes/plugin-cache-update";
import { probeDeskrpgPluginWithInfo } from "@/lib/hermes/plugin-capability";
import { diagnoseUnreachable } from "@/lib/hermes/unreachable-hint";
import { getUserId } from "@/lib/internal-rpc";
import { ERROR_CODE_HEADER } from "@/lib/i18n/error-codes";

/**
 * 프로브 실패는 **200 으로** 돌려준다. 사용자가 입력한 외부 주소가 응답하지 않은 것은
 * 우리 서버의 실패가 아니라 요청 처리의 정상적인 결과이고, 5xx 로 답하면 진단이 사라진다 —
 * 실측: Cloudflare 가 오리진의 5xx 를 자기 에러 페이지로 통째로 갈아치운다.
 *
 *     컨테이너 내부  502  body={"errorCode":"probe_502_marker",...}
 *     Caddy 까지     502  body 그대로
 *     인터넷 경유    502  server: cloudflare · body="error code: 502"
 *
 * 그래서 브라우저는 `502 {}` 만 받았고 화면에는 generic 폴백만 떴다. 4xx 는 통과하므로
 * 인증·권한 응답은 그대로 둔다. 코드는 헤더에도 실어 다른 프록시 뒤에서도 살아남게 한다.
 */
const PROBE_RESULT_INIT = (errorCode: string) => ({
  status: 200,
  headers: { [ERROR_CODE_HEADER]: errorCode },
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const accessible = await getAccessibleGatewayResource(userId, id);
  if (!accessible) {
    return NextResponse.json(
      { errorCode: "gateway_not_found", error: "Gateway not found" },
      { status: 404 },
    );
  }

  // 게이트웨이 레벨에서 확인할 수 있는 것은 도달성뿐이다 — Hermes 의 인증은 프로필
  // 스코프라 토큰 검증은 프로필 테스트가 담당한다. 예전에는 프로브가 hermes 로 판정하지
  // 못하면 OpenClaw 의 WS 핸드셰이크로 폴백했지만, 그 백엔드는 제거됐다.
  const probe = await probeHermesGateway(accessible.resource.baseUrl);

  if (probe.kind === "hermes") {
    // Hermes 임이 확인된 뒤에만 플러그인을 찌른다 — API Server 가 아닌 곳에 우리
    // 경로를 보낼 이유가 없다.
    // 응답 모양(`plugin: {status, version}`)은 그대로 두고, 자동화 계약 블록(info)만
    // `plugin_info_json` 캐시에 함께 남긴다 — 보드 확보(kanban-boards.ts)가 그것으로 판정한다.
    const probed = await probeDeskrpgPluginWithInfo({
      fetchImpl: transportFetch,
      baseUrl: accessible.resource.baseUrl,
      // deskrpg-allow-token-arg: 응답이 아니라 서버가 Hermes 를 부를 때 쓰는 인자다.
      token: decryptGatewayToken(accessible.resource.tokenEncrypted),
    });
    const plugin = probed.capability;
    await db
      .update(gatewayResources)
      .set({ ...buildPluginCacheUpdate(plugin), ...buildPluginInfoCacheUpdate(probed.info) })
      .where(eq(gatewayResources.id, id));

    // 프로브 결과를 **검증 상태로도** 남긴다. 예전에는 plugin_* 만 쓰고
    // last_validation_status 를 비워 둬서, 연결 테스트를 아무리 눌러도 목록이
    // "아직 테스트하지 않음" 에 머물렀다(스테이징 실측 2026-09-07).
    // persistGatewayValidationState 는 이 브랜치 이전부터 있었지만 **아무도 부르지
    // 않는 죽은 코드**였다.
    await persistGatewayValidationState(id, { status: "valid", error: null });

    return NextResponse.json({
      ok: true,
      messageCode: "gateway_connection_succeeded",
      message: "Gateway connection succeeded.",
      plugin,
    });
  }

  if (probe.kind === "dashboard") {
    // 주소는 Hermes 인데 API Server 가 아니다. 대시보드(기본 9119)에 붙은 경우가
    // 대부분이라, 고쳐야 할 것은 토큰이 아니라 포트다.
    await persistGatewayValidationState(id, {
      status: "error",
      error: `gateway_is_not_api_server (HTTP ${probe.status})`,
    });
    return NextResponse.json(
      {
        ok: false,
        errorCode: "gateway_is_not_api_server",
        error: `Reached a Hermes web UI, not the API Server (HTTP ${probe.status})`,
      },
      PROBE_RESULT_INIT("gateway_is_not_api_server"),
    );
  }

  if (probe.kind === "unreachable") {
    // 왜 못 닿았는지까지 좁힌다. 가장 흔한 원인은 주소가 아니라 **어디서 보는 주소인가**다
    // — 컨테이너 안에서 127.0.0.1 은 Hermes 가 아니라 컨테이너 자신이다.
    const errorCode = diagnoseUnreachable({
      baseUrl: accessible.resource.baseUrl,
      inContainer: existsSync("/.dockerenv"),
    });
    await persistGatewayValidationState(id, {
      status: "unreachable",
      error: probe.error,
    });
    return NextResponse.json(
      { ok: false, errorCode, error: probe.error },
      PROBE_RESULT_INIT(errorCode),
    );
  }

  // 응답은 왔지만 Hermes API Server 가 아니다. 고쳐야 할 것은 자격증명이 아니라 주소다.
  await persistGatewayValidationState(id, {
    status: "error",
    error: `not_a_hermes_gateway (HTTP ${probe.status})`,
  });
  return NextResponse.json(
    {
      ok: false,
      errorCode: "not_a_hermes_gateway",
      error: `Not a Hermes API Server (HTTP ${probe.status})`,
    },
    PROBE_RESULT_INIT("not_a_hermes_gateway"),
  );
}
