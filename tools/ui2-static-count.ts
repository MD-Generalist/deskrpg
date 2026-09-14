import * as T from "three";
import { OfficeRenderer, disposeTree } from "../src/game/three/office-renderer";
import { OFFICE_ENVIRONMENTS, buildOfficeEnvironment } from "../src/game/three/office-environments";
import { tiledSnapshot } from "../src/game/three/tiled-preview";
// Build the production static graph without a WebGL context. This is not a GPU benchmark.
for (const { id } of OFFICE_ENVIRONMENTS) {
  const world = new T.Group();
  const context = {
    world,
    theme: "office",
    sun: new T.DirectionalLight(),
    sky: new T.HemisphereLight(),
    fill: new T.DirectionalLight(),
    renderer: { setClearColor() {}, toneMappingExposure: 1 },
    seats: [],
  };
  const build = (
    OfficeRenderer.prototype as unknown as { buildMap(map: ReturnType<typeof tiledSnapshot>): void }
  ).buildMap;
  build.call(context, tiledSnapshot(buildOfficeEnvironment(id)));
  let opaque = 0,
    transparent = 0,
    shadowCasters = 0;
  world.traverse((object) => {
    if (!(object instanceof T.Mesh) || !object.visible) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => material.transparent)) transparent++;
    else opaque++;
    if (object.castShadow) shadowCasters++;
  });
  console.log(
    JSON.stringify({
      environment: id,
      opaque,
      transparent,
      shadowCasters,
      staticMeshPassEstimate: opaque + transparent + shadowCasters,
    }),
  );
  disposeTree(world);
}
