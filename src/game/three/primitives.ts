import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
const mat = (color: string) => new T.MeshStandardMaterial({ color, roughness: 0.8 });
export function round(
  parent: T.Object3D,
  w: number,
  h: number,
  d: number,
  color: string | T.Material,
  x = 0,
  y = 0,
  z = 0,
  r = 0.08,
) {
  const m = new T.Mesh(
    new RoundedBoxGeometry(w, h, d, 2, r),
    typeof color === "string" ? mat(color) : color,
  );
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
export function sphere(
  parent: T.Object3D,
  r: number,
  color: string | T.Material,
  x = 0,
  y = 0,
  z = 0,
  sx = 1,
  sy = 1,
  sz = 1,
) {
  const m = new T.Mesh(
    new T.SphereGeometry(r, 20, 14),
    typeof color === "string" ? mat(color) : color,
  );
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  parent.add(m);
  return m;
}
export function cylinder(
  parent: T.Object3D,
  rt: number,
  rb: number,
  h: number,
  color: string,
  x = 0,
  y = 0,
  z = 0,
) {
  const m = new T.Mesh(new T.CylinderGeometry(rt, rb, h, 24), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
