/**
 * Which skill-management screens a gateway can serve. The plugin announces one capability per feature, because
 * upstream Hermes can drop one internal (as it did with the dashboard spawn helper) without taking the others
 * down. Older plugins announced one combined capability; that still means every feature is on.
 *
 * Client-safe: the list response carries the result, and the screens hide what is off.
 */
import {
  CURATOR_CAPABILITY,
  LEARNING_GRAPH_CAPABILITY,
  SKILL_ADMIN_CAPABILITY,
  SKILL_EDIT_CAPABILITY,
  SKILL_HUB_CAPABILITY,
  SKILL_READ_CAPABILITY,
} from "@/lib/hermes/deskrpg-plugin-types";

export type SkillFeature = "read" | "edit" | "hub" | "curator" | "graph";
export type SkillFeatures = Record<SkillFeature, boolean>;

export const SKILL_FEATURE_CAPABILITY: Record<SkillFeature, string> = {
  read: SKILL_READ_CAPABILITY,
  edit: SKILL_EDIT_CAPABILITY,
  hub: SKILL_HUB_CAPABILITY,
  curator: CURATOR_CAPABILITY,
  graph: LEARNING_GRAPH_CAPABILITY,
};

const FEATURES = Object.keys(SKILL_FEATURE_CAPABILITY) as SkillFeature[];

export const NO_SKILL_FEATURES: SkillFeatures = {
  read: false,
  edit: false,
  hub: false,
  curator: false,
  graph: false,
};

export function skillFeaturesOf(capabilities: readonly string[] | null | undefined): SkillFeatures {
  const caps = capabilities ?? [];
  const combined = caps.includes(SKILL_ADMIN_CAPABILITY);
  return Object.fromEntries(
    FEATURES.map((f) => [f, combined || caps.includes(SKILL_FEATURE_CAPABILITY[f])]),
  ) as SkillFeatures;
}

/** No skill management at all — a plugin too old for it, as opposed to a feature this Hermes can't serve. */
export function noSkillManagement(features: SkillFeatures): boolean {
  return FEATURES.every((f) => !features[f]);
}
