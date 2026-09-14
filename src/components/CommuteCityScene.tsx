"use client";

import { useEffect, useRef } from "react";
import * as T from "three";
import { createCommuteCity } from "@/game/three/commute-city";

export default function CommuteCityScene() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // The sky and the independent HTML form remain usable without WebGL.
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    container.append(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.OrthographicCamera(-24, 24, 16, -16, 0.1, 160);
    const city = createCommuteCity();
    scene.add(city.root);
    scene.add(new T.HemisphereLight("#e6f5ff", "#bcad86", 2.5));
    const sun = new T.DirectionalLight("#ffe6b0", 3.5);
    sun.position.set(-16, 25, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -30,
      right: 30,
      top: 25,
      bottom: -25,
      near: 1,
      far: 85,
    });
    sun.shadow.normalBias = 0.04;
    scene.add(sun);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = new T.Vector2();
    const smoothed = new T.Vector2();
    let frame = 0,
      lastTime = 0,
      elapsed = 0,
      disposed = false,
      contextLost = false,
      visible = true;
    function draw() {
      camera.position.set(23 + smoothed.x * 3, 19 - smoothed.y * 2, 30 - smoothed.x * 1.5);
      camera.lookAt(0, 3.2, 0);
      camera.updateMatrixWorld();
      city.update(elapsed, !reducedMotion.matches);
      renderer.render(scene, camera);
      container!.dataset.ready = "true";
    }
    function tick(now: number) {
      frame = 0;
      if (disposed || contextLost || document.hidden || !visible) return;
      const delta = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
      lastTime = now;
      if (!reducedMotion.matches) {
        elapsed += delta;
        smoothed.lerp(pointer, 1 - Math.exp(-4 * delta));
      } else smoothed.set(0, 0);
      draw();
      if (!reducedMotion.matches) frame = requestAnimationFrame(tick);
    }
    function refresh() {
      cancelAnimationFrame(frame);
      lastTime = 0;
      frame = requestAnimationFrame(tick);
    }
    const resize = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      const halfWidth = Math.max(width < 600 ? 20 : 24, (11.5 * width) / height);
      camera.left = -halfWidth;
      camera.right = halfWidth;
      camera.top = (halfWidth * height) / width;
      camera.bottom = -camera.top;
      camera.updateProjectionMatrix();
      refresh();
    });
    resize.observe(container);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      refresh();
    });
    intersection.observe(container);
    const move = (event: PointerEvent) => {
      if (reducedMotion.matches || event.pointerType === "touch") return;
      pointer.set(
        T.MathUtils.clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1),
        T.MathUtils.clamp((event.clientY / window.innerHeight) * 2 - 1, -1, 1),
      );
    };
    const reset = () => pointer.set(0, 0);
    const lost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      cancelAnimationFrame(frame);
      delete container.dataset.ready;
    };
    const restored = () => {
      contextLost = false;
      refresh();
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", reset);
    document.addEventListener("visibilitychange", refresh);
    reducedMotion.addEventListener("change", refresh);
    renderer.domElement.addEventListener("webglcontextlost", lost);
    renderer.domElement.addEventListener("webglcontextrestored", restored);
    void city.ready.then(() => {
      if (!disposed) refresh();
    });
    refresh();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", reset);
      document.removeEventListener("visibilitychange", refresh);
      reducedMotion.removeEventListener("change", refresh);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.domElement.removeEventListener("webglcontextrestored", restored);
      city.dispose();
      const geometries = new Set<T.BufferGeometry>();
      const materials = new Set<T.Material>();
      const textures = new Set<T.Texture>();
      scene.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material))
            if (value instanceof T.Texture) textures.add(value);
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      sun.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      delete container.dataset.ready;
    };
  }, []);
  return <div ref={host} className="commute-canvas" aria-hidden="true" />;
}
