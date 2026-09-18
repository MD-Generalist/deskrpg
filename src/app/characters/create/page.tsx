import { redirect } from "next/navigation";

/**
 * "내 캐릭터" 는 사용자당 하나라 별도의 생성 화면이 없다(스펙 2026-09-18).
 * `/characters` 가 등록/수정을 겸하는 단일 폼이므로 여기로 리다이렉트만 한다.
 */
export default async function CharacterCreatePage({
  searchParams,
}: {
  searchParams: Promise<{ joinChannel?: string }>;
}) {
  const { joinChannel } = await searchParams;
  redirect(
    joinChannel ? `/characters?joinChannel=${encodeURIComponent(joinChannel)}` : "/characters",
  );
}
