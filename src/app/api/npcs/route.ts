import { NextRequest, NextResponse } from "next/server";
import { db, jsonForDb } from "@/db";
import { npcs, channels } from "@/db";
import { eq, count } from "drizzle-orm";
import { getUserId } from "@/lib/internal-rpc";
import {
  buildPersonaConfig,
  getDefaultMeetingProtocol,
  getNpcPresetDefaults,
  hasNpcPresetDefaults,
  localizeNpcPromptDocument,
} from "@/lib/npc-agent-defaults";
import { normalizeLocale } from "@/lib/i18n/server";
import { getGatewayRuntimeStateForChannel } from "@/lib/gateway-resources";
import { parseDbJson, parseDbObject } from "@/lib/db-json";
import { selectChannelNpcs, selectNpcById } from "@/lib/npc-projection";

export async function GET(req: NextRequest) {
  try {
    const channelId = req.nextUrl.searchParams.get("channelId");
    // roster=1 은 "고용 명부" — 아직 자리를 못 잡았거나 퇴근한 NPC 까지 준다.
    // 기본 응답(맵용)은 예전 그대로 배치·출근한 것만 낸다.
    const roster = req.nextUrl.searchParams.get("roster") === "1";
    if (!channelId) {
      // 예전에는 channelId 가 없으면 전 채널의 NPC 를 통째로 돌려줬다. 호출부가
      // 하나도 없는 경로였고, 채널 경계를 넘어 새는 응답이었다.
      return NextResponse.json(
        { errorCode: "channel_id_required", error: "channelId required" },
        { status: 400 },
      );
    }

    const gatewayState = await getGatewayRuntimeStateForChannel(channelId, {
      forceRefresh: true,
    });
    if (gatewayState.status !== "valid") {
      return NextResponse.json({ npcs: [] });
    }

    const list = await selectChannelNpcs(channelId, { roster });
    const result = list.map((npc) => {
      const agentConfig = (npc.agentConfig ?? {}) as Record<string, unknown>;
      return {
        id: npc.id,
        name: npc.name,
        positionX: npc.positionX,
        positionY: npc.positionY,
        direction: npc.direction,
        appearance: npc.appearance,
        hasAgent: !!agentConfig.agentId,
        agentId: (agentConfig.agentId as string) || null,
        adapterType: npc.adapterType,
        hermesProfileId: npc.hermesProfileId,
        ...(roster
          ? { active: npc.active, placed: npc.positionX !== null, profile: npc.profile }
          : {}),
      };
    });
    return NextResponse.json({ npcs: result });
  } catch (err) {
    console.error("Failed to fetch NPCs:", err);
    return NextResponse.json(
      { errorCode: "failed_to_fetch_npcs", error: "Failed to fetch NPCs" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = getUserId(req);
    if (!userId)
      return NextResponse.json(
        { errorCode: "unauthorized", error: "Unauthorized" },
        { status: 401 },
      );

    const body = await req.json();
    const {
      channelId,
      name,
      persona,
      appearance,
      positionX,
      positionY,
      direction,
      agentId,
      agentAction,
      identity,
      soul,
      presetId,
      locale,
      adapterType,
      hermesProfileId,
    } = body;
    const normalizedLocale = normalizeLocale(locale);

    // 프로필은 이제 NPC 의 정본이다(`npcs.hermes_profile_id` NOT NULL). 없이 들어오면
    // 예전에는 조용히 NULL 로 저장돼 대화를 걸어야 비로소 드러났다 — 여기서 막는다.
    const boundProfileId =
      typeof hermesProfileId === "string" && hermesProfileId.trim() ? hermesProfileId.trim() : null;

    if (
      !channelId ||
      !name?.trim() ||
      !appearance ||
      positionX == null ||
      positionY == null ||
      !boundProfileId
    ) {
      return NextResponse.json(
        {
          errorCode: "missing_required_fields",
          error: "Missing required fields",
        },
        { status: 400 },
      );
    }

    if (presetId && !hasNpcPresetDefaults(presetId)) {
      return NextResponse.json(
        {
          errorCode: "unknown_preset_id",
          error: `Unknown presetId: ${presetId}`,
        },
        { status: 400 },
      );
    }

    // At least persona or identity must be provided (unless selecting existing agent)
    if (!persona?.trim() && !identity?.trim() && !presetId && agentAction !== "select") {
      return NextResponse.json(
        {
          errorCode: "missing_persona_or_identity",
          error: "Missing persona or identity",
        },
        { status: 400 },
      );
    }

    // Verify channel ownership
    const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
    if (!channel)
      return NextResponse.json(
        { errorCode: "channel_not_found", error: "Channel not found" },
        { status: 404 },
      );
    if (channel.ownerId !== userId)
      return NextResponse.json(
        {
          errorCode: "only_channel_owner_can_hire_npcs",
          error: "Only channel owner can hire NPCs",
        },
        { status: 403 },
      );

    // Check NPC count limit (max 10)
    const [{ value: npcCount }] = await db
      .select({ value: count() })
      .from(npcs)
      .where(eq(npcs.channelId, channelId));
    if (npcCount >= 10) {
      return NextResponse.json(
        {
          errorCode: "max_npcs_per_channel",
          error: "Maximum 10 NPCs per channel",
        },
        { status: 400 },
      );
    }

    // Build agentConfig based on agent action
    let agentConfig: Record<string, unknown>;
    const presetDefaults = hasNpcPresetDefaults(presetId)
      ? getNpcPresetDefaults({
          presetId,
          npcName: name.trim(),
          locale: normalizedLocale,
        })
      : null;
    const resolvedIdentity = identity?.trim() || persona?.trim() || presetDefaults?.identity || "";
    const resolvedSoul = soul?.trim() || presetDefaults?.soul || "";

    if (agentAction === "create" && agentId) {
      const personaConfig = hasNpcPresetDefaults(presetId)
        ? buildPersonaConfig({
            presetId,
            npcName: name.trim(),
            locale: normalizedLocale,
            identityOverride: identity?.trim(),
            soulOverride: soul?.trim(),
            fallbackPersona: persona?.trim(),
          })
        : {
            identity: localizeNpcPromptDocument(resolvedIdentity, normalizedLocale, "identity"),
            soul: localizeNpcPromptDocument(resolvedSoul, normalizedLocale, "soul"),
          };
      // Agent was already created via /api/npcs/create-agent
      agentConfig = {
        agentId,
        sessionKeyPrefix: `ot-${channelId.slice(0, 8)}-${agentId}`,
        personaConfig,
        locale: normalizedLocale,
        // 회의 규칙은 생성 시점에 로케일까지 확정해 저장한다 — 발신 시점에는
        // 저장된 값을 그대로 싣는다(socket-handlers 의 npcInstructions).
        meetingProtocol: getDefaultMeetingProtocol(normalizedLocale),
      };
    } else if (agentAction === "select" && agentId) {
      // Select an existing agent on the gateway
      agentConfig = {
        agentId,
        sessionKeyPrefix: `ot-${channelId.slice(0, 8)}-${agentId}`,
        locale: normalizedLocale,
        meetingProtocol: getDefaultMeetingProtocol(normalizedLocale),
      };
    } else {
      // No agent — backward compat: store persona in agentConfig
      const identityText = resolvedIdentity;
      const personaConfig =
        identityText || resolvedSoul
          ? hasNpcPresetDefaults(presetId)
            ? buildPersonaConfig({
                presetId,
                npcName: name.trim(),
                locale: normalizedLocale,
                identityOverride: identity?.trim(),
                soulOverride: soul?.trim(),
                fallbackPersona: persona?.trim(),
              })
            : {
                identity: localizeNpcPromptDocument(identityText, normalizedLocale, "identity"),
                soul: localizeNpcPromptDocument(resolvedSoul, normalizedLocale, "soul"),
              }
          : null;
      agentConfig = {
        agentId: null,
        sessionKeyPrefix: "",
        persona: identityText.slice(0, 500), // backward compat
        locale: normalizedLocale,
        meetingProtocol: getDefaultMeetingProtocol(normalizedLocale),
        ...(personaConfig ? { personaConfig } : {}),
      };
    }

    // Insert NPC
    const [npc] = await db
      .insert(npcs)
      .values({
        channelId,
        name: name.trim().slice(0, 100),
        positionX,
        positionY,
        direction: ["up", "down", "left", "right"].includes(direction) ? direction : "down",
        appearance: jsonForDb(appearance),
        agentConfig: jsonForDb(agentConfig),
        // 모달이 고른 엔진과 프로필. 넣지 않으면 컬럼 기본값 'openclaw' + 프로필 없음으로
        // 저장되고, 사용자는 대화를 걸어야 비로소 자기 선택이 버려진 것을 안다.
        adapterType: typeof adapterType === "string" && adapterType ? adapterType : "openclaw",
        hermesProfileId: boundProfileId,
      })
      .returning();

    // 응답의 name/appearance 는 프로필이 정본이다 — 방금 쓴 행을 그대로 실으면
    // 클라이언트가 이 응답으로 스프라이트를 띄우는 자리(npc:spawn-local)에서
    // 요청에 실려 온 이름이 프로필 이름 대신 화면에 남는다.
    const projected = await selectNpcById(npc.id);
    return NextResponse.json(
      {
        npc: {
          ...npc,
          ...(projected
            ? { name: projected.name, appearance: projected.appearance }
            : { appearance: parseDbJson(npc.appearance) ?? npc.appearance }),
          agentConfig: parseDbObject(npc.agentConfig) ?? npc.agentConfig,
        },
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    // 23505 는 PostgreSQL 의 unique_violation 이고, better-sqlite3 는
    // SQLITE_CONSTRAINT_UNIQUE 를 던진다. pg 코드만 보던 탓에 SQLite 배포에서는
    // 타일 중복이 409 가 아니라 500 으로 나갔고, 클라이언트의 409 처리
    // (배치 모드를 유지하며 조용히 넘어가는 경로)가 한 번도 동작하지 않았다.
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    if (
      code === "23505" ||
      code === "SQLITE_CONSTRAINT_UNIQUE" ||
      code === "SQLITE_CONSTRAINT_PRIMARYKEY"
    ) {
      return NextResponse.json(
        {
          errorCode: "tile_already_occupied",
          error: "This tile is already occupied",
        },
        { status: 409 },
      );
    }
    console.error("Failed to create NPC:", err);
    return NextResponse.json(
      { errorCode: "failed_to_create_npc", error: "Failed to create NPC" },
      { status: 500 },
    );
  }
}
