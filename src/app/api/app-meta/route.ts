import { NextResponse } from "next/server";

import { resolveFeedbackUrl } from "@/components/growth/feedback-client";
import { appMetaCache } from "@/lib/app-meta-server";

export async function GET() {
  const meta = await appMetaCache.get();
  return NextResponse.json({
    ...meta,
    feedbackUrl: resolveFeedbackUrl(process.env.DESKRPG_FEEDBACK_URL),
  });
}
