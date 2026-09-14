/**
 * NPC 에게 보낼 시스템 지시를 **층으로 조립**한다.
 *
 * 왜 층인가 — 예전에는 회의 규칙(과 지금은 사라진 태스크 절차)이 사용자의 인격
 * 텍스트 안으로 문자열 주입됐다. 그래서 사용자가 인격을 편집하면 규약을 같이 지울 수
 * 있었고, 이미 인격이 있는 프로필에 규약만 얹는 것도 불가능했다. 층마다 이름표 경계를
 * 두면 서로 침범하지 않는다. 층을 더할 때도 같은 모양으로 더한다.
 *
 * **인격(identity/soul)은 여기 들어오지 않는다.** Hermes 는 `instructions` 를
 * 기존 시스템 프롬프트 *뒤에 이어 붙일* 뿐 대체하지 않고(`conversation_loop.py`
 * 의 `effective + "\n\n" + ephemeral_system_prompt`), SOUL.md 로드를 끄는
 * 스위치는 HTTP 표면에 없다. 인격을 여기 실으면 프로필의 인격과 공존하게 되고
 * 결과가 불안정해진다. 인격의 소유자는 프로필의 SOUL.md 하나다 — DeskRPG 에서
 * 인격을 쓰는 길은 게이트웨이 플러그인이 SOUL.md 를 직접 쓰는 경로로 연다.
 */

/** 층 이름. 테스트와 구현이 같은 상수를 본다 — 이름을 바꿔도 계약이 어긋나지 않는다. */
export const SECTION = {
  meeting: "team-instructions",
} as const;

export interface NpcPromptLayers {
  /** 회의에서 어떻게 발언하는가. 프리셋의 meetingProtocol. */
  meetingProtocol?: string | null;
}

function section(name: string, body: string): string {
  return `<${name}>\n${body}\n</${name}>`;
}

/**
 * 실을 층이 하나도 없으면 `undefined` 를 돌려준다 — 호출부는 그때 필드를 아예
 * 만들지 않는다. 빈 문자열을 보내면 Hermes 의 시스템 프롬프트 끝에 의미 없는
 * 개행만 남는다.
 */
export function composeNpcInstructions(layers: NpcPromptLayers): string | undefined {
  const parts: string[] = [];

  // 층이 늘면 순서를 여기서 고정한다 — 뒤에 오는 것이 대체로 더 강하게 읽힌다.
  const meeting = layers.meetingProtocol?.trim();
  if (meeting) parts.push(section(SECTION.meeting, meeting));

  return parts.length ? parts.join("\n\n") : undefined;
}
