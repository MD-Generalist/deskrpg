import { NextResponse } from "next/server";

import { appMetaCache } from "@/lib/app-meta-server";

export async function GET() {
  return NextResponse.json(await appMetaCache.get());
}
