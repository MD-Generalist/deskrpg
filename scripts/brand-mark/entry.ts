/**
 * 브라우저에서 도는 마크 렌더러. 캡처 스크립트가 esbuild 로 묶어 빈 페이지에 넣는다.
 * 사이드바 본사와 같은 모델·조명이라(office-building.ts) 건물을 고치면 로고도 같이 바뀐다.
 */
import * as T from "three";

import { addOfficeBuildingLights, buildOfficeBuilding } from "../../src/game/three/office-building";

/** 배경을 지정하면 그 색으로 칠하고(앱 아이콘), 없으면 투명하게 둔다(사이드바 마크). */
export function renderBrandMark(size: number, background?: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  if (background) scene.background = new T.Color(background);
  addOfficeBuildingLights(scene);
  // 나무를 빼 실루엣을 좁히고, 탑을 꽉 채워 16px 에서도 층과 입구가 남는다.
  const model = buildOfficeBuilding({ trees: false });
  scene.add(model);
  const box = new T.Box3().setFromObject(model);
  const center = box.getCenter(new T.Vector3());
  const half = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) * 0.62;
  const camera = new T.OrthographicCamera(-half, half, half, -half, 0.1, 40);
  camera.position.set(center.x + 6, center.y + 4.6, center.z + 7);
  camera.lookAt(center.x, center.y - 0.05, center.z);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  return canvas.toDataURL("image/png");
}

declare global {
  interface Window {
    renderBrandMark: typeof renderBrandMark;
  }
}
window.renderBrandMark = renderBrandMark;
