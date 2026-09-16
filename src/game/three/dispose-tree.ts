import * as T from "three";

export function disposeTree(root: T.Object3D) {
  // Collect before callbacks mutate the tree. Clear hooks first for reentrant disposal.
  const actorDisposers = new Set<() => void>();
  root.traverse((object) => {
    const dispose = object.userData.disposeActor;
    if (typeof dispose === "function") {
      actorDisposers.add(dispose);
      delete object.userData.disposeActor;
    }
  });
  actorDisposers.forEach((dispose) => dispose());
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  root.traverse((object) => {
    if (object instanceof T.InstancedMesh) object.dispose();
    if (object instanceof T.DirectionalLight || object instanceof T.SpotLight)
      object.shadow.dispose();
    if (!(object instanceof T.Mesh) && !(object instanceof T.Line)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof T.Texture) textures.add(value);
    }
  });
  geometries.forEach((g) => {
    // BVH 를 세운 지오메트리는 트리도 함께 버린다(three-mesh-bvh 가 붙여 준 메서드).
    (g as T.BufferGeometry & { disposeBoundsTree?: () => void }).disposeBoundsTree?.();
    g.dispose();
  });
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
  root.clear();
}
