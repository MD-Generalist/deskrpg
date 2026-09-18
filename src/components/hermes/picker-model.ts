/** `ToolsetSkillPicker` 의 순수 로직 — 화면 없이 고정한다. */
import type { SkillRow, ToolsetRow } from "@/lib/hermes/plugin-client-types";

export function initialSelection(toolsets: ToolsetRow[], skills: SkillRow[]) {
  return {
    enabledToolsets: toolsets
      .filter((t) => t.enabled)
      .map((t) => t.name)
      .sort(),
    disabledSkills: skills
      .filter((s) => s.disabled && !s.essential)
      .map((s) => s.name)
      .sort(),
  };
}

export function toggle(list: string[], name: string, on: boolean): string[] {
  const next = new Set(list);
  if (on) next.add(name);
  else next.delete(name);
  return [...next].sort();
}

export function groupSkills(skills: SkillRow[], query: string) {
  const q = query.trim().toLowerCase();
  const hit = (s: SkillRow) => !q || `${s.name} ${s.description}`.toLowerCase().includes(q);
  const groups = new Map<string, SkillRow[]>();
  for (const skill of skills.filter(hit)) {
    const bucket = groups.get(skill.category) ?? [];
    bucket.push(skill);
    groups.set(skill.category, bucket);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, rows]) => ({ category, skills: rows }));
}

export function classifyLoad(
  bodies: Array<Record<string, unknown>>,
): "unsupported" | "error" | "ok" {
  const codes = bodies.map((b) => (typeof b.errorCode === "string" ? b.errorCode : null));
  if (codes.includes("plugin_upgrade_required")) return "unsupported";
  return codes.some((c) => c !== null) ? "error" : "ok";
}
