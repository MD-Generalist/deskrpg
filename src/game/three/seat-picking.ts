import { furnitureSeats, resolveSeat, type Seat } from "./seating";
import type { MapObject } from "../../lib/object-types";
import * as T from "three";

/** Apply the same world-space seat records used by navigation and actor poses. */
export function attachFurnitureSeats(
  host: T.Group,
  object: MapObject,
  objects: MapObject[] = [object],
) {
  const seats = object.type === "chair" ? [resolveSeat(object, objects)] : furnitureSeats([object]);
  delete host.userData.seat;
  delete host.userData.seats;
  if (seats.length === 1) host.userData.seat = seats[0];
  else if (seats.length) host.userData.seats = seats;
  return seats;
}

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
  const owner = seatOwner(hit.object)!;
  const candidates: Seat[] = owner.userData.seats ?? [owner.userData.seat];
  const seat = [...candidates].sort(
    (a, b) =>
      Math.hypot(a.x - hit.point.x, a.z - hit.point.z) -
      Math.hypot(b.x - hit.point.x, b.z - hit.point.z),
  )[0];
  return { hit, owner, seat };
}
