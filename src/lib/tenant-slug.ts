/**
 * 서브프로젝트의 테넌트 슬러그. Hermes 카드가 이 문자열을 그대로 들고 있으므로
 * **한 번 정하면 바꾸지 않는다** — 표시 이름은 메타 표에 따로 둔다.
 *
 * 한글 이름이 빈 슬러그가 되지 않도록 ASCII 로 좁히지 않는다. Hermes 의 `tasks.tenant` 는
 * 자유 텍스트라 유니코드 글자·숫자를 그대로 받는다.
 */
export const TENANT_SLUG_MAX = 64;
export const TENANT_SLUG_PATTERN = /^[\p{Ll}\p{Lo}\p{N}][\p{Ll}\p{Lo}\p{N}_-]{0,63}$/u;

export function tenantSlugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, TENANT_SLUG_MAX)
    .replace(/-+$/g, "");
}

export function isTenantSlug(value: string): boolean {
  return TENANT_SLUG_PATTERN.test(value);
}
