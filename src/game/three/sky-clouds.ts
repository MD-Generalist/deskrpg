/**
 * 아침 하늘의 구름 — 출근길 화면(`/auth`)이 쓰는 미니어처 구름.
 *
 * 사이드바 본사와 같은 방식이다: three.js 로 만들고 한 번 구워 PNG 로 쓴다
 * (`scripts/sky/render-clouds.ts`). CSS 도형으로 만든 구름은 타원 두 개가 겹쳐 보여
 * "도형 같다" 는 지적을 받았다(2026-09-20). 구체를 여러 개 겹쳐 뭉게구름의 실루엣을 만든다.
 */
import * as T from "three";

export type CloudPuff = { x: number; y: number; z: number; r: number };

/** 씨앗에서 같은 구름이 나온다 — 화면과 스크립트가 어긋나지 않게 난수를 쓰지 않는다. */
export function cloudPuffs(variant: 0 | 1 | 2): CloudPuff[] {
  const shapes: CloudPuff[][] = [
    [
      { x: -1.55, y: -0.12, z: 0, r: 0.62 },
      { x: -0.75, y: 0.2, z: 0.15, r: 0.86 },
      { x: 0.1, y: 0.34, z: -0.1, r: 1.02 },
      { x: 0.95, y: 0.12, z: 0.12, r: 0.78 },
      { x: 1.68, y: -0.16, z: -0.05, r: 0.56 },
      { x: -0.35, y: -0.42, z: 0.25, r: 0.66 },
      { x: 0.62, y: -0.4, z: -0.22, r: 0.6 },
    ],
    [
      { x: -1.2, y: -0.1, z: 0.1, r: 0.54 },
      { x: -0.45, y: 0.26, z: -0.12, r: 0.82 },
      { x: 0.35, y: 0.1, z: 0.18, r: 0.7 },
      { x: 1.05, y: -0.18, z: -0.08, r: 0.5 },
      { x: -0.1, y: -0.38, z: 0.2, r: 0.58 },
    ],
    [
      { x: -1.8, y: -0.2, z: 0.05, r: 0.5 },
      { x: -1.0, y: 0.08, z: -0.14, r: 0.72 },
      { x: -0.2, y: 0.42, z: 0.1, r: 0.9 },
      { x: 0.7, y: 0.22, z: -0.18, r: 0.8 },
      { x: 1.5, y: -0.05, z: 0.16, r: 0.64 },
      { x: 2.1, y: -0.28, z: -0.06, r: 0.44 },
      { x: 0.2, y: -0.46, z: 0.22, r: 0.7 },
    ],
  ];
  return shapes[variant];
}

/** 구름 하나. 위는 햇빛을 받아 희고 아래는 살짝 가라앉는다(하늘빛 반사). */
export function buildCloud(variant: 0 | 1 | 2): T.Group {
  const group = new T.Group();
  // 덩어리 경계가 도드라지지 않게 명암 폭을 좁게 둔다 — 대비가 크면 "공을 붙여 놓은 것" 처럼 보이고,
  // 아예 없애면(발광) 구름이 흰 판이 된다. 아래쪽만 하늘빛으로 살짝 가라앉힌다.
  const material = new T.MeshStandardMaterial({ color: "#fdfefe", roughness: 1, metalness: 0 });
  for (const puff of cloudPuffs(variant)) {
    const mesh = new T.Mesh(new T.SphereGeometry(puff.r, 32, 24), material);
    mesh.position.set(puff.x, puff.y, puff.z);
    // 뭉게구름은 위아래로 눌려 있다 — 완전한 구는 솜사탕처럼 보인다.
    mesh.scale.set(1, 0.82, 0.94);
    group.add(mesh);
  }
  return group;
}

/** 구름 전용 조명 — 위에서 흰빛, 아래에서 하늘빛. 본사 조명과 섞지 않는다. */
export function addCloudLights(scene: T.Scene) {
  scene.add(new T.HemisphereLight("#ffffff", "#dce7f1", 3.1));
  const sun = new T.DirectionalLight("#fff6e0", 0.55);
  sun.position.set(2.5, 4, 3);
  scene.add(sun);
  return sun;
}
