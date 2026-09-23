import { SkillsApiError } from "./skills-api";

type T = (key: string, params?: Record<string, string | number>) => string;

/** 문구가 따로 있는 서버·플러그인 오류 코드. 그 밖의 코드는 일반 실패 문구로 보인다. */
const KNOWN = new Set([
  "skill_changed",
  "job_busy",
  "node_changed",
  "skill_pinned",
  "forbidden",
  "skill_write_rejected",
  "path_not_editable",
  "plugin_upgrade_required",
]);

/** 실패를 화면 문구로. 코드 이름이 그대로 화면에 새지 않게 모르는 코드는 `skills.error.action` 으로 접는다. */
export function skillErrorText(t: T, error: unknown): string {
  if (error instanceof SkillsApiError && KNOWN.has(error.code)) {
    return t(`skills.error.${error.code}`, { detail: error.message });
  }
  return t("skills.error.action");
}
