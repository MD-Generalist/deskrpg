import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/internal-rpc";
import { sameOriginMutation, safeSetupError, validateTimezone } from "@/lib/hermes/setup/policy";
import {
  setupCapabilities,
  discoverSetupHost,
  inspectSetupHost,
  startSetup,
  getSetupJob,
  cancelSetupJob,
  connectSetupUrl,
} from "@/lib/hermes/setup/service";
import type { HostTarget } from "@/lib/hermes/setup/types";
import { isValidProfileName } from "@/lib/hermes/profile-name";

export const runtime = "nodejs";
async function readBody(req: NextRequest) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("setup_invalid_request");
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) throw new Error("setup_invalid_request");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
  }
}
const response = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  const code = safeSetupError(error);
  const status =
    code === "setup_forbidden" || code === "setup_bad_origin"
      ? 403
      : code === "setup_not_found"
        ? 404
        : code === "setup_busy"
          ? 409
          : 400;
  return response({ error: code, errorCode: code }, status);
}
export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return response({ errorCode: "unauthorized" }, 401);
  try {
    const job = req.nextUrl.searchParams.get("job");
    return response(job ? { job: getSetupJob(userId, job) } : await setupCapabilities(userId));
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return response({ errorCode: "unauthorized" }, 401);
  if (
    !sameOriginMutation(
      req.headers.get("origin"),
      req.headers.get("host"),
      req.headers.get("sec-fetch-site"),
    )
  )
    return failure(new Error("setup_bad_origin"));
  try {
    if (!req.headers.get("content-type")?.includes("application/json"))
      throw new Error("setup_invalid_request");
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("setup_invalid_request");
    if (body.action === "cancel") return response({ job: cancelSetupJob(userId, body.jobId) });
    if (body.action === "connect-url") return response(await connectSetupUrl(userId, body));
    if (body.mode !== "local" && body.mode !== "ssh") throw new Error("setup_invalid_request");
    const target: HostTarget =
      body.mode === "local"
        ? { mode: "local" }
        : { mode: "ssh", hostId: typeof body.hostId === "string" ? body.hostId : "" };
    if (body.action === "discover")
      return response({ candidates: await discoverSetupHost(userId, target) });
    if (typeof body.candidateId !== "string" || !body.candidateId || body.candidateId.length > 256)
      throw new Error("setup_invalid_request");
    if (body.action === "inspect")
      return response(await inspectSetupHost(userId, target, body.candidateId));
    if (body.action === "prepare") {
      if (
        !Array.isArray(body.profiles) ||
        body.profiles.length > 256 ||
        body.profiles.some((name: unknown) => typeof name !== "string" || !isValidProfileName(name))
      )
        throw new Error("setup_invalid_request");
      // 후보에 이미 시간대가 있으면 호스트가 무시한다. 여기서는 모양만 본다.
      const timezone =
        body.timezone === undefined || body.timezone === null
          ? undefined
          : validateTimezone(body.timezone);
      return response(
        {
          job: await startSetup(
            userId,
            target,
            body.candidateId,
            [...new Set<string>(body.profiles)],
            timezone,
          ),
        },
        202,
      );
    }
    throw new Error("setup_invalid_request");
  } catch (error) {
    return failure(error);
  }
}
