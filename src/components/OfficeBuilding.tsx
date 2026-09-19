"use client";

import { useEffect, useRef } from "react";
import * as T from "three";
import { addOfficeBuildingLights, buildOfficeBuilding } from "@/game/three/office-building";
import { disposeTree } from "@/game/three/office-renderer";

/** A static miniature headquarters; redraw only when the sidebar changes size. */
export default function OfficeBuilding() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    element.append(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.OrthographicCamera(-2, 2, 2.15, -2.15, 0.1, 30);
    camera.position.set(5, 4, 6);
    camera.lookAt(0, 1.15, 0);
    addOfficeBuildingLights(scene);
    const model = buildOfficeBuilding();
    scene.add(model);
    const draw = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      const halfWidth = (2.15 * width) / height;
      camera.left = -halfWidth;
      camera.right = halfWidth;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    draw();
    return () => {
      observer.disconnect();
      disposeTree(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);
  return <div ref={host} className="h-full w-full" />;
}
