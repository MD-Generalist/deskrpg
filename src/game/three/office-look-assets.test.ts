import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OFFICE_LOOKS } from "./office-looks";
import { officeLookAssetUrl } from "./office-look-assets";
import { createActor } from "./characters";
import { disposeTree } from "./office-renderer";

test("every catalog identity uses its registered GLB through the shared actor factory", async () => {
  const original = GLTFLoader.prototype.loadAsync;
  const urls: string[] = [];
  GLTFLoader.prototype.loadAsync = async (url) => {
    urls.push(url);
    return { scene: new T.Group(), animations: [] } as unknown as GLTF;
  };
  try {
    for (const [index, look] of OFFICE_LOOKS.entries()) {
      const actor = createActor(`profile-${look.id}`, look.coat, index, undefined, look);
      try {
        assert.ok("ready" in actor);
        assert.equal(await actor.ready, true);
        assert.equal(actor.id, `profile-${look.id}`);
        assert.equal(actor.root.userData.officeLookId, look.id);
        assert.equal(actor.root.userData.modelStyle, "gltf");
        assert.equal(actor.root.userData.assetStatus, "ready");
        assert.equal(urls.at(-1), `/assets/characters/office/${look.id}.glb`);
      } finally {
        disposeTree(actor.root);
      }
    }
    assert.equal(new Set(urls).size, OFFICE_LOOKS.length);
    assert.equal(officeLookAssetUrl("office-eun"), "/assets/characters/office/office-eun.glb");
  } finally {
    GLTFLoader.prototype.loadAsync = original;
  }
});
