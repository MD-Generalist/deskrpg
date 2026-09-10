"use client";

import { useState } from "react";
import { useT, useLocale } from "@/lib/i18n";
import type { OfficePreset } from "@/game/three/office-presets";
import Modal from "@/components/ui/Modal";

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    name: string,
    cols: number,
    rows: number,
    tileWidth: number,
    tileHeight: number,
    preset?: OfficePreset,
  ) => void;
}

const TEMPLATES = [
  { label: "Small", cols: 20, rows: 15, desc: "640×480 px" },
  { label: "Medium", cols: 30, rows: 22, desc: "960×704 px" },
  { label: "Large", cols: 40, rows: 30, desc: "1280×960 px" },
];

export default function NewProjectModal({ open, onClose, onSubmit }: NewProjectModalProps) {
  const t = useT();
  const { locale } = useLocale();
  const [preset, setPreset] = useState<OfficePreset>("blank");
  const [name, setName] = useState("");
  const [cols, setCols] = useState(20);
  const [rows, setRows] = useState(15);
  const [tileSize, setTileSize] = useState(32);

  const handleCreate = () => {
    if (!name.trim()) return;
    onSubmit(
      name.trim(),
      preset === "blank" ? cols : Math.max(cols, 20),
      preset === "blank" ? rows : Math.max(rows, 15),
      preset === "blank" ? tileSize : 32,
      preset === "blank" ? tileSize : 32,
      preset,
    );
    setName("");
    setCols(preset === "trading" ? 30 : 20);
    setRows(preset === "trading" ? 22 : 15);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t("mapEditor.project.newProject")}>
      <div className="space-y-4 p-4">
        {/* Project Name */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            {t("mapEditor.project.projectName")}
          </label>
          <input
            className="w-full px-3 py-2 bg-surface border border-border rounded text-text text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("mapEditor.newMap.namePlaceholder")}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>

        <div>
          <label
            htmlFor="office-preset"
            className="block text-sm font-medium text-text-secondary mb-1"
          >
            {locale === "ko" ? "공간 구성" : "Space layout"}
          </label>
          <select
            id="office-preset"
            value={preset}
            onChange={(e) => {
              const nextPreset = e.target.value as OfficePreset;
              setPreset(nextPreset);
              if (nextPreset === "trading") {
                setCols(30);
                setRows(22);
              }
            }}
            className="w-full rounded border border-border bg-surface p-2 text-sm text-text"
          >
            <option value="blank">{locale === "ko" ? "빈 맵" : "Empty map"}</option>
            <option value="trading">
              {locale === "ko" ? "무역회사 오피스" : "Trading company office"}
            </option>
            <option value="garden">{locale === "ko" ? "정원 오피스" : "Garden office"}</option>
            <option value="courtyard">
              {locale === "ko" ? "중정 작업실" : "Courtyard studio"}
            </option>
            <option value="cafe">{locale === "ko" ? "협업 카페" : "Collaboration café"}</option>
          </select>
          {preset !== "blank" && (
            <p className="mt-1 text-caption text-text-muted">
              {locale === "ko"
                ? "가구가 배치된 3D 공간입니다. 최소 20×15, 타일 32px로 생성합니다."
                : "Furnished 3D space. Created with at least 20×15 tiles at 32px."}
            </p>
          )}
        </div>
        {/* Template Selection */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            {t("mapEditor.project.mapSize")}
          </label>
          <div className="flex gap-2">
            {TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.label}
                className={`flex-1 px-3 py-2 rounded text-xs border ${
                  cols === tmpl.cols && rows === tmpl.rows
                    ? "border-blue-500 bg-blue-500/20 text-blue-700"
                    : "border-border bg-surface text-text-muted hover:border-gray-500"
                }`}
                onClick={() => {
                  setCols(tmpl.cols);
                  setRows(tmpl.rows);
                }}
              >
                <div className="font-medium">{tmpl.label}</div>
                <div className="text-text-dim">{tmpl.desc}</div>
              </button>
            ))}
          </div>
          <div className="flex gap-4 mt-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">{t("mapEditor.newMap.width")}:</span>
              <input
                type="number"
                className="w-16 px-2 py-1 bg-surface border border-border rounded text-text text-xs"
                value={cols}
                onChange={(e) => setCols(Math.max(1, parseInt(e.target.value) || 1))}
                min={1}
                max={200}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">{t("mapEditor.newMap.height")}:</span>
              <input
                type="number"
                className="w-16 px-2 py-1 bg-surface border border-border rounded text-text text-xs"
                value={rows}
                onChange={(e) => setRows(Math.max(1, parseInt(e.target.value) || 1))}
                min={1}
                max={200}
              />
            </div>
          </div>
        </div>

        {/* Tile Size */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            {t("mapEditor.project.tileSize")}
          </label>
          <div className="flex gap-2">
            {[16, 32, 48, 64].map((size) => (
              <button
                key={size}
                className={`px-3 py-1 rounded text-xs border ${
                  tileSize === size
                    ? "border-blue-500 bg-blue-500/20 text-blue-700"
                    : "border-border bg-surface text-text-muted hover:border-gray-500"
                }`}
                onClick={() => setTileSize(size)}
              >
                {size}×{size}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button className="px-4 py-2 text-sm text-text-muted hover:text-text" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50"
            onClick={handleCreate}
            disabled={!name.trim()}
          >
            {t("mapEditor.project.createProject")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
