// GET /api/admin/diagnostics — `deskrpg doctor` 가 보던 것을 브라우저에서 본다. system_admin 전용.
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, gatewayResources, getDefaultSqlitePath, users } from "@/db";
import { hermesInstallAllowed, hostSetupAllowed } from "@/lib/hermes/setup/policy";
import { getUserId } from "@/lib/internal-rpc";
import startupCheck from "@/lib/startup-check.js";

export type DiagnosticsGateway = {
  id: string;
  label: string;
  pluginStatus: string;
  checkedAt: string | null;
};

export type DiagnosticsReport = {
  environment: { errors: string[]; warnings: string[]; dbTarget: "postgresql" | "sqlite" };
  database: { ok: boolean; target: string; message: string };
  hostSetup: { wizard: boolean; hermesInstall: boolean };
  gateways: DiagnosticsGateway[];
};

/**
 * 관리자가 아니면 403 이 아니라 404 다 — 이 화면이 존재한다는 사실 자체를 알리지 않는다.
 * 로그인하지 않은 요청도 같은 404 를 받는다(401 이면 "로그인하면 뭔가 있다" 가 된다).
 */
const notFound = () =>
  NextResponse.json({ errorCode: "not_found", error: "not found" }, { status: 404 });

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  // SQLite 런타임은 타임스탬프를 TEXT 로 돌려준다 — 파싱되지 않으면 원문을 그대로 둔다.
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return null;
}

/**
 * 게이트웨이 요약. **토큰·base URL 은 싣지 않는다** — 진단에 필요한 것은 플러그인 판정과
 * 그 판정을 언제 했는지뿐이고, 자격 증명은 서버 밖으로 나가지 않는다.
 */
async function readGateways(): Promise<DiagnosticsGateway[]> {
  try {
    const rows = await db
      .select({
        id: gatewayResources.id,
        displayName: gatewayResources.displayName,
        pluginStatus: gatewayResources.pluginStatus,
        pluginCheckedAt: gatewayResources.pluginCheckedAt,
      })
      .from(gatewayResources);
    return rows.map((row) => ({
      id: row.id,
      label: row.displayName,
      pluginStatus: row.pluginStatus || "unknown",
      checkedAt: toIso(row.pluginCheckedAt),
    }));
  } catch {
    // DB 가 죽어 있어도 진단 자체는 돌려준다 — 그 사실은 database.ok 가 말한다.
    return [];
  }
}

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return notFound();

  // 역할 확인이 DB 를 타므로 DB 가 완전히 죽으면 관리자도 404 를 받는다. 그래도 fail-closed 를
  // 택한다 — 확인되지 않은 요청에 호스트 상태를 넘기는 것보다 낫다.
  let systemRole: string | undefined;
  try {
    const [row] = await db
      .select({ systemRole: users.systemRole })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    systemRole = row?.systemRole ?? undefined;
  } catch {
    return notFound();
  }
  if (systemRole !== "system_admin") return notFound();

  const inspected = startupCheck.inspectEnvironment(process.env);
  // startup-check.js 는 CommonJS 라 dbTarget 이 string 으로 추론된다 — 그 파일이 쓰는 것과
  // 같은 규칙으로 여기서 좁힌다(둘 중 하나만 나온다).
  const dbTarget: "postgresql" | "sqlite" =
    inspected.dbTarget === "postgresql" ? "postgresql" : "sqlite";
  const environment = { errors: inspected.errors, warnings: inspected.warnings, dbTarget };
  // server.js 와 같은 인자로 부른다 — 앱이 실제로 쓰는 DB 를 찌른다.
  const database = await startupCheck.checkDatabaseReachable({
    databaseUrl: process.env.DATABASE_URL,
    sqlitePath: getDefaultSqlitePath(),
    target: dbTarget,
  });

  const report: DiagnosticsReport = {
    environment,
    database,
    hostSetup: {
      wizard: hostSetupAllowed(process.env, "system_admin"),
      hermesInstall: hermesInstallAllowed(process.env, "system_admin", "local"),
    },
    gateways: await readGateways(),
  };
  return NextResponse.json(report);
}
