// UUIDv7 (RFC 9562 §5.7) — 앞 48비트가 유닉스 밀리초라 **문자열 정렬이 곧 생성 순서**다.
//
// 왜 필요한가: `chat_room_messages.id` 가 v4(랜덤)이던 동안, `created_at` 동률을 id 로
// 가르는 코드가 승자를 무작위로 골랐다. `created_at` 은 SQLite 에서 밀리초 문자열이라
// 같은 밀리초에 들어온 줄이 흔하다(테스트뿐 아니라 동시에 끝난 NPC 답도 그렇다).
// 그래서 "최근 N 줄" 과 "방의 마지막 메시지" 가 호출마다 달라졌다.
//
// Node 22 에 내장 UUIDv7 이 없어 직접 만든다. `node:crypto` 말고는 아무것도 쓰지 않는다.

import { randomFillSync } from "node:crypto";

/** 마지막으로 쓴 타임스탬프(ms). 시계가 뒤로 가도 여기서 멈춘다. */
let lastMs = 0;
/**
 * `rand_a`(12비트)를 같은 밀리초 안의 **단조 증가 카운터**로 쓴다 — RFC 9562 §6.2
 * "Monotonic Random" 의 고정 길이 변형이다. 이 12비트는 버전 니블 바로 뒤, 랜덤 꼬리
 * 앞에 있으므로, 카운터만 올라도 문자열 전체가 커진다.
 *
 * **한 프로세스 안에서만** 보장된다. 여러 프로세스가 같은 방에 같은 밀리초로 쓰면 그 둘
 * 사이의 순서는 다시 랜덤이다 — 그 경우까지 잡으려면 DB 시퀀스가 필요하다. 지금 문제였던
 * "한 프로세스가 연달아 넣은 줄" 은 이것으로 완전히 결정적이 된다.
 */
let counter = 0;
const COUNTER_MAX = 0xfff;

const bytes = new Uint8Array(16);
const HEX: string[] = [];
for (let i = 0; i < 256; i += 1) HEX.push(i.toString(16).padStart(2, "0"));

export function uuidv7(): string {
  // 시계가 뒤로 가면 마지막 값에 머문다 — 되감긴 시각으로 쓰면 정렬이 깨진다.
  const now = Math.max(Date.now(), lastMs);

  if (now === lastMs) {
    counter += 1;
    if (counter > COUNTER_MAX) {
      // 한 밀리초에 4096개를 넘겼다. 다음 밀리초를 미리 당겨 쓰고 카운터를 되돌린다.
      lastMs = now + 1;
      counter = 0;
    }
  } else {
    lastMs = now;
    // 새 밀리초는 0 이 아니라 낮은 난수에서 시작한다 — 예측 가능한 id 를 줄이면서도
    // 4096개 중 절반 이상의 여유를 남긴다.
    counter = randomFillSync(new Uint8Array(1))[0] & 0x3ff;
  }

  const ms = lastMs;
  // 48비트 타임스탬프. `>>>` 는 32비트라 상위 16비트는 나눗셈으로 꺼낸다.
  const msHigh = Math.floor(ms / 0x1_0000_0000);
  const msLow = ms % 0x1_0000_0000;
  bytes[0] = (msHigh >>> 8) & 0xff;
  bytes[1] = msHigh & 0xff;
  bytes[2] = (msLow >>> 24) & 0xff;
  bytes[3] = (msLow >>> 16) & 0xff;
  bytes[4] = (msLow >>> 8) & 0xff;
  bytes[5] = msLow & 0xff;

  // 버전 7 + rand_a 상위 4비트 / rand_a 하위 8비트.
  bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);
  bytes[7] = counter & 0xff;

  // 나머지 8바이트는 난수. 첫 바이트의 상위 2비트는 variant(10).
  randomFillSync(bytes, 8, 8);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);

  let out = "";
  for (let i = 0; i < 16; i += 1) {
    out += HEX[bytes[i]];
    if (i === 3 || i === 5 || i === 7 || i === 9) out += "-";
  }
  return out;
}
