"use client";

import { useEffect, useRef } from "react";
import * as T from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
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
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    container.append(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.OrthographicCamera(-24, 24, 16, -16, 0.1, 160);
    let quality: "light" | "desktop" =
      container.getBoundingClientRect().width < 600 ? "light" : "desktop";
    const city = createCommuteCity({ quality });
    scene.add(city.root);
    scene.add(new T.HemisphereLight("#e6f5ff", "#bcad86", 1.8));
    const sun = new T.DirectionalLight("#ffe6b0", 2.8);
    sun.position.set(-16, 25, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(quality === "light" ? 1024 : 2048);
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
    let environment: T.WebGLRenderTarget | undefined;
    function rebuildEnvironment() {
      environment?.dispose();
      const generator = new T.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      environment = generator.fromScene(room, 0.04);
      scene.environment = environment.texture;
      scene.environmentIntensity = 0.45;
      room.dispose();
      generator.dispose();
    }
    rebuildEnvironment();

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
      }
      draw();
      if (!reducedMotion.matches) frame = requestAnimationFrame(tick);
    }
    function refresh() {
      cancelAnimationFrame(frame);
      lastTime = 0;
      if (disposed || contextLost || document.hidden || !visible) return;
      frame = requestAnimationFrame(tick);
    }
    const resize = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      const nextQuality = width < 600 ? "light" : "desktop";
      if (nextQuality !== quality) {
        quality = nextQuality;
        city.setQuality(quality);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
        sun.shadow.mapSize.setScalar(quality === "light" ? 1024 : 2048);
      }
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
      if (disposed) return;
      contextLost = false;
      rebuildEnvironment();
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
      scene.environment = null;
      environment?.dispose();
      sun.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      delete container.dataset.ready;
    };
  }, []);
  return <div ref={host} className="commute-canvas" aria-hidden="true" />;
}
