"use client";
import { useEffect, useState } from "react";
import * as T from "three";
import { OFFICE_LOOKS, LOOK_CATEGORIES, type OfficeLook } from "@/game/three/office-looks";
import { createActor, cylinder } from "@/game/three/characters";
import { disposeTree } from "@/game/three/office-renderer";
import { useLocale } from "@/lib/i18n";

let cachedThumbnails: Record<string, string> | undefined;
/** One temporary GPU context for the entire catalog, released after capture. */
function thumbnails() {
  if (cachedThumbnails) return cachedThumbnails;
  const renderer = new T.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(240, 280);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  const result: Record<string, string> = {};
  try {
    for (const [i, look] of OFFICE_LOOKS.entries()) {
      const scene = new T.Scene();
      try {
        const camera = new T.PerspectiveCamera(30, 240 / 280, 0.1, 20);
        camera.position.set(1.5, 1.8, 4.2);
        camera.lookAt(0, 0.97, 0);
        scene.add(new T.HemisphereLight("#fff8ed", "#89988b", 2.5));
        const light = new T.DirectionalLight("#fff1dc", 3);
        light.position.set(-2, 4, 4);
        scene.add(light);
        cylinder(scene, 0.46, 0.5, 0.06, "#d9cbb6", 0, 0.015, 0);
        const actor = createActor(look.id, look.coat, i, undefined, look);
        scene.add(actor.root);
        actor.update(0, false, "idle", false);
        renderer.render(scene, camera);
        result[look.id] = renderer.domElement.toDataURL("image/png");
      } finally {
        disposeTree(scene);
      }
    }
    cachedThumbnails = result;
    return result;
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

export default function OfficeLookGallery({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect: (look: OfficeLook) => void;
}) {
  const { locale } = useLocale(),
    ko = locale === "ko";
  const [images, setImages] = useState<Record<string, string>>({});
  const [category, setCategory] = useState("all"),
    [query, setQuery] = useState("");
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        setImages(thumbnails());
      } catch {
        /* Text cards stay usable without WebGL. */
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const filtered = OFFICE_LOOKS.filter(
    (l) =>
      (category === "all" || l.category === category) &&
      `${l.name} ${l.nameEn} ${l.subtitle} ${l.subtitleEn}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  );
  return (
    <section
      className="lookbook-catalog"
      aria-label={ko ? "오피스 캐릭터 컬렉션" : "Office character collection"}
    >
      <div className="lookbook-eyebrow">THE OFFICE COLLECTION · VOL. 01</div>
      <h1>{ko ? "함께 일하고 싶은 얼굴들" : "Meet your office cast"}</h1>
      <p className="lookbook-intro">
        {ko
          ? "각자의 취향, 각자의 이야기. 당신의 오피스에 어울리는 한 사람을 골라보세요."
          : "Distinct styles, individual stories. Choose someone for your office."}
      </p>
      <div className="lookbook-toolbar">
        <input
          type="search"
          aria-label={ko ? "캐릭터 검색" : "Search characters"}
          placeholder={ko ? "이름이나 스타일 검색" : "Search name or style"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span>
          {filtered.length} / {OFFICE_LOOKS.length}
        </span>
      </div>
      <div className="lookbook-filters" aria-label={ko ? "스타일 필터" : "Style filters"}>
        {LOOK_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={category === c.id}
            onClick={() => setCategory(c.id)}
          >
            {ko ? c.ko : c.en}
          </button>
        ))}
      </div>
      <div className="lookbook-grid">
        {filtered.map((l) => (
          <button
            type="button"
            className="lookbook-card"
            key={l.id}
            aria-pressed={selectedId === l.id}
            onClick={() => onSelect(l)}
          >
            <div className="lookbook-card-image" style={{ backgroundColor: `${l.coat}10` }}>
              {images[l.id] ? (
                <img src={images[l.id]} alt="" width={240} height={280} />
              ) : (
                <span className="lookbook-placeholder">{ko ? l.name : l.nameEn}</span>
              )}
              <span className="lookbook-number">
                {String(OFFICE_LOOKS.indexOf(l) + 1).padStart(2, "0")}
              </span>
              {selectedId === l.id && (
                <span className="lookbook-selected">{ko ? "선택됨" : "Selected"}</span>
              )}
            </div>
            <div className="lookbook-card-caption">
              <strong>{ko ? l.name : l.nameEn}</strong>
              <span>{ko ? l.subtitle.split(" · ")[1] : l.subtitleEn.split(" · ")[1]}</span>
            </div>
          </button>
        ))}
      </div>
      {!filtered.length && (
        <p className="lookbook-empty">
          {ko
            ? "일치하는 캐릭터가 없습니다. 다른 이름이나 스타일로 검색해보세요."
            : "No matching characters. Try another name or style."}
        </p>
      )}
    </section>
  );
}
