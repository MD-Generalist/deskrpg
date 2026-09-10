"use client";

import { useEffect, useRef } from "react";
import * as T from "three";
import { round, sphere, cylinder } from "@/game/three/primitives";
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
    scene.add(new T.HemisphereLight("#fff8e9", "#879889", 2.6));
    const sun = new T.DirectionalLight("#fff1d6", 3);
    sun.position.set(-3, 6, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, {
      left: -4,
      right: 4,
      top: 5,
      bottom: -4,
      near: 0.1,
      far: 15,
    });
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    const model = new T.Group();
    scene.add(model);
    // Raised plaza, five-storey tower and a lower entrance wing.
    round(model, 3.15, 0.16, 2.2, "#d5c6aa", 0, 0.04, 0, 0.1);
    round(model, 2.98, 0.055, 2.05, "#eee5d3", 0, 0.15, 0, 0.04);
    round(model, 1.48, 2.65, 1.15, "#e6dfcd", -0.35, 1.51, -0.2, 0.04);
    round(model, 0.86, 1.67, 1.1, "#c7d0bc", 0.81, 1.02, -0.12, 0.035);
    round(model, 1.62, 0.12, 1.27, "#526b5c", -0.35, 2.88, -0.2, 0.025);
    round(model, 0.97, 0.09, 1.21, "#718771", 0.81, 1.9, -0.12, 0.025);
    // Recessed sage glazing with warm lights in a few offices.
    for (let floor = 0; floor < 4; floor++) {
      for (let column = 0; column < 4; column++) {
        round(
          model,
          0.24,
          0.32,
          0.035,
          (floor + column) % 5 === 0 ? "#d9bc77" : "#809f98",
          -0.86 + column * 0.34,
          0.95 + floor * 0.46,
          0.395,
          0.008,
        );
      }
      round(model, 1.5, 0.045, 1.18, "#f2ecdf", -0.35, 0.72 + floor * 0.46, -0.2, 0.006);
    }
    for (let floor = 0; floor < 3; floor++) {
      round(model, 0.63, 0.32, 0.03, "#6e9088", 0.81, 0.65 + floor * 0.43, 0.45, 0.008);
      for (const z of [-0.38, 0.06])
        round(model, 0.025, 0.31, 0.28, "#819b8d", 1.255, 0.65 + floor * 0.43, z, 0.007);
    }
    round(model, 0.63, 0.5, 0.05, "#496b62", -0.35, 0.45, 0.42, 0.018);
    round(model, 0.025, 0.46, 0.018, "#ddceb1", -0.35, 0.45, 0.455, 0.004);
    round(model, 0.88, 0.07, 0.46, "#607b66", -0.35, 0.74, 0.52, 0.025);
    round(model, 0.84, 0.05, 0.34, "#b7aa90", -0.35, 0.2, 0.69, 0.014);
    // Rooftop plant bed and two street trees frame the entrance.
    round(model, 0.58, 0.15, 0.42, "#b8b59f", 0.81, 2.02, -0.2, 0.02);
    for (const x of [0.63, 0.88, 1.04]) sphere(model, 0.15, "#78936c", x, 2.14, -0.2, 1, 0.8, 1);
    for (const x of [-1.25, 1.3]) {
      cylinder(model, 0.16, 0.19, 0.22, "#b89875", x, 0.29, 0.68);
      cylinder(model, 0.035, 0.045, 0.4, "#947653", x, 0.58, 0.68);
      sphere(model, 0.23, "#7f976e", x, 0.83, 0.68, 0.9, 1.3, 0.9);
    }
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
