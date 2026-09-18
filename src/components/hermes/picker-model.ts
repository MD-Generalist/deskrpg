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

/**
 * 툴셋 체크를 바꾼 다음 목록 — **불러온 행 이름 안의 것만** 싣는다.
 * 부모가 config GET 의 `enabledToolsets`(MCP 서버 이름이 섞일 수 있다)로 시드해도 플러그인 PUT 이
 * `unknown toolsets` 로 400 을 내지 않게. MCP 항목은 플러그인이 쓸 때 보존하므로 빼도 사라지지 않는다.
 */
export function toggleToolset(
  list: string[],
  name: string,
  on: boolean,
  rows: ToolsetRow[],
): string[] {
  const known = new Set(rows.map((r) => r.name));
  return toggle(list, name, on).filter((n) => known.has(n));
}

/**
 * 스킬 체크(`enabled` = 켜짐)를 바꾼 다음 **끈** 목록 — 불러온 스킬 이름 안의 것, 필수 제외.
 * 플러그인 PUT 은 모르는 스킬·필수 스킬을 400 으로 거절한다.
 */
export function toggleSkill(
  disabled: string[],
  name: string,
  enabled: boolean,
  rows: SkillRow[],
): string[] {
  const allowed = new Set(rows.filter((r) => !r.essential).map((r) => r.name));
  return toggle(disabled, name, !enabled).filter((n) => allowed.has(n));
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
