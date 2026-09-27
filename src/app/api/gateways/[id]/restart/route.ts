import { NextResponse, type NextRequest } from "next/server";

import { safeSetupError, sameOriginMutation } from "@/lib/hermes/setup/policy";
import { GATEWAY_START_COMMAND } from "@/lib/hermes/setup/restart-support";
import { readGatewayRestartSupport, startGatewayRestart } from "@/lib/hermes/setup/service";
import { getUserId } from "@/lib/internal-rpc";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

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
  return NextResponse.json({ errorCode: code, error: code }, { status });
}

function unauthorized() {
  return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
}

/**
 * Whether [다시 시작] is offered for this gateway, and the command to run by hand either way. The button is for the
 * gateway's owner who may run host setup, on a host DeskRPG can send commands to (`restart-support.ts`).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId) return unauthorized();
  const { id } = await params;
  try {
    const support = await readGatewayRestartSupport(userId, id);
    return NextResponse.json({ ...support, command: GATEWAY_START_COMMAND }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

/**
 * Restart a gateway that stopped answering (owner only), through Hermes' own restart on its host. A long operation:
 * the job id comes back at once and progress is read through the `/api/gateways/setup` job query, like the wizard.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(req);
  if (!userId) return unauthorized();
  // This runs commands on the host — another site must not be able to trigger it with a single link.
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
  try {
    const job = await startGatewayRestart(userId, id);
    return NextResponse.json({ jobId: job.id }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
