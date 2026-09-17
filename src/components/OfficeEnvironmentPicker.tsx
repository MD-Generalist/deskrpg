"use client";

import Image from "next/image";
import thumbnails from "@/game/three/office-environment-thumbnails.json";
import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useLocale } from "@/lib/i18n";
import { OFFICE_ENVIRONMENTS, buildOfficeEnvironment } from "@/game/three/office-environments";

const Preview = dynamic(() => import("./ThreeMapPreview"), { ssr: false });

export default function OfficeEnvironmentPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { locale } = useLocale();
  const ko = locale === "ko";
  const selected =
    OFFICE_ENVIRONMENTS.find((environment) => environment.id === value) ?? OFFICE_ENVIRONMENTS[0];
  const map = useMemo(() => buildOfficeEnvironment(selected.id), [selected.id]);
  return (
    <section aria-label={ko ? "사무환경 선택" : "Choose your office"} className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {ko ? "어떤 오피스에서 일할까요?" : "Where will your team work?"}
        </h2>
        <span className="text-xs text-text-muted">
          {ko ? "완성형 공간 5종" : "5 ready-to-use offices"}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {OFFICE_ENVIRONMENTS.map((environment, index) => (
          <button
            key={environment.id}
            type="button"
            aria-pressed={environment.id === value}
            onClick={() => onChange(environment.id)}
            className={`text-left rounded-lg border p-3 transition-colors ${environment.id === value ? "border-accent bg-accent/10" : "border-border bg-surface hover:bg-surface-raised"}`}
          >
            <div className="mb-2 aspect-[874/450] w-full overflow-hidden rounded bg-background">
              <Image
                src={thumbnails[environment.id]}
                width={874}
                height={450}
                sizes="(max-width: 640px) 45vw, 260px"
                alt={
                  ko ? `${environment.nameKo} 실제 3D 장면` : `${environment.nameEn} rendered scene`
                }
                className="h-full w-full object-contain"
              />
            </div>
            <span className="block text-xs mb-2" style={{ color: environment.color }}>
              0{index + 1}
            </span>
            <span className="block font-semibold text-sm">
              {ko ? environment.nameKo : environment.nameEn}
            </span>
          </button>
        ))}
      </div>
      <div
        className="h-72 sm:h-96 overflow-hidden rounded-lg border border-border"
        aria-label={ko ? "선택한 사무환경 3D 미리보기" : "Selected office 3D preview"}
      >
        <Preview map={map} />
      </div>
      <p className="text-sm text-text-muted">
        {ko ? selected.descriptionKo : selected.descriptionEn}
      </p>
    </section>
  );
}
