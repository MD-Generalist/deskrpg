import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CommuteMaterials, CommuteQuality } from "./commute-materials";

export interface CommuteTree {
  readonly group: T.Group;
  readonly branches: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  readonly leaves: T.InstancedMesh<T.BufferGeometry, T.MeshStandardMaterial>;
  /** Removes the tree and releases only its geometry and instance buffers. */
  dispose(): void;
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** A bent, tapering limb with continuous rings, not overlapping cylinders. */
function limb(start: T.Vector3, end: T.Vector3, radius: number, bend: number): T.BufferGeometry {
  const control = start
    .clone()
    .lerp(end, 0.5)
    .add(new T.Vector3(bend, 0.11, -bend * 0.6));
  const curve = new T.QuadraticBezierCurve3(start, control, end);
  const geometry = new T.TubeGeometry(curve, 4, radius, 5, false);
  const positions = geometry.getAttribute("position");
  for (let ring = 0; ring <= 4; ring++) {
    const center = curve.getPointAt(ring / 4);
    const taper = 1 - (ring / 4) * 0.83;
    for (let side = 0; side <= 5; side++) {
      const index = ring * 6 + side;
      const point = new T.Vector3()
        .fromBufferAttribute(positions, index)
        .sub(center)
        .multiplyScalar(taper)
        .add(center);
      positions.setXYZ(index, point.x, point.y, point.z);
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A roughly 3m tall, 2m wide miniature street tree. The clear bole is ~1.6m;
 * staggered limbs carry foliage through a roughly 1.3m deep crown.
 * size is a uniform multiplier. Two renderables per tree at either quality;
 * the light tier thins twigs and leaves without changing the leaf silhouette.
 * Palette resources (including both alpha-cutout shadow materials) are borrowed.
 * Dispose each tree before its palette; do not feed it into static batching.
 */
export function createCommuteTree(
  palette: CommuteMaterials,
  {
    seed = 1979,
    size = 1,
    quality = "desktop",
  }: { seed?: number; size?: number; quality?: CommuteQuality } = {},
): CommuteTree {
  if (!Number.isFinite(size) || size <= 0)
    throw new RangeError("Tree size must be positive and finite");
  const random = seeded(seed);
  const group = new T.Group();
  group.name = "commute:tree";
  group.scale.setScalar(size);
  const parts: T.BufferGeometry[] = [];
  const twigPaths: [T.Vector3, T.Vector3][] = [];
  const trunkTop = new T.Vector3((random() - 0.5) * 0.13, 2.45, (random() - 0.5) * 0.13);
  parts.push(limb(new T.Vector3(), trunkTop, 0.075, 0.045));
  const mainCount = quality === "desktop" ? 7 : 5;
  const twigCount = quality === "desktop" ? 3 : 2;
  const leavesPerTwig = quality === "desktop" ? 18 : 13;
  const rotation = random() * Math.PI * 2;
  for (let i = 0; i < mainCount; i++) {
    // Separate lower spreading limbs from upright upper growth. Stratifying
    // heights avoids random seeds collapsing the crown into one umbrella fan.
    const level = i / (mainCount - 1);
    const angle = rotation + i * 2.399963 + (random() - 0.5) * 0.3;
    const reach = 0.66 - level * 0.29 + random() * 0.09;
    const junction = trunkTop
      .clone()
      .multiplyScalar((1.61 + level * 0.66 + random() * 0.055) / trunkTop.y);
    const tip = new T.Vector3(
      Math.cos(angle) * reach,
      1.94 + level * 0.83 + random() * 0.055,
      Math.sin(angle) * reach,
    );
    parts.push(limb(junction, tip, 0.036 - level * 0.014, (random() - 0.5) * 0.14));
    for (let j = 0; j < twigCount; j++) {
      const start = junction.clone().lerp(tip, 0.56 + j * 0.14);
      const twigAngle = angle + (j - (twigCount - 1) / 2) * 0.95;
      const end = tip
        .clone()
        .add(
          new T.Vector3(
            Math.cos(twigAngle) * (0.19 + random() * 0.17),
            (j / (twigCount - 1) - 0.5) * 0.17 + 0.065 + random() * 0.06,
            Math.sin(twigAngle) * (0.19 + random() * 0.17),
          ),
        );
      parts.push(limb(start, end, 0.014, (random() - 0.5) * 0.06));
      twigPaths.push([start, end]);
    }
  }
  const branchGeometry = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  const branches = new T.Mesh(branchGeometry, palette.materials.bark);
  branches.name = "commute:tree:branches";
  branches.castShadow = true;
  branches.receiveShadow = true;

  // Each instance is one gently folded leaf. Alpha map supplies pointed edges,
  // while actual curvature catches light differently from either street side.
  const leafGeometry = new T.PlaneGeometry(1, 1, 2, 2);
  leafGeometry.translate(0, 0.5, 0);
  const positions = leafGeometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    positions.setZ(
      i,
      Math.abs(positions.getX(i)) * 0.16 + Math.sin(positions.getY(i) * Math.PI) * 0.08,
    );
  }
  leafGeometry.computeVertexNormals();
  const leaves = new T.InstancedMesh(
    leafGeometry,
    palette.materials.leaf,
    twigPaths.length * leavesPerTwig,
  );
  leaves.name = "commute:tree:leaves";
  leaves.customDepthMaterial = palette.leafDepthMaterial;
  leaves.customDistanceMaterial = palette.leafDistanceMaterial;
  leaves.castShadow = true;
  leaves.receiveShadow = true;
  const transform = new T.Object3D();
  const color = new T.Color();
  let index = 0;
  for (const [start, end] of twigPaths) {
    const heading = Math.atan2(end.z - start.z, end.x - start.x);
    for (let j = 0; j < leavesPerTwig; j++) {
      const fraction = 0.17 + (j / (leavesPerTwig - 1)) * 0.83;
      transform.position.copy(start).lerp(end, fraction);
      // Alternate around the twig; each leaf grows from it instead of filling a ball.
      const azimuth = heading + (j % 2 ? 1 : -1) * (0.65 + random() * 1.1);
      const direction = new T.Vector3(
        Math.cos(azimuth),
        (random() - 0.3) * 1.4,
        Math.sin(azimuth),
      ).normalize();
      transform.quaternion.setFromUnitVectors(T.Object3D.DEFAULT_UP, direction);
      transform.rotateY((random() - 0.5) * Math.PI * 1.5);
      const length = (quality === "light" ? 0.2 : 0.18) + random() * 0.105;
      transform.scale.set(length * (0.44 + random() * 0.2), length, length);
      transform.updateMatrix();
      leaves.setMatrixAt(index, transform.matrix);
      color.setHSL(0.17 + random() * 0.065, 0.13 + random() * 0.2, 0.67 + random() * 0.26);
      leaves.setColorAt(index++, color);
    }
  }
  leaves.instanceMatrix.needsUpdate = true;
  leaves.instanceColor!.needsUpdate = true;
  leaves.computeBoundingBox();
  leaves.computeBoundingSphere();
  group.add(branches, leaves);
  let disposed = false;
  return {
    group,
    branches,
    leaves,
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      branchGeometry.dispose();
      leafGeometry.dispose();
      leaves.dispose();
    },
  };
}
