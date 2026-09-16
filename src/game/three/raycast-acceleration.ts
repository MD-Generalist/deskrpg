import * as T from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";

/**
 * 레이캐스트를 BVH 로 가속한다.
 *
 * 이 씬은 메시 799개·삼각형 906,164개이고, 배칭이 만든 가장 큰 메시가 8만 삼각형이다(실측:
 * 프로덕션 빌드, trading 오피스 44×30). three 기본 레이캐스트는 그 삼각형을 전부 훑어서
 * 월드 레이캐스트 한 번이 약 100ms 걸렸다 — 마우스를 움직이기만 해도 10fps 였다.
 *
 * `acceleratedRaycast` 는 `geometry.boundsTree` 가 없으면 three 기본 경로로 그대로 떨어진다.
 * 트리를 세운 지오메트리만 빨라지고 나머지 동작은 변하지 않는다.
 */
let installed = false;
function installRaycastAcceleration() {
  if (installed) return;
  installed = true;
  const geometry = T.BufferGeometry.prototype as unknown as Record<string, unknown>;
  geometry.computeBoundsTree = computeBoundsTree;
  geometry.disposeBoundsTree = disposeBoundsTree;
  (T.Mesh.prototype as unknown as Record<string, unknown>).raycast = acceleratedRaycast;
}

/** 트리를 세우는 값이 있는 크기. 작은 메시는 만드는 비용이 더 크다. */
const MIN_TRIANGLES_FOR_BVH = 600;

export function buildBoundsTrees(root: T.Object3D) {
  installRaycastAcceleration();
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    const geometry = object.geometry as T.BufferGeometry & {
      boundsTree?: unknown;
      computeBoundsTree?: () => void;
    };
    if (geometry.boundsTree || !geometry.computeBoundsTree) return;
    const index = geometry.getIndex();
    const triangles = (index ? index.count : (geometry.getAttribute("position")?.count ?? 0)) / 3;
    if (triangles < MIN_TRIANGLES_FOR_BVH) return;
    geometry.computeBoundsTree();
  });
}
