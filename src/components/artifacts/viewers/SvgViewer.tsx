"use client";
import DOMPurify from "dompurify";
import { useEffect, useMemo, useState } from "react";

/** SVG 를 script·이벤트 핸들러를 지운 뒤 blob `<img>` 로 그린다(XSS 방지). */
export default function SvgViewer({ text }: { text: string }) {
  const clean = useMemo(
    () => DOMPurify.sanitize(text, { USE_PROFILES: { svg: true, svgFilters: true } }),
    [text],
  );
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([clean], { type: "image/svg+xml" }));
    // blob URL 은 외부(브라우저의 URL 레지스트리) 상태이고 여기서만 만들 수 있다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [clean]);
  return src ? <img src={src} alt="" className="max-h-full max-w-full object-contain" /> : null;
}
