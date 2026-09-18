import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";

import { channelMembers, channels, db, groupMembers, groups, users } from "@/db";
import { getUserId } from "@/lib/internal-rpc";
import { ensureMyCharacter } from "@/lib/my-character";
import { QUICK_START_ENVIRONMENT_ID, quickStartChannelName } from "@/lib/quick-start";

/**
 * `POST /api/quick-start` — 가입 직후의 여섯 화면(캐릭터 → 채널 → 배치 → …)을 한 번에 접는다.
 *
 * **아무 도메인 규칙도 새로 만들지 않는다.** 캐릭터는 `ensureMyCharacter`("나" 규칙의 한 곳),
 * 채널은 `/api/channels` 의 `POST`(그 안에서 `ensureOfficeRoom` 이 채널당 office 방
 * 하나를 보장한다), 자리 배치는 `/api/npcs/:id` 의 `PATCH` 를 **그대로 호출**한다.
 * 캐릭터 외에 여기서 테이블을 직접 쓰는 곳은 없다 — 읽기만 한다.
 *
 * 멱등이다: 이미 캐릭터·채널이 있으면 만들지 않고 그것을 돌려준다.
 * 게이트웨이가 없어도 실패하지 않는다(3단계만 건너뛴다).
 * 응답에는 식별자 둘뿐이고 토큰·비밀은 실리지 않는다.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

class QuickStartFailure extends Error {
  constructor(readonly response: NextResponse) {
    super("quick start step failed");
  }
}

function authHeaders(req: NextRequest): Headers {
  // 하위 라우트도 `x-user-id` 하나만 본다(프록시가 넣어 준 값 그대로 넘긴다).
  const headers = new Headers(JSON_HEADERS);
  const userId = req.headers.get("x-user-id");
  if (userId) headers.set("x-user-id", userId);
  return headers;
}

function subRequest(req: NextRequest, path: string, body: unknown, method = "POST"): NextRequest {
  const bodyless = method === "GET" || method === "HEAD";
  return new NextRequest(new URL(path, req.nextUrl.origin), {
    method,
    headers: authHeaders(req),
    ...(bodyless ? {} : { body: JSON.stringify(body) }),
  });
}

async function expectOk(response: Response): Promise<Record<string, unknown>> {
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new QuickStartFailure(NextResponse.json(payload, { status: response.status }));
  }
  return payload;
}

/** 채널을 만들 그룹. 사용자의 소속 중 관리 권한이 있는 쪽을 먼저 본다 — 권한 판정 자체는 채널 라우트가 한다. */
async function resolveGroupId(userId: string): Promise<string | null> {
  const memberships = await db
    .select({ groupId: groupMembers.groupId, role: groupMembers.role, isDefault: groups.isDefault })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, userId));

  const ranked = [...memberships].sort(
    (a, b) =>
      Number(b.role === "group_admin") - Number(a.role === "group_admin") ||
      Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)),
  );
  if (ranked[0]) return ranked[0].groupId;

  const [fallback] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.isDefault, true))
    .limit(1);
  return fallback?.id ?? null;
}

async function ensureChannel(req: NextRequest, userId: string, nickname: string | null) {
  const [owned] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.ownerId, userId))
    .orderBy(asc(channels.createdAt))
    .limit(1);
  if (owned) return owned.id;

  const [joined] = await db
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
    .where(eq(channelMembers.userId, userId))
    .orderBy(asc(channels.createdAt))
    .limit(1);
  if (joined) return joined.id;

  const groupId = await resolveGroupId(userId);
  if (!groupId) {
    throw new QuickStartFailure(
      NextResponse.json(
        { errorCode: "channel_creation_forbidden", error: "channel creation forbidden" },
        { status: 403 },
      ),
    );
  }

  // 환경 배치는 채널 라우트가 코드에서 직접 만든다 — 템플릿 표를 거치지 않는다.
  const { POST } = await import("../channels/route");
  const payload = await expectOk(
    await POST(
      subRequest(req, "/api/channels", {
        name: quickStartChannelName(nickname),
        isPublic: true,
        groupId,
        environmentId: QUICK_START_ENVIRONMENT_ID,
      }),
    ),
  );
  const created = payload.channel as { id?: string } | undefined;
  if (!created?.id) {
    throw new QuickStartFailure(
      NextResponse.json(
        { errorCode: "failed_to_create_channel", error: "Failed to create channel" },
        { status: 500 },
      ),
    );
  }
  return created.id;
}

/**
 * 출근했는데 자리가 없는 NPC 를 배치한다. 고용 경로가 이미 배치하므로 보통은 할 일이
 * 없다 — 이 기능 이전에 만들어진 채널을 빠른 시작으로 다시 여는 경우를 위한 안전망이다.
 */
async function seatUnplacedNpcs(channelId: string) {
  const { placeUnplacedNpcs } = await import("@/lib/npc-seating");
  const { seated, standing } = await placeUnplacedNpcs(channelId);
  return seated + standing;
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized", error: "unauthorized" }, { status: 401 });
  }

  try {
    const [user] = await db
      .select({ nickname: users.nickname })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) {
      return NextResponse.json(
        { errorCode: "unauthorized", error: "unauthorized" },
        { status: 401 },
      );
    }

    const mine = await ensureMyCharacter(userId, user.nickname);
    const characterId = mine.id;
    const channelId = await ensureChannel(req, userId, user.nickname);

    // 채널 소유자만 NPC 자리를 바꿀 수 있다(배치 라우트의 규칙). 남의 채널에 들어가는
    // 경우에는 앉히지 않는다 — 그 규칙을 우회하지 않는다.
    const [owned] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.id, channelId), eq(channels.ownerId, userId)))
      .limit(1);
    if (owned) {
      try {
        await seatUnplacedNpcs(channelId);
      } catch (seatErr) {
        console.warn("Quick start could not seat NPCs:", seatErr);
      }
    }

    return NextResponse.json({ channelId, characterId });
  } catch (err) {
    if (err instanceof QuickStartFailure) return err.response;
    console.error("Quick start failed:", err);
    return NextResponse.json(
      { errorCode: "internal_server_error", error: "Quick start failed" },
      { status: 500 },
    );
  }
}
