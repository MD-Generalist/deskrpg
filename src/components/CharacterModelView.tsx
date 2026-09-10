"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import * as T from "three";
import { createActor, cylinder } from "@/game/three/characters";
import { spritePalette } from "@/game/three/appearance";
import { disposeTree } from "@/game/three/office-renderer";

export default function CharacterModelView({
  source,
  size,
  direction,
  active,
  onUnavailable,
}: {
  source: HTMLCanvasElement | null;
  size: number;
  direction: string;
  active: boolean;
  onUnavailable: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    current = useRef({ direction, active });
  useLayoutEffect(() => {
    current.current = { direction, active };
  }, [direction, active]);
  const failed = useRef(onUnavailable);
  useLayoutEffect(() => {
    failed.current = onUnavailable;
  }, [onUnavailable]);
  useEffect(() => {
    if (!host.current || !source) return;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      failed.current();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(size, size);
    renderer.outputColorSpace = T.SRGBColorSpace;
    host.current.append(renderer.domElement);
    const scene = new T.Scene(),
      camera = new T.PerspectiveCamera(32, 1, 0.1, 20),
      palette = spritePalette(source);
    camera.position.set(2, 1.8, 3.7);
    camera.lookAt(0, 0.8, 0);
    scene.add(new T.HemisphereLight("#fff7e4", "#839b78", 2.5));
    const light = new T.DirectionalLight("#fff2d5", 3);
    light.position.set(2, 5, 4);
    scene.add(light);
    cylinder(scene, 0.65, 0.7, 0.1, "#d3bd96", 0, -0.08, 0);
    const actor = createActor("character-preview", palette.shirt, 0, palette);
    scene.add(actor.root);
    let frame = 0;
    const render = (time: number) => {
      frame = requestAnimationFrame(render);
      if (!current.current.active) return;
      actor.rig.rotation.y =
        { up: Math.PI, down: 0, left: -Math.PI / 2, right: Math.PI / 2 }[
          current.current.direction
        ] ?? 0;
      actor.update(time / 1000, true, "walking", false);
      renderer.render(scene, camera);
    };
    render(0);
    return () => {
      cancelAnimationFrame(frame);
      disposeTree(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [source, size]);
  return <div ref={host} style={{ width: size, height: size }} aria-hidden="true" />;
}
