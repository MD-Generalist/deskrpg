/**
 * 플러그인이 보내는 시각을 읽는 단 하나의 자리.
 *
 * 화면·정렬·지표가 제각기 `Date.parse` 를 부르면 계약이 바뀔 때마다 같은 결함이 여러 곳에서
 * 되살아난다. 여기만 고치면 되게 둔다.
 */

import type { PluginTime } from "@/lib/hermes/deskrpg-plugin-types";

/**
 * 카드·실행의 시각을 ms 로. 못 읽으면 `null`.
 *
 * **플러그인은 epoch 초(정수)를 보낸다**(플러그인 `docs/contracts.md`: "칸반의 `created_at`·
 * `started_at`·`ts` 등은 epoch 초(정수)"). 그런데 우리 타입은 `string` 으로 적어 뒀고 화면은
 * `Date.parse` 를 불렀다 — `Date.parse(1758412800)` 은 **NaN** 이라 경과 시간이 조용히 사라진다.
 * 가짜 플러그인 서버(`fake-plugin-server.ts`)가 ISO 문자열을 보내는 바람에 테스트는 내내
 * 초록이었고, 실제 게이트웨이에서만 값이 비었다.
 *
 * 양쪽을 다 받는다. 숫자(또는 숫자로만 된 문자열)는 epoch 초로, 그 밖은 ISO 로 읽는다.
 * 한쪽으로 통일하는 것은 계약 변경이라 이 함수가 결정할 일이 아니다.
 */
export function taskTimeMs(value: PluginTime | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? epochSecondsToMs(value) : null;
  }
  if (/^\d+$/.test(value.trim())) return epochSecondsToMs(Number(value.trim()));
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * epoch 초를 ms 로. 이미 ms 로 보이는 값(13자리 이상)은 그대로 둔다 — 어느 단위로 오는지
 * 계약이 흔들린 적이 있어, 1000배 틀린 시각을 그리느니 둘 다 받아들인다.
 */
function epochSecondsToMs(value: number): number {
  return Math.abs(value) >= 1e11 ? value : value * 1000;
}
