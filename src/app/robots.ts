import type { MetadataRoute } from "next";
import { createRobotsPolicy, isPublicLandingEnabled } from "./social-preview";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return createRobotsPolicy(isPublicLandingEnabled(process.env));
}
