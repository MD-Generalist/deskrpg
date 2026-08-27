// NPC 가 답을 만드는 동안 "지금 무엇을 하는 중인지" 한 줄로 알려 준다.
//
// 왜 본문과 분리하나: Hermes 의 `tool.progress` 는 진행 신호이지 답변이 아니다.
// 실측(v0.20.2)에서 `_thinking` 툴은 완성된 답변 **전체**를 delta 에 한 번 더 실어
// 보내는데, 예전에 이걸 채팅 청크로 흘리다가 1:1 대화에서 답이 두 번 보였다.
// 그래서 여기서는 **도구 이름만** 쓰고 delta 본문은 절대 통과시키지 않는다.
//
// 도구 이름은 Hermes `/v1/toolsets` 에서 실측한 목록이다(27개). 모르는 이름은
// 일반 문구로 덮는다 — 내부 식별자가 사용자 화면에 새어 나가지 않게.

/** 활동 표시에 쓸 번역 키. 화면에 보일 문자열은 로케일이 정한다. */
export type ActivityNotice = { key: string };

// Hermes `/v1/toolsets` 에서 실측한 **함수명** 63개 기준이다. 툴셋 이름(`web`)이 아니라
// 개별 함수명(`web_search`)이 이벤트에 실려 온다 — 처음에 툴셋 이름으로 짰다가 실측에서
// 전부 빗나갔다. 접두사로 묶어 새 함수가 늘어도 대체로 맞게 떨어지게 한다.
const TOOL_PREFIXES: [string, string][] = [
  ["web_", "npc.activity.searching"],
  ["x_search", "npc.activity.searching"],
  ["session_search", "npc.activity.recalling"],
  ["search_files", "npc.activity.readingFile"],
  ["browser_", "npc.activity.browsing"],
  ["read_file", "npc.activity.readingFile"],
  ["write_file", "npc.activity.writingFile"],
  ["patch", "npc.activity.writingFile"],
  ["terminal", "npc.activity.runningCommand"],
  ["execute_code", "npc.activity.runningCommand"],
  ["process", "npc.activity.runningCommand"],
  ["memory", "npc.activity.recalling"],
  ["image_generate", "npc.activity.makingImage"],
  ["video_generate", "npc.activity.makingImage"],
  ["xai_video", "npc.activity.makingImage"],
  ["vision_analyze", "npc.activity.lookingAtImage"],
  ["video_analyze", "npc.activity.lookingAtImage"],
  ["browser_vision", "npc.activity.lookingAtImage"],
  ["todo", "npc.activity.organizing"],
  ["skill", "npc.activity.organizing"],
  ["a2a_", "npc.activity.askingAround"],
  ["delegate_task", "npc.activity.askingAround"],
  ["clarify", "npc.activity.askingAround"],
  ["text_to_speech", "npc.activity.speaking"],
  ["_thinking", "npc.activity.thinking"],
];

const GENERIC = "npc.activity.working";

/**
 * @param toolName Hermes 가 보낸 tool_name. 빈 값이면 표시할 것이 없다.
 * @returns 표시할 활동, 또는 표시하지 않을 때 null.
 */
export function describeActivity(toolName: string): ActivityNotice | null {
  const name = toolName.trim();
  if (!name) return null;
  // 긴 접두사가 먼저 이기게 한다 — `browser_vision` 은 `browser_` 보다 구체적이다.
  let best: { key: string; length: number } | null = null;
  for (const [prefix, key] of TOOL_PREFIXES) {
    if (!name.startsWith(prefix)) continue;
    if (!best || prefix.length > best.length) best = { key, length: prefix.length };
  }
  return { key: best?.key ?? GENERIC };
}

/** 이 활동이 화면에 보이는 문구를 갖는가 — 로케일 가드가 이 목록을 검사한다. */
export function allActivityKeys(): string[] {
  return [...new Set([...TOOL_PREFIXES.map(([, key]) => key), GENERIC])].sort();
}
