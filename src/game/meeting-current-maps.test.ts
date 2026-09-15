import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOfficeEnvironment, OFFICE_ENVIRONMENTS } from "./three/office-environments";
import { normalizeMeetingMap, projectMeetingMap } from "./meeting-map-normalization";

test("agency v3+ 회의실 정규화도 폐기된 설정 스폰 대신 맵 스폰을 사용한다", () => {
  const source = buildOfficeEnvironment("agency");
  assert.deepEqual(
    normalizeMeetingMap(source, { spawnCol: 0, spawnRow: 0 }),
    normalizeMeetingMap(source),
  );
});

for (const environment of OFFICE_ENVIRONMENTS) {
  test(`최신 ${environment.id} 맵은 원래 회의실을 사용하고 증축하지 않는다`, () => {
    const source = buildOfficeEnvironment(environment.id);
    const original = structuredClone(source);
    const before = projectMeetingMap(source);
    const normalized = normalizeMeetingMap(source);
    const after = projectMeetingMap(normalized.mapData);
    assert.deepEqual([after.cols, after.rows], [before.cols, before.rows]);
    assert.deepEqual(after.objects, before.objects);
    assert.deepEqual(after.blocked, before.blocked);
    assert.ok(normalized.meetingSpace.seatIds.length >= 4);
    assert.ok(normalized.meetingSpace.standingPositions.length > 0);
    assert.deepEqual(normalizeMeetingMap(normalized.mapData), normalized);
    assert.deepEqual(source, original);
    if (environment.id === "trading")
      assert.deepEqual(normalized.meetingSpace.bounds, { x: 1, y: 1, width: 8, height: 9 });
  });
}
