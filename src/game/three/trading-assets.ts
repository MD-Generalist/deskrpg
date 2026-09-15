import * as T from "three";
import { getObjectDimensions, type MapObject } from "../../lib/object-types";
import { round } from "./primitives";
export const TRADING_ASSETS = {
  "trade-round-table": { type: "meeting_table", footprint: [2, 2] },
  "trade-square-table": { type: "meeting_table", footprint: [2, 2] },
  "trade-coffee-table": { type: "meeting_table", footprint: [2, 2] },
  "trade-display-cabinet": { type: "reception_desk", footprint: [2, 1] },
  "trade-air-display": { type: "reception_desk", footprint: [2, 1] },
  "trade-packing-bench": { type: "studio_counter", footprint: [4, 1] },
  "trade-sample-display": { type: "studio_shelf", footprint: [2, 1] },
} as const;
/** Authored transport exhibition furniture. Floor origin; front +Z; meter dimensions. */
export function buildTradingAsset(id: keyof typeof TRADING_ASSETS) {
  const g = new T.Group();
  g.name = id;
  const mat = (color: string, roughness = 0.6, metalness = 0) =>
    new T.MeshStandardMaterial({ color, roughness, metalness });
  const oak = mat("#cdb58c"),
    navy = mat("#263e59"),
    white = mat("#eeeae0"),
    steel = mat("#9ca5aa", 0.3, 0.8),
    dark = mat("#262d33", 0.4, 0.6),
    paper = mat("#f5f1df"),
    card = mat("#ae875c");
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    m: T.Material = oak,
  ) => {
    if (Math.min(w, h, d) < 0.06) {
      const o = new T.Mesh(new T.BoxGeometry(w, h, d), m);
      o.position.set(x, y, z);
      o.castShadow = o.receiveShadow = true;
      g.add(o);
      return o;
    }
    return round(g, w, h, d, m, x, y, z, Math.min(0.015, w / 4, h / 4, d / 4));
  };
  const mesh = (geo: T.BufferGeometry, m: T.Material, x: number, y: number, z: number) => {
    const o = new T.Mesh(geo, m);
    o.position.set(x, y, z);
    o.castShadow = o.receiveShadow = true;
    g.add(o);
    return o;
  };
  if (id === "trade-round-table" || id === "trade-square-table" || id === "trade-coffee-table") {
    const height = id === "trade-coffee-table" ? 0.45 : 0.78;
    if (id === "trade-square-table") box(1.72, 0.07, 1.72, 0, height - 0.035, 0, oak);
    else mesh(new T.CylinderGeometry(0.85, 0.845, 0.07, 64), oak, 0, height - 0.035, 0);
    for (const x of [-0.51, 0.51])
      for (const z of [-0.51, 0.51])
        box(0.045, height - 0.07, 0.045, x, (height - 0.07) / 2, z, dark);
    const cup = mesh(
      new T.CylinderGeometry(0.052, 0.044, 0.09, 20),
      white,
      0.18,
      height + 0.045,
      0.1,
    );
    cup.name = "table-cup";
    box(0.24, 0.009, 0.18, -0.2, height + 0.005, -0.08, paper);
  } else if (id === "trade-packing-bench") {
    box(3.94, 0.09, 0.94, 0, 0.87, 0);
    for (const x of [-1.8, 1.8])
      for (const z of [-0.36, 0.36]) box(0.055, 0.82, 0.055, x, 0.41, z, dark);
    box(3.6, 0.05, 0.75, 0, 0.19, 0, steel);
    for (let i = 0; i < 4; i++) {
      const x = 0.25 + i * 0.43;
      box(0.38, 0.34, 0.37, x, 1.085, 0, card);
      box(0.05, 0.006, 0.38, x, 1.258, 0, paper);
      box(0.16, 0.12, 0.004, x, 1.07, 0.187, paper);
    }
    box(0.54, 0.31, 0.45, -1.35, 1.07, 0, white);
    box(0.4, 0.025, 0.3, -1.35, 1.24, -0.02, dark);
    box(0.32, 0.007, 0.24, -1.35, 0.923, 0.3, paper);
    box(0.48, 0.055, 0.37, -0.65, 0.925, 0.03, steel);
    box(0.14, 0.1, 0.15, -0.65, 1, -0.09, dark);
    const tape = mesh(new T.TorusGeometry(0.065, 0.021, 8, 20), card, -0.25, 0.94, 0.24);
    tape.rotation.x = Math.PI / 2;
    for (const x of [-1, 0.8]) box(0.64, 0.35, 0.59, x, 0.39, 0, card);
  } else {
    box(1.94, 0.76, 0.84, 0, 0.43, 0);
    box(1.98, 0.06, 0.9, 0, 0.84, 0);
    for (const x of [-0.83, 0.83]) box(0.07, 0.07, 0.68, x, 0.045, 0, dark);
    for (const x of [-0.48, 0.48]) {
      box(0.91, 0.67, 0.035, x, 0.43, 0.434, oak);
      box(0.035, 0.07, 0.018, x + 0.3, 0.5, 0.462, steel);
    }
    if (id === "trade-sample-display") {
      // Open tiered sample trays with small bottles, cartons and material swatches.
      for (let row = 0; row < 2; row++)
        for (let col = 0; col < 5; col++) {
          const x = -0.74 + col * 0.37,
            z = -0.2 + row * 0.4;
          box(0.32, 0.035, 0.33, x, 0.9, z, navy);
          const bottle = mesh(
            new T.CylinderGeometry(0.043, 0.047, 0.13, 12),
            col % 2 ? white : steel,
            x - 0.07,
            0.984,
            z,
          );
          bottle.name = "sample-bottle";
          box(0.07, 0.035, 0.07, x - 0.07, 1.065, z, dark);
          box(0.115, 0.1, 0.11, x + 0.07, 0.966, z, paper);
        }
    } else if (id === "trade-air-display") {
      box(1.58, 0.035, 0.66, 0, 0.9, 0, navy);
      // Airliner fuselage, swept wings, stabilizers, blue tail and paired nacelles.
      const body = mesh(new T.SphereGeometry(1, 24, 12), white, 0, 1.14, 0);
      body.scale.set(0.69, 0.074, 0.075);
      const wing = (points: number[][], y: number, m: T.Material) => {
        const shape = new T.Shape(points.map((p) => new T.Vector2(p[0], p[1])));
        const o = mesh(
          new T.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: false }),
          m,
          0,
          y,
          0,
        );
        o.rotation.x = Math.PI / 2;
        return o;
      };
      wing(
        [
          [-0.15, 0],
          [0.18, 0.39],
          [0.32, 0.39],
          [0.15, 0],
          [0.32, -0.39],
          [0.18, -0.39],
        ],
        1.13,
        white,
      );
      wing(
        [
          [0.4, 0],
          [0.55, 0.2],
          [0.65, 0.2],
          [0.58, 0],
          [0.65, -0.2],
          [0.55, -0.2],
        ],
        1.17,
        white,
      );
      const fin = mesh(new T.ConeGeometry(0.13, 0.24, 3), navy, 0.49, 1.27, 0);
      fin.scale.z = 0.12;
      for (const z of [-0.22, 0.22]) {
        const engine = mesh(new T.CylinderGeometry(0.035, 0.041, 0.15, 16), steel, 0.05, 1.075, z);
        engine.rotation.z = Math.PI / 2;
      }
      for (let i = 0; i < 10; i++)
        for (const z of [-0.068, 0.068]) box(0.025, 0.022, 0.007, -0.43 + i * 0.085, 1.16, z, navy);
      box(0.06, 0.19, 0.06, 0, 1, 0, steel);
    } else {
      box(1.62, 0.035, 0.56, 0, 0.9, 0, navy);
      // Pointed ship hull lofted through beam stations rather than a rectangular block.
      const stations = [
        [-0.77, 0.015],
        [-0.6, 0.145],
        [0.35, 0.145],
        [0.7, 0.075],
        [0.78, 0],
      ];
      const vertices: number[] = [],
        indices: number[] = [];
      for (const [x, w] of stations)
        vertices.push(x, 1.01, -w, x, 1.01, w, x, 0.93, w * 0.55, x, 0.93, -w * 0.55);
      for (let i = 0; i < stations.length - 1; i++)
        for (let j = 0; j < 4; j++) {
          const a = i * 4 + j,
            b = i * 4 + ((j + 1) % 4),
            c = (i + 1) * 4 + j,
            d = (i + 1) * 4 + ((j + 1) % 4);
          indices.push(a, b, c, b, d, c);
        }
      const geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      mesh(geo, navy, 0, 0, 0);
      box(1.12, 0.025, 0.25, 0, 1.01, 0, white);
      for (let i = 0; i < 4; i++)
        for (const z of [-0.066, 0.066]) {
          box(0.16, 0.09, 0.11, -0.33 + i * 0.18, 1.065, z, i % 2 ? card : steel);
          for (let k = 0; k < 3; k++)
            box(0.009, 0.07, 0.005, -0.38 + i * 0.18 + k * 0.04, 1.065, z + 0.057, white);
        }
      box(0.22, 0.23, 0.22, 0.43, 1.13, 0, white);
      box(0.25, 0.06, 0.25, 0.43, 1.245, 0, navy);
      for (let i = 0; i < 4; i++) box(0.04, 0.035, 0.006, 0.34 + i * 0.055, 1.21, 0.113, dark);
      box(0.015, 0.31, 0.015, 0.51, 1.4, 0, steel);
      box(0.18, 0.012, 0.012, 0.51, 1.48, 0, steel);
    }
  }
  return g;
}
export function renderTradingObject(host: T.Group, object: MapObject): boolean {
  const id = object.variant as keyof typeof TRADING_ASSETS,
    def = TRADING_ASSETS[id];
  if (!def || def.type !== object.type) return false;
  const size = getObjectDimensions(object.type, object.direction);
  host.name = `trading-object:${object.id}`;
  host.userData.mapObjectId = object.id;
  host.userData.assetId = id;
  host.position.set(object.col + size.width / 2, 0, object.row + size.height / 2);
  host.rotation.y = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 }[
    object.direction ?? "down"
  ];
  host.add(buildTradingAsset(id));
  return true;
}
