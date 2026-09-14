import * as T from "three";
import type { OfficeLook } from "./office-looks";
import { createActor, cylinder } from "./characters";
import { disposeTree } from "./office-renderer";
import { captureWhenReady } from "./ready-capture";

export async function captureThumbnail(
  renderer: T.WebGLRenderer,
  look: OfficeLook,
  index: number,
  signal: AbortSignal,
) {
  const scene = new T.Scene();
  let disposed = false;
  const release = () => {
    if (disposed) return;
    disposed = true;
    disposeTree(scene);
  };
  try {
    const camera = new T.PerspectiveCamera(30, 240 / 280, 0.1, 20);
    camera.position.set(1.5, 1.8, 4.2);
    camera.lookAt(0, 0.97, 0);
    scene.add(new T.HemisphereLight("#fff8ed", "#89988b", 2.5));
    const light = new T.DirectionalLight("#fff1dc", 3);
    light.position.set(-2, 4, 4);
    scene.add(light);
    cylinder(scene, 0.46, 0.5, 0.06, "#d9cbb6", 0, 0.015, 0);
    const actor = createActor(look.id, look.coat, index, undefined, look);
    scene.add(actor.root);
    return await captureWhenReady(
      "ready" in actor ? actor.ready : Promise.resolve(true),
      signal,
      () => {
        actor.update(0, false, "idle", false);
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL("image/png");
      },
      release,
    );
  } finally {
    release();
  }
}
