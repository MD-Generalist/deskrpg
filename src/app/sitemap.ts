import type { MetadataRoute } from "next";
import { createSitemapEntries, isPublicLandingEnabled } from "./social-preview";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  return createSitemapEntries(isPublicLandingEnabled(process.env));
}
