import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { verifyJWT } from "@/lib/jwt";
import AuthPageClient from "./auth/AuthPageClient";
import { createPublicShareMetadata, isPublicLandingEnabled } from "./social-preview";

export function generateMetadata(): Metadata {
  return isPublicLandingEnabled(process.env)
    ? createPublicShareMetadata()
    : { robots: { index: false, follow: false } };
}

export default async function Home() {
  if (isPublicLandingEnabled(process.env)) {
    return <AuthPageClient isComingSoon />;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  if (token) {
    const payload = await verifyJWT(token);
    if (payload) {
      redirect("/gateways");
    }
  }

  redirect("/auth");
}
