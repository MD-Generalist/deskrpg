// GET /api/gateways/:id/plugin/profiles/importable — the gateway's Hermes profiles that are not
// employees yet. POST with `{ names: [...] }` imports them one after another and answers per profile.
// Gateway owner only (owner key).
import { NextRequest, NextResponse } from "next/server";

import {
  BULK_IMPORT_LIMIT,
  importHermesProfiles,
  listImportableProfiles,
} from "@/lib/hermes/profile-import";
import { ERROR_CODE_HEADER } from "@/lib/i18n/error-codes";
import { getUserId } from "@/lib/internal-rpc";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const result = await listImportableProfiles(userId, id);
  if (!result.ok) {
    // Upstream failures ride on 200 + header (Cloudflare replaces 5xx bodies — see plugin/profiles/route.ts).
    return NextResponse.json(
      { errorCode: result.errorCode, error: result.errorCode },
      result.upstream
        ? { status: 200, headers: { [ERROR_CODE_HEADER]: result.errorCode } }
        : { status: result.status },
    );
  }
  return NextResponse.json({ profiles: result.profiles });
}

function badRequest(error: string) {
  return NextResponse.json({ errorCode: "bad_request", error }, { status: 400 });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  let payload: unknown;
  try {
    payload = JSON.parse(await req.text());
  } catch {
    return badRequest("body must be JSON");
  }
  const names =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).names
      : undefined;
  if (
    !Array.isArray(names) ||
    names.length === 0 ||
    names.length > BULK_IMPORT_LIMIT ||
    !names.every((n) => typeof n === "string") ||
    new Set(names).size !== names.length
  ) {
    return badRequest("names must be a non-empty list of distinct profile names");
  }
  const result = await importHermesProfiles({ userId, gatewayId: id, profileNames: names });
  if (!result.ok) {
    return NextResponse.json(
      { errorCode: result.errorCode, error: result.errorCode },
      { status: result.status },
    );
  }
  return NextResponse.json({ results: result.results });
}
