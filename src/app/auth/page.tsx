import AuthPageClient from "./AuthPageClient";
import type { Metadata } from "next";
import { createAuthShareMetadata, isPublicLandingEnabled } from "../social-preview";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return createAuthShareMetadata(isPublicLandingEnabled(process.env));
}

export default function AuthPage() {
  // Public and self-hosted offices share an image; only the public site enables
  // this launch page. Existing build-time configuration remains supported.
  const isComingSoon = isPublicLandingEnabled(process.env);
  return <AuthPageClient isComingSoon={isComingSoon} />;
}
