import assert from "node:assert/strict";
import test from "node:test";

import { planGatewayDelete } from "@/app/gateways/gateway-delete-plan";
import { backLinkTarget } from "@/app/gateways/return-target";

/**
 * `?returnTo=` 는 사용자가 준 값이다. 게이트웨이 화면이 그걸 그대로 링크에 박으면
 * `//evil.com` 한 줄로 열린 리다이렉트가 된다. page.tsx 를 통째로 렌더하려면
 * next/navigation 라우터를 흉내 내야 해서, 그 한 줄을 `backLinkTarget` 으로 뽑고
 * 여기서 고정한다 — page.tsx 는 이 함수만 부른다.
 */
test("돌아가기 링크는 적대적인 returnTo 를 통과시키지 않는다", () => {
  assert.equal(backLinkTarget("//evil.com"), "/channels");
  assert.equal(backLinkTarget("/\\evil.com"), "/channels");
  assert.equal(backLinkTarget("https://evil.com/x"), "/channels");
  assert.equal(backLinkTarget("/channels/abc"), "/channels/abc");
  assert.equal(backLinkTarget(null), null, "돌아갈 곳이 없으면 링크를 띄우지 않는다");
});

/**
 * 게이트웨이 삭제는 채널 바인딩이 하나라도 있으면 서버가 409 로 거절한다
 * (`api/gateways/[id]/route.ts:126-138`). 그런데도 "함께 사라집니다" 를 물으면
 * 사용자는 일어나지 않을 삭제에 동의하고, 아무 일도 없는 화면을 본다.
 *
 * page.tsx 를 통째로 렌더하려면 app router 컨텍스트(useSearchParams/useRouter)를
 * 흉내 내야 해서, 그 분기를 `planGatewayDelete` 로 뽑고 여기서 고정한다 —
 * `handleDelete` 는 이 판정만 보고 확인·DELETE 를 건너뛴다.
 */
test("채널에 나가 있으면 삭제 확인을 아예 띄우지 않는다", () => {
  const plan = planGatewayDelete({ profiles: 1, npcs: 2, channels: 2 });
  assert.equal(
    plan.blocked,
    true,
    "채널에 묶인 게이트웨이인데 확인을 띄운다 — 서버는 409 로 거절하므로 거짓 확인이 된다",
  );
});

test("채널에 아무도 없으면 프로필·NPC 수치를 담아 확인한다", () => {
  const plan = planGatewayDelete({ profiles: 1, npcs: 3, channels: 0 });
  assert.equal(plan.blocked, false);
  assert.equal(plan.blocked === false && plan.npcs, 3);
});
