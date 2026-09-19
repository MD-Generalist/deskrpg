import Image from "next/image";

/**
 * 브랜드 마크 — 사이드바 아래 본사와 같은 three.js 모델을 구워 만든 3D 미니어처다.
 * 그림은 `npx tsx scripts/brand-mark/render.ts` 가 다시 굽는다(모델은 game/three/office-building.ts).
 * 화면에서 WebGL 을 한 번 더 켜지 않으려고 PNG 로 둔다 — 16px 파비콘까지 같은 그림에서 나온다.
 */
export default function DeskRpgMark({ size = 25 }: { size?: number }) {
  return (
    <Image
      src="/assets/brand/deskrpg-mark-3d-512.png"
      alt=""
      width={size}
      height={size}
      priority
      aria-hidden="true"
    />
  );
}
