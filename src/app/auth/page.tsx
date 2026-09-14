import AuthPageClient from "./AuthPageClient";

export const dynamic = "force-dynamic";

export default function AuthPage() {
  // Public and self-hosted offices share an image; only the public site enables
  // this launch page. Existing build-time configuration remains supported.
  const isComingSoon =
    process.env.COMING_SOON === "true" || process.env.NEXT_PUBLIC_COMING_SOON === "true";
  return <AuthPageClient isComingSoon={isComingSoon} />;
}
