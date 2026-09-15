import test from "node:test";
import assert from "node:assert/strict";
import { OFFICE_ENVIRONMENTS, buildOfficeEnvironment } from "./office-environments";
import { tiledSnapshot } from "./tiled-preview";
import { boardApproach, boardLocation, BoardArrival } from "./office-kanban";
for (const { id } of OFFICE_ENVIRONMENTS)
  test(`${id}: 게시판에 연결된 빈 접근 지점이 있다`, () => {
    const m = tiledSnapshot(buildOfficeEnvironment(id));
    const blocked = new Set(m.blocked);
    const walkable = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < m.cols && y < m.rows && !blocked.has(`${x},${y}`);
    const raw = buildOfficeEnvironment(id);
    const spawn = raw.layers.flatMap((l) => l.objects ?? []).find((o) => o.type === "spawn")!;
    const start = { x: Math.floor(spawn.x / 32), y: Math.floor(spawn.y / 32) };
    assert.ok(boardLocation(m));
    assert.ok(boardApproach(m, start, walkable));
  });
test("도착 전에는 열리지 않고 도착 후 한 번만 열린다", () => {
  const a = new BoardArrival();
  a.start(5.5, 2.5, 0);
  assert.equal(a.update({ x: 5.5, y: 2.5, walking: true }, 5), false);
  assert.equal(a.update({ x: 1, y: 2, walking: false }, 6), false);
  assert.equal(a.update({ x: 5.5, y: 2.5, walking: false }, 7), true);
  assert.equal(a.update({ x: 5.5, y: 2.5, walking: false }, 8), false);
});
test("새 이동 명령과 시간 초과는 게시판 예약을 취소한다", () => {
  const a = new BoardArrival();
  a.start(1, 1, 0);
  a.cancel();
  assert.equal(a.update({ x: 1, y: 1, walking: false }, 1), false);
  a.start(1, 1, 0);
  assert.equal(a.update({ x: 1, y: 1, walking: false }, 60001), false);
});
