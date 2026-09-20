import { isAccountPasswordValid } from "@/lib/security-policy";

export type PasswordChangePlan =
  | { ok: true; body: { currentPassword: string; newPassword: string } }
  | { ok: false; errorCode: string };

/**
 * 화면이 서버에 보내기 전에 거르는 것들. 서버도 같은 규칙을 다시 검사한다 —
 * 여기는 왕복을 줄이려는 것이지 보안 경계가 아니다.
 * `password_mismatch` 만 화면 전용이다(확인칸은 서버로 가지 않는다).
 */
export function planPasswordChange(input: {
  current: string;
  next: string;
  confirm: string;
}): PasswordChangePlan {
  if (!input.current || !input.next) {
    return { ok: false, errorCode: "current_new_password_required" };
  }
  if (input.next !== input.confirm) {
    return { ok: false, errorCode: "password_mismatch" };
  }
  if (!isAccountPasswordValid(input.next)) {
    return { ok: false, errorCode: "password_length_invalid" };
  }
  if (input.current === input.next) {
    return { ok: false, errorCode: "password_unchanged" };
  }
  return { ok: true, body: { currentPassword: input.current, newPassword: input.next } };
}
