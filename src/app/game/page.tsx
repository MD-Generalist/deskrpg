import type { Metadata } from "next";

import GameWebglGate from "./GameWebglGate";
import { resolveGamePageMetadataTitle } from "./metadata";

type GamePageProps = {
  searchParams: Promise<{
    channelId?: string;
  }>;
};

export async function generateMetadata({ searchParams }: GamePageProps): Promise<Metadata> {
  const { channelId } = await searchParams;

  return {
    title: {
      absolute: await resolveGamePageMetadataTitle(channelId),
    },
  };
}

export default function GamePage() {
  // 채널 화면은 관문을 통과한 뒤에만 마운트된다 — 이 파일은 서버 컴포넌트로 남아야
  // `generateMetadata` 가 산다. 검사는 그 아래 `"use client"` 관문이 한다.
  return <GameWebglGate />;
}
