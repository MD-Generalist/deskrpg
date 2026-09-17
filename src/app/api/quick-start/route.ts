import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";

import {
  channelGatewayBindings,
  channelMembers,
  channels,
  characters,
  db,
  groupMembers,
  groups,
  npcs,
  users,
} from "@/db";
import { getUserId } from "@/lib/internal-rpc";
import {
  assignSeats,
  freeSeatTiles,
  QUICK_START_APPEARANCE,
  QUICK_START_ENVIRONMENT_ID,
  quickStartChannelName,
  quickStartCharacterName,
  quickStartSeatTiles,
} from "@/lib/quick-start";

/**
 * `POST /api/quick-start` — 가입 직후의 여섯 화면(캐릭터 → 채널 → 배치 → …)을 한 번에 접는다.
 *
 * **아무 도메인 규칙도 새로 만들지 않는다.** 캐릭터는 `/api/characters` 의 `POST`,
 * 채널은 `/api/channels` 의 `POST`(그 안에서 `ensureOfficeRoom` 이 채널당 office 방
 * 하나를 보장한다), 자리 배치는 `/api/npcs/:id` 의 `PATCH` 를 **그대로 호출**한다.
 * 여기서 테이블을 직접 쓰는 곳은 한 군데도 없다 — 읽기만 한다.
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

async function ensureCharacter(req: NextRequest, userId: string, nickname: string | null) {
  const [existing] = await db
    .select({ id: characters.id })
    .from(characters)
    .where(eq(characters.userId, userId))
    .orderBy(asc(characters.createdAt))
    .limit(1);
  if (existing) return existing.id;

  const { POST } = await import("../characters/route");
  const payload = await expectOk(
    await POST(
      subRequest(req, "/api/characters", {
        name: quickStartCharacterName(nickname),
        appearance: QUICK_START_APPEARANCE,
      }),
    ),
  );
  const created = payload.character as { id?: string } | undefined;
  if (!created?.id) {
    throw new QuickStartFailure(
      NextResponse.json(
        { errorCode: "failed_to_create_character", error: "Failed to create character" },
        { status: 500 },
      ),
    );
  }
  return created.id;
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
 * 게이트웨이가 묶여 있고 출근했는데 자리가 없는 NPC 를 빈 좌석에 앉힌다.
 *
 * 게이트웨이가 없으면 조용히 끝난다 — 빠른 시작의 목적은 "일단 들어가 보는 것" 이다.
 * 배치 실패(예: 같은 칸 경합 409)도 빠른 시작을 깨뜨리지 않는다.
 */
async function seatUnplacedNpcs(req: NextRequest, channelId: string) {
  const [binding] = await db
    .select({ gatewayId: channelGatewayBindings.gatewayId })
    .from(channelGatewayBindings)
    .where(eq(channelGatewayBindings.channelId, channelId))
    .limit(1);
  if (!binding) return 0;

  const [channel] = await db
    .select({ mapData: channels.mapData })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  if (!channel) return 0;

  const roster = await db
    .select({
      id: npcs.id,
      active: npcs.active,
      positionX: npcs.positionX,
      positionY: npcs.positionY,
    })
    .from(npcs)
    .where(eq(npcs.channelId, channelId))
    .orderBy(asc(npcs.id));

  const unplaced = roster.filter(
    (npc) => npc.active && !(Number.isInteger(npc.positionX) && Number.isInteger(npc.positionY)),
  );
  if (unplaced.length === 0) return 0;

  const free = freeSeatTiles(quickStartSeatTiles(channel.mapData), roster);
  const plan = assignSeats(unplaced, free);
  if (plan.length === 0) return 0;

  const { PATCH } = await import("../npcs/[id]/route");
  let seated = 0;
  for (const { npcId, seat } of plan) {
    const response = await PATCH(
      subRequest(req, `/api/npcs/${encodeURIComponent(npcId)}`, {
        positionX: seat.col,
        positionY: seat.row,
      }),
      { params: Promise.resolve({ id: npcId }) },
    );
    if (response.ok) seated += 1;
  }
  return seated;
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

    const characterId = await ensureCharacter(req, userId, user.nickname);
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
        await seatUnplacedNpcs(req, channelId);
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
