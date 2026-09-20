/**
 * 대화 입력칸의 강조색.
 *
 * 예전에는 호출자가 팔레트 이름("amber"·"indigo")을 넘기고 클래스를 문자열로 조립했다
 * (`bg-${accent}-500/20`). Tailwind 는 소스를 문자열로 스캔해 클래스를 생성하므로 조립한
 * 이름은 CSS 가 아예 만들어지지 않고, 아무 오류 없이 색이 사라진다. 그래서 강조색은
 * **미리 적어 둔 브랜드 토큰 클래스**로만 고르게 한다.
 *
 * 글자색은 두 강조색 모두 `text-text` 다 — 배경 틴트만으로 NPC 와 회의를 구분하고, 대비는
 * 어느 테마에서든 본문 글자색으로 보장한다.
 */
export type ChatAccent = "npc" | "meeting";

type AccentClasses = {
  /** 드롭다운에서 선택된 후보 */
  option: string;
  /** 본문에 박히는 멘션 칩 */
  chip: string;
  /** 입력칸 포커스 테두리 */
  focusBorder: string;
  /** 보내기 버튼(활성) */
  sendButton: string;
};

export const CHAT_ACCENT: Record<ChatAccent, AccentClasses> = {
  npc: {
    option: "bg-npc/15 text-text",
    chip: "bg-npc/15 text-text",
    focusBorder: "focus:border-npc",
    sendButton: "bg-npc hover:bg-npc-dark text-white",
  },
  meeting: {
    option: "bg-meeting/15 text-text",
    chip: "bg-meeting/15 text-text",
    focusBorder: "focus:border-meeting",
    sendButton: "bg-meeting hover:opacity-90 text-white",
  },
};

export function accentClasses(accent: ChatAccent = "npc"): AccentClasses {
  return CHAT_ACCENT[accent] ?? CHAT_ACCENT.npc;
}
