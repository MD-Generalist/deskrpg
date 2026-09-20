import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ko from "./i18n/locales/ko";
import { isNpcCallRejected, npcCallErrorKey, NPC_CALL_REJECTIONS } from "./npc-call-errors";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("모든 거절 사유에 사용자에게 보이는 문구가 있다", () => {
  for (const reason of NPC_CALL_REJECTIONS) {
    const key = npcCallErrorKey(reason);
    assert.ok(key in ko, `${reason} 의 문구(${key})가 로케일에 없다`);
    assert.ok((ko as Record<string, string>)[key].trim().length > 0, `${reason} 문구가 비어 있다`);
  }
});

test("사유마다 다른 문구를 쓴다 — 무엇이 막았는지 구분돼야 한다", () => {
  const keys = NPC_CALL_REJECTIONS.filter((r) => r !== "unavailable").map(npcCallErrorKey);
  assert.equal(new Set(keys).size, keys.length);
});

test("모르는 사유도 빈 문구로 새지 않는다", () => {
  assert.equal(npcCallErrorKey("something_new"), npcCallErrorKey("unavailable"));
  assert.equal(npcCallErrorKey(undefined), npcCallErrorKey("unavailable"));
});

test("ack 가 없거나 ok 가 아니면 거절로 본다", () => {
  assert.equal(isNpcCallRejected({ ok: true }), false);
  assert.equal(isNpcCallRejected({ ok: false, error: "already_claimed" }), true);
  assert.equal(isNpcCallRejected(undefined), true, "타임아웃도 실패다");
  assert.equal(isNpcCallRejected(null), true);
});

// 서버가 돌려줄 수 있는 사유와 이 목록이 갈라지면, 새 사유가 조용히 폴백 문구로 떨어진다.
// `npc:call` 핸들러가 반환하는 error 문자열을 직접 읽어 대조한다.
test("서버가 npc:call 에서 반환하는 사유가 모두 목록에 있다", () => {
  const source = readFileSync(path.join(repoRoot, "src/server/npc-coordination.ts"), "utf8");
  const handler = source.slice(
    source.indexOf('handle("npc:call"'),
    source.indexOf('handle("npc:return-home"'),
  );
  assert.ok(handler.length > 0, "npc:call 핸들러를 찾지 못했다");
  const reasons = [...handler.matchAll(/error:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(reasons.length > 0, "핸들러에서 거절 사유를 추출하지 못했다");
  for (const reason of reasons) {
    assert.ok(
      (NPC_CALL_REJECTIONS as readonly string[]).includes(reason),
      `서버의 거절 사유 "${reason}" 에 사용자 문구가 없다 — npc-call-errors.ts 에 추가하세요.`,
    );
  }
});

// 거절 문구가 있어도 ack 를 받지 않으면 도달하지 않는다 — 실제로 그게 이 카드의 결함이었다.
// 클라이언트의 모든 `npc:call` emit 이 콜백을 넘기는지 본다(세 번째 인자 = ack).
test("클라이언트의 npc:call 은 모두 ack 를 받는다", () => {
  const files = ["src/app/game/GamePageClient.tsx", "src/game/simulation/office-simulation.ts"];
  const missing: string[] = [];
  for (const file of files) {
    const source = readFileSync(path.join(repoRoot, file), "utf8");
    for (const match of source.matchAll(/emit\(\s*\n?\s*"npc:call"/g)) {
      // emit 호출의 괄호 균형을 세어 인자 목록을 잘라낸다.
      let depth = 0;
      let end = match.index!;
      for (let i = source.indexOf("(", match.index!); i < source.length; i++) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const call = source.slice(match.index!, end + 1);
      if (!/=>|function\s*\(/.test(call)) missing.push(`${file}: ${call.slice(0, 60)}…`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `ack 없이 npc:call 을 보내는 곳이 있습니다 — 서버가 거절해도 사용자는 알 수 없습니다:\n${missing.join("\n")}`,
  );
});
