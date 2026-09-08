import assert from "node:assert/strict";
import test from "node:test";

import { isGeneratedTilesetName } from "./hooks/useMapEditor";

/**
 * 2026-09-08 스테이징 실측에서 나온 경계다.
 *
 * "사용하지 않는 타일셋 정리" 를 처음 눌렀더니 16개 중 4개가 **사용자가 직접
 * 가져온** 타일셋이었다. 판정이 "지금 맵에 배치된 타일이 없음" 이었기 때문인데,
 * 나중에 쓰려고 올려둔 것도 그 조건에 걸린다. 저장 전에 알아채 되돌렸다.
 *
 * 올바른 기준은 **팔레트가 숨기는 집합** — 스탬프 배치와 픽셀 편집이 자동으로
 * 만든 것뿐이다. 아래 이름들은 그날 실제로 목록에 오른 것들이다.
 */
test("자동 생성된 타일셋만 정리 대상이다", () => {
  const generated = [
    "stamp-4ff3e012-b8fc-4f37-b142-eb6211ac8855-edited",
    "stamp-4788b8ca-a027-4673-9f60-593c89e3a1ae-stamp-edited-Floor",
    "stamp-d08c026e-ef5c-4344-b066-80123f17a499-stamp-edited-Foreground",
    "edited-selection-1774856337212",
    "edited-selection-1774858252407",
  ];
  for (const name of generated) {
    assert.equal(isGeneratedTilesetName(name), true, `${name} 은 정리 대상이어야 한다`);
  }
});

test("사용자가 가져온 타일셋은 배치돼 있지 않아도 지우지 않는다", () => {
  const userAssets = [
    "small-office-furniture1",
    "small-office-furniture2",
    "small-office-equipment",
    "dante-labs-tileset",
    "small-office-map",
    "color-palette",
  ];
  for (const name of userAssets) {
    assert.equal(
      isGeneratedTilesetName(name),
      false,
      `${name} 은 사용자 자산이다 — 미배치라도 정리 대상이 아니다`,
    );
  }
});

test("이름 가운데에 stamp 가 들어간 것은 대상이 아니다", () => {
  // 접두사로만 판단한다. `my-stamp-pack` 같은 이름을 지우면 안 된다.
  assert.equal(isGeneratedTilesetName("my-stamp-pack"), false);
  assert.equal(isGeneratedTilesetName("office-edited-selection-tiles"), false);
});
