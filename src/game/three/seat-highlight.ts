import * as T from "three";

/** Build an isolated overlay from the invisible meshes retained for batched seat picking. */
export function createSeatHighlight(owner: T.Object3D) {
  owner.updateWorldMatrix(true, true);
  const group = new T.Group();
  if (!owner.userData.seat && !owner.userData.seats) return group;
  owner.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    const material = new T.MeshBasicMaterial({
      color: "#efb84d",
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const overlay = new T.Mesh(object.geometry.clone(), material);
    overlay.matrixAutoUpdate = false;
    overlay.matrix.copy(object.matrixWorld);
    overlay.renderOrder = 20;
    group.add(overlay);
  });
  return group;
}
