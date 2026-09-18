import test from "node:test";
import assert from "node:assert/strict";
import { PORTRAIT_FRAMING } from "./office-look-thumbnail";

/**
 * 원형 아바타 초상은 머리끝(높은 번헤어·컬 포함, ~1.9m)부터 양쪽 어깨(~1.45m)까지
 * 들어와야 한다. 실제 렌더는 WebGL 이 필요해 노드 테스트에서 돌릴 수 없으니, 대신
 * 이 프레이밍 상수가 그 세로 구간을 커버하는지를 기하로 고정한다. 실제 화면 확인은
 * art/portrait-check/ 의 컨택트시트로 별도 수행했다(50개 룩 전수).
 */
test("초상 프레이밍은 정사각형이고 어깨~머리끝 구간을 세로로 커버한다", () => {
  const { fov, position, target } = PORTRAIT_FRAMING;

  // 정사각 출력이어야 한다 (aspect 1 로 카메라를 만든다는 전제와 짝을 이룬다).
  assert.equal(typeof fov, "number");
  assert.ok(fov > 0 && fov < 60, "얼굴이 늘어나지 않도록 표준 인물 화각을 쓴다");

  // 목표점 높이는 어깨와 머리끝 사이여야 한다.
  assert.ok(target.y >= 1.5 && target.y <= 1.75, `target.y=${target.y} 가 범위를 벗어났다`);

  const distance = position.distanceTo(target);
  const verticalSpanMeters = 2 * distance * Math.tan((fov * Math.PI) / 180 / 2);
  assert.ok(
    verticalSpanMeters >= 0.5 && verticalSpanMeters <= 0.75,
    `verticalSpanMeters=${verticalSpanMeters} 가 0.5~0.75m 범위를 벗어났다`,
  );

  const top = target.y + verticalSpanMeters / 2;
  const bottom = target.y - verticalSpanMeters / 2;
  assert.ok(top >= 1.9, `head top 1.9m 이 프레임 위쪽(${top}) 안에 들어와야 한다`);
  assert.ok(bottom <= 1.45, `shoulders ~1.45m 이 프레임 아래쪽(${bottom}) 안에 들어와야 한다`);

  // 살짝 정면을 벗어난 카메라(작은 +X 오프셋)여야 한다 — 정면 정중앙이면 밋밋하다.
  assert.ok(position.x > 0 && position.x < 0.6, `position.x=${position.x}`);
});
