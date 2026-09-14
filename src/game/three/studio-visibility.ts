import * as T from "three";
/** Capture solid architecture before material batches erase individual panel bounds.
 * Thin metal frames and transparent panes do not suppress an actor's label. */
export function captureStudioLabelOccluders(root: T.Object3D) {
  root.updateWorldMatrix(true, true);
  const boxes: T.Box3[] = [];
  root.traverse((o) => {
    if (!(o instanceof T.Mesh) || !o.visible) return;
    for (let p: T.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    if (
      materials.some(
        (m) =>
          !m.visible || m.transparent || (m instanceof T.MeshStandardMaterial && m.metalness > 0.3),
      )
    )
      return;
    const box = new T.Box3().setFromObject(o);
    if (box.max.y - box.min.y > 0.4) boxes.push(box);
  });
  return boxes;
}
const ray = new T.Ray(),
  hitPoint = new T.Vector3();
export function studioLabelOccluded(origin: T.Vector3, target: T.Vector3, world: T.Object3D) {
  const boxes: T.Box3[] = [];
  world.traverse((o) => {
    if (o.userData.studioLabelOccluders) boxes.push(...o.userData.studioLabelOccluders);
  });
  if (!boxes.length) boxes.push(...captureStudioLabelOccluders(world));
  const distance = origin.distanceTo(target);
  ray.set(origin, target.clone().sub(origin).normalize());
  return boxes.some(
    (box) =>
      ray.intersectBox(box, hitPoint) !== null && origin.distanceTo(hitPoint) < distance - 0.08,
  );
}
export function applyStudioReflection(studio: T.Object3D, texture: T.Texture) {
  studio.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      if (
        m instanceof T.MeshStandardMaterial &&
        (o.name === "continuous-pale-oak-floor" || m.transparent)
      ) {
        m.envMap = texture;
        m.envMapIntensity = o.name === "continuous-pale-oak-floor" ? 0.72 : 0.55;
        if (o.name === "continuous-pale-oak-floor") m.roughness = 0.72;
        m.needsUpdate = true;
      }
  });
}
/** A one-time local probe captures the actual loaded windows; camera orbit samples this cube.
 * It is intentionally static (no actors), avoiding six extra render passes every frame. */
export function captureStudioReflection(
  renderer: T.WebGLRenderer,
  scene: T.Scene,
  studio: T.Group,
) {
  const hidden: T.Object3D[] = [];
  scene.traverse((o) => {
    if (o.userData.actorId && o.visible) {
      o.visible = false;
      hidden.push(o);
    }
  });
  const floor = studio.getObjectByName("continuous-pale-oak-floor");
  if (floor?.visible) {
    floor.visible = false;
    hidden.push(floor);
  }
  const generator = new T.PMREMGenerator(renderer);
  let target: T.WebGLRenderTarget;
  try {
    target = generator.fromScene(scene, 0.04, 0.1, 100, {
      position: new T.Vector3(21, 0.2, 13),
      size: 128,
    });
  } finally {
    hidden.forEach((o) => (o.visible = true));
    generator.dispose();
  }
  applyStudioReflection(studio, target.texture);
  const dispose = studio.userData.disposeActor;
  studio.userData.disposeActor = () => {
    dispose?.();
    studio.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        if (m instanceof T.MeshStandardMaterial && m.envMap === target.texture) m.envMap = null;
    });
    target.dispose();
  };
  studio.userData.reflection = "local-static-studio-probe";
}
