import * as T from "three";

function seatOwner(object: T.Object3D) {
  for (let owner: T.Object3D | null = object; owner; owner = owner.parent)
    if (owner.userData.seat || owner.userData.seats) return owner;
  return null;
}
function visibleInTree(object: T.Object3D, allowProxy = false) {
  for (let current: T.Object3D | null = object; current; current = current.parent)
    if (!current.visible && !(allowProxy && current === object && current.userData.seatPickProxy))
      return false;
  return true;
}
/** Invisible exact seat proxies may be selected, but never through a nearer opaque surface. */
export function pickFurnitureSeat(ray: T.Raycaster, roots: T.Object3D[]) {
  const hits = ray.intersectObjects(roots, true);
  const hit = hits.find((entry) => seatOwner(entry.object) && visibleInTree(entry.object, true));
  if (!hit) return null;
  const blocker = hits.find((entry) => {
    if (!(entry.object instanceof T.Mesh) || !visibleInTree(entry.object)) return false;
    const material = Array.isArray(entry.object.material)
      ? entry.object.material[entry.face?.materialIndex ?? 0]
      : entry.object.material;
    return (
      material?.visible &&
      !material.transparent &&
      !(material instanceof T.MeshPhysicalMaterial && material.transmission > 0)
    );
  });
  // A batched visible seat and its original proxy occupy the same surface; tolerate bake rounding.
  if (blocker && blocker.distance < hit.distance - 1e-5) return null;
  return { hit, owner: seatOwner(hit.object)! };
}
