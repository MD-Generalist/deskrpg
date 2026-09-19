import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildOfficeEnvironment, OFFICE_ENVIRONMENTS } from "../game/three/office-environments";
import agencyV2 from "./fixtures/official-agency-v2.json";
import { detectOfficeEnvironmentId, summarizeParticipants } from "./channel-list-summary";

describe("detectOfficeEnvironmentId", () => {
  it("공식 환경으로 만든 채널 맵은 그 환경으로 알아본다", () => {
    for (const environment of OFFICE_ENVIRONMENTS) {
      assert.equal(
        detectOfficeEnvironmentId(buildOfficeEnvironment(environment.id)),
        environment.id,
      );
    }
  });

  it("DB 가 문자열로 돌려준 맵도 알아본다(SQLite)", () => {
    assert.equal(detectOfficeEnvironmentId(JSON.stringify(buildOfficeEnvironment("tech"))), "tech");
  });

  it("오브젝트가 바뀌어도 바닥·크기가 같으면 같은 환경이다", () => {
    const map = structuredClone(buildOfficeEnvironment("executive")) as {
      layers: Array<{ name: string; objects?: unknown[] }>;
    };
    const objects = map.layers.find((layer) => layer.name === "Objects");
    objects?.objects?.pop();
    assert.equal(detectOfficeEnvironmentId(map), "executive");
  });

  it("업그레이드 전 옛 공식 맵은 업그레이드 대상 환경으로 알아본다", () => {
    assert.equal(detectOfficeEnvironmentId(agencyV2), "agency");
  });

  it("알 수 없는 맵·빈 값·깨진 JSON 은 null", () => {
    assert.equal(detectOfficeEnvironmentId(null), null);
    assert.equal(detectOfficeEnvironmentId("{not json"), null);
    assert.equal(detectOfficeEnvironmentId({ width: 3, height: 3, layers: [] }), null);
  });
});

describe("summarizeParticipants", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 19, 0, minute));

  it("소유자를 맨 앞에, 나머지는 먼저 들어온 순서로, 앞 다섯 명만", () => {
    const rows = [
      { userId: "u3", nickname: "셋", appearance: { a: 3 }, joinedAt: at(3) },
      { userId: "u1", nickname: "하나", appearance: { a: 1 }, joinedAt: at(1) },
      { userId: "owner", nickname: "주인", appearance: { a: 0 }, joinedAt: at(9) },
      { userId: "u2", nickname: "둘", appearance: null, joinedAt: at(2) },
      { userId: "u4", nickname: "넷", appearance: null, joinedAt: at(4) },
      { userId: "u5", nickname: "다섯", appearance: null, joinedAt: at(5) },
    ];
    const summary = summarizeParticipants(rows, "owner");
    assert.equal(summary.count, 6);
    assert.deepEqual(
      summary.preview.map((p) => p.nickname),
      ["주인", "하나", "둘", "셋", "넷"],
    );
    assert.deepEqual(summary.preview[0], { nickname: "주인", appearance: { a: 0 } });
  });

  it("같은 사용자가 두 번 와도 한 명이다", () => {
    const rows = [
      { userId: "owner", nickname: "주인", appearance: null, joinedAt: at(0) },
      { userId: "owner", nickname: "주인", appearance: null, joinedAt: null },
    ];
    assert.equal(summarizeParticipants(rows, "owner").count, 1);
  });

  it("아무도 없으면 0", () => {
    assert.deepEqual(summarizeParticipants([], "owner"), { count: 0, preview: [] });
  });
});
