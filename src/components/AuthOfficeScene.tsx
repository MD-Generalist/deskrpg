"use client";

import { useEffect, useRef } from "react";
import * as T from "three";
import { round, sphere, cylinder } from "@/game/three/characters";
import { disposeTree } from "@/game/three/office-renderer";

/** Decorative welcome scene; the login form remains independent of WebGL. */
export default function AuthOfficeScene() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const desktop = window.matchMedia("(min-width: 761px)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let cleanup: (() => void) | undefined;

    function mount() {
      const container = element!;
      let renderer: T.WebGLRenderer;
      try {
        renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        return;
      } // The existing illustration is the capability/loading fallback.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.setClearColor(0x000000, 0);
      container.append(renderer.domElement);
      const scene = new T.Scene();
      const camera = new T.OrthographicCamera(-4, 4, 3.4, -3.4, 0.1, 60);
      const office = new T.Group();
      scene.add(office);
      const wood = "#c5a174",
        paper = "#f2ebd8",
        sage = "#769274",
        ink = "#3e594a";
      round(office, 5.8, 0.3, 4.6, wood, 0, -0.2, 0, 0.16);
      round(office, 5.7, 0.12, 4.5, "#e9dcc0", 0, 0, 0, 0.1);
      for (let x = -2.4; x < 2.8; x += 0.6)
        round(office, 0.014, 0.008, 4.25, "#d4c3a2", x, 0.065, 0, 0.002);
      // The back wall is built around an actual window opening.
      round(office, 1.3, 3.2, 0.2, paper, -2.15, 1.6, -2.15);
      round(office, 2.5, 3.2, 0.2, paper, 1.55, 1.6, -2.15);
      round(office, 1.8, 0.8, 0.2, paper, -0.6, 0.4, -2.15);
      round(office, 1.8, 0.65, 0.2, paper, -0.6, 2.875, -2.15);
      round(office, 0.18, 2.15, 4.3, "#e1e6d3", -2.8, 1.075, 0);
      round(office, 0.24, 0.12, 4.4, "#d2bc96", -2.8, 2.18, 0);
      const windowPane = round(office, 1.65, 1.65, 0.045, "#c5dccb", -0.6, 1.68, -2.18, 0.03);
      (windowPane.material as T.Material).dispose();
      windowPane.material = new T.MeshStandardMaterial({
        color: "#c5dccb",
        emissive: "#e8f2d6",
        emissiveIntensity: 0.22,
        roughness: 1,
      });
      // Dispose the replaced material immediately; geometry helpers create one per mesh.
      for (const x of [-1.49, 0.29]) round(office, 0.1, 1.85, 0.16, wood, x, 1.68, -2.02, 0.02);
      for (const y of [0.8, 2.56]) round(office, 1.87, 0.1, 0.16, wood, -0.6, y, -2.02, 0.02);
      round(office, 0.06, 1.72, 0.13, wood, -0.6, 1.68, -2, 0.01);
      round(office, 1.8, 0.06, 0.13, wood, -0.6, 1.65, -2, 0.01);
      round(office, 2, 0.09, 0.36, "#dec8a3", -0.6, 0.76, -1.95, 0.025);
      // Desk, monitor, notebook and a small cup.
      round(office, 2.9, 0.18, 1.1, wood, -0.2, 1.1, -0.75, 0.09);
      for (const x of [-1.45, 1.05])
        for (const z of [-1.15, -0.35])
          round(office, 0.12, 1.05, 0.12, "#a48059", x, 0.54, z, 0.025);
      round(office, 0.14, 0.35, 0.12, ink, -0.3, 1.38, -0.95, 0.025);
      round(office, 0.68, 0.055, 0.4, ink, -0.3, 1.22, -0.9, 0.025);
      round(office, 1.12, 0.72, 0.1, ink, -0.3, 1.79, -0.95, 0.06);
      round(office, 1, 0.6, 0.025, "#c7ddc5", -0.3, 1.79, -0.884, 0.035);
      for (let i = 0; i < 3; i++)
        round(office, 0.48 - i * 0.08, 0.027, 0.01, "#83a187", -0.43, 1.9 - i * 0.1, -0.865, 0.006);
      round(office, 0.74, 0.045, 0.25, "#eceade", -0.3, 1.23, -0.37, 0.025);
      round(office, 0.47, 0.06, 0.56, "#78957d", 0.77, 1.23, -0.73, 0.035);
      round(office, 0.41, 0.025, 0.48, "#f7eedb", 0.77, 1.269, -0.73, 0.02);
      cylinder(office, 0.115, 0.1, 0.23, "#f4eee0", -1.19, 1.32, -0.63);
      // Upholstered swivel chair on a muted green rug.
      round(office, 2.45, 0.035, 1.9, "#a8baa0", -0.25, 0.1, 0.75, 0.18);
      const chair = new T.Group();
      chair.position.set(-0.3, 0, 0.64);
      chair.rotation.y = -0.16;
      office.add(chair);
      cylinder(chair, 0.075, 0.09, 0.53, ink, 0, 0.39, 0);
      for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const leg = round(chair, 0.1, 0.09, 0.82, ink, 0, 0.15, 0, 0.035);
        leg.rotation.y = angle;
      }
      round(chair, 0.95, 0.2, 0.85, sage, 0, 0.72, 0, 0.12);
      round(chair, 0.96, 0.89, 0.19, sage, 0, 1.13, 0.39, 0.12);
      for (const x of [-0.53, 0.53]) {
        round(chair, 0.075, 0.4, 0.075, ink, x, 0.95, 0.06, 0.025);
        round(chair, 0.16, 0.11, 0.63, "#92aa88", x, 1.13, 0.03, 0.05);
      }
      // A tall plant and low bookshelf bring depth to the two side corners.
      cylinder(office, 0.35, 0.24, 0.6, "#c6a480", 2, 0.35, -1.1);
      cylinder(office, 0.045, 0.065, 1.2, "#8c7959", 2, 1.06, -1.1);
      const leaves = new T.Group();
      leaves.position.set(2, 1.35, -1.1);
      office.add(leaves);
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4;
        const leaf = sphere(
          leaves,
          0.32,
          i % 2 ? sage : "#90a67e",
          Math.cos(a) * 0.28,
          i * 0.095,
          Math.sin(a) * 0.24,
          0.65,
          1.35,
          0.85,
        );
        leaf.rotation.z = Math.cos(a) * 0.5;
      }
      round(office, 0.8, 0.75, 1.35, wood, -2.16, 0.45, 0.53);
      for (let i = 0; i < 5; i++)
        round(
          office,
          0.48,
          0.46,
          0.13,
          [sage, "#e2bf8c", "#f0e4ca"][i % 3],
          -2.12,
          0.45,
          0.06 + i * 0.2,
          0.015,
        );
      round(office, 0.85, 0.07, 1.4, "#dbc49e", -2.16, 0.85, 0.53);
      cylinder(office, 0.16, 0.12, 0.24, "#f1e4cb", -2.16, 1.01, 0.65);
      sphere(office, 0.22, sage, -2.16, 1.28, 0.65, 0.9, 1.2, 0.9);
      scene.add(new T.HemisphereLight("#fff7e4", "#9cad92", 2.4));
      const sun = new T.DirectionalLight("#fff2d2", 3.3);
      sun.position.set(-3, 8, 6);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.normalBias = 0.035;
      Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, far: 30 });
      scene.add(sun);
      let frame = 0,
        visible = true,
        targetX = 0,
        targetY = 0,
        currentX = 0,
        currentY = 0;
      const resize = () => {
        const { width, height } = container.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setSize(width, height);
        const halfHeight = Math.max(3.25, 3.8 / (width / height));
        camera.left = (-halfHeight * width) / height;
        camera.right = (halfHeight * width) / height;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      resize();
      const intersection = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
      });
      intersection.observe(container);
      const move = (e: PointerEvent) => {
        if (reducedMotion.matches || e.pointerType === "touch") return;
        const r = container.getBoundingClientRect();
        targetX = (e.clientX - r.left) / r.width - 0.5;
        targetY = (e.clientY - r.top) / r.height - 0.5;
      };
      const reset = () => {
        targetX = 0;
        targetY = 0;
      };
      container.addEventListener("pointermove", move);
      container.addEventListener("pointerleave", reset);
      const render = (time: number) => {
        frame = requestAnimationFrame(render);
        if (document.hidden || !visible) return;
        currentX += (targetX - currentX) * 0.055;
        currentY += (targetY - currentY) * 0.055;
        camera.position.set(
          7 + (reducedMotion.matches ? 0 : currentX * 0.9),
          5.8 + (reducedMotion.matches ? 0 : currentY * 0.5),
          8,
        );
        camera.lookAt(0, 1.15, 0);
        leaves.rotation.z = reducedMotion.matches ? 0 : Math.sin(time * 0.00065) * 0.018;
        renderer.render(scene, camera);
        container.dataset.ready = "true";
      };
      render(0);
      const contextLost = (e: Event) => {
        e.preventDefault();
        delete container.dataset.ready;
        cancelAnimationFrame(frame);
      };
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        intersection.disconnect();
        container.removeEventListener("pointermove", move);
        container.removeEventListener("pointerleave", reset);
        renderer.domElement.removeEventListener("webglcontextlost", contextLost);
        disposeTree(scene);
        renderer.dispose();
        renderer.domElement.remove();
        delete container.dataset.ready;
      };
    }
    const sync = () => {
      cleanup?.();
      cleanup = desktop.matches ? mount() : undefined;
    };
    sync();
    desktop.addEventListener("change", sync);
    return () => {
      desktop.removeEventListener("change", sync);
      cleanup?.();
    };
  }, []);
  return <div ref={host} className="auth-office-canvas" />;
}
