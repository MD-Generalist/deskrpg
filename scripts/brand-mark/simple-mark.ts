/**
 * 작은 크기 전용 마크 — 본사 실루엣을 도형 세 개로 줄인다(탑·낮은 동·옥상 띠).
 *
 * 3D 렌더는 16px 에서 뭉갠다. 탭 아이콘은 이 단순형을 쓰고, 그보다 큰 자리는 3D 미니어처를 쓴다.
 * 모양이 갈리지 않도록 비율은 실제 모델(office-building.ts)의 탑·동 비례에서 가져왔다.
 */
export type SimpleMarkColors = { background: string; tower: string; wing: string; roof: string };

export const MARK_COLORS: SimpleMarkColors = {
  background: "#365e4b", // 제품 녹색 — 작은 아이콘은 면이 진해야 형태가 남는다
  tower: "#f3eee2", // cream
  wing: "#c7d0bc",
  roof: "#243f33",
};

/** 정사각 SVG. `size` 는 픽셀 크기이고 도형 비율은 그대로다. */
export function simpleMarkSvg(size: number, colors: SimpleMarkColors = MARK_COLORS): string {
  const c = colors;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">`,
    `<rect width="64" height="64" rx="14" fill="${c.background}"/>`,
    // 탑: 왼쪽에 높게. 창은 두 줄만 남긴다 — 16px 에서 더 넣으면 회색 덩어리가 된다.
    `<rect x="13" y="16" width="21" height="34" rx="2" fill="${c.tower}"/>`,
    `<rect x="11" y="13" width="25" height="5" rx="2" fill="${c.roof}"/>`,
    // 낮은 동: 오른쪽.
    `<rect x="36" y="28" width="16" height="22" rx="2" fill="${c.wing}"/>`,
    `<rect x="34" y="25" width="20" height="4.5" rx="2" fill="${c.roof}"/>`,
    // 입구와 창 — 면적이 큰 것만.
    `<rect x="20" y="41" width="7" height="9" rx="1.5" fill="${c.roof}"/>`,
    `<rect x="17" y="23" width="6" height="6" rx="1" fill="${c.wing}"/>`,
    `<rect x="26" y="23" width="6" height="6" rx="1" fill="${c.wing}"/>`,
    `<rect x="40" y="34" width="8" height="6" rx="1" fill="${c.tower}"/>`,
    `</svg>`,
  ].join("");
}
