import type { Metadata } from "next";
import type { MetadataRoute } from "next";

const PUBLIC_URL = "https://deskrpg.com/";
const SHARE_IMAGE_URL = "https://deskrpg.com/assets/social/og";
const SHARE_TITLE = "DeskRPG for Hermes — AI 직원이 일하는 사무실";
const SHARE_DESCRIPTION =
  "Hermes 에이전트와 함께 대화하고, 회의하고, 칸반 작업을 진행하는 셀프호스팅 3D 가상 오피스.";

export function isPublicLandingEnabled(env: Record<string, string | undefined>): boolean {
  return env.COMING_SOON === "true" || env.NEXT_PUBLIC_COMING_SOON === "true";
}

export function createPublicShareMetadata(): Metadata {
  return {
    metadataBase: new URL(PUBLIC_URL),
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    alternates: { canonical: PUBLIC_URL },
    openGraph: {
      title: SHARE_TITLE,
      description: SHARE_DESCRIPTION,
      url: PUBLIC_URL,
      siteName: "DeskRPG for Hermes",
      locale: "ko_KR",
      type: "website",
      images: [
        {
          url: SHARE_IMAGE_URL,
          width: 1200,
          height: 630,
          alt: "DeskRPG for Hermes 3D office with AI coworkers",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: SHARE_TITLE,
      description: SHARE_DESCRIPTION,
      images: [SHARE_IMAGE_URL],
    },
    robots: { index: true, follow: true },
  };
}

export function createAuthShareMetadata(isPublic: boolean): Metadata {
  if (!isPublic) return { robots: { index: false, follow: false } };

  return {
    ...createPublicShareMetadata(),
    robots: { index: false, follow: false },
  };
}

export function createRobotsPolicy(isPublic: boolean): MetadataRoute.Robots {
  if (!isPublic) return { rules: { userAgent: "*", disallow: "/" } };

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/auth",
        "/api/",
        "/admin/",
        "/channels",
        "/characters",
        "/game",
        "/gateways",
        "/profiles",
        "/ui2-review",
      ],
    },
    sitemap: "https://deskrpg.com/sitemap.xml",
  };
}

export function createSitemapEntries(isPublic: boolean): MetadataRoute.Sitemap {
  if (!isPublic) return [];

  return [{ url: PUBLIC_URL, changeFrequency: "monthly", priority: 1 }];
}
