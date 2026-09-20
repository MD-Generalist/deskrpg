import fs from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import type { KanbanBoard } from "../../src/lib/hermes/deskrpg-plugin-types";

import { OFFICE_LOOKS, officeLookAppearance } from "../../src/game/three/office-looks";
import { deriveChannelMotionLayout } from "../../src/lib/channel-motion-layout";
import { seatingMapFor, type DeskSeat, type SeatingMap } from "../../src/lib/seat-assignment";

export type FixtureApi = {
  request<T>(method: "GET" | "POST" | "PUT" | "PATCH", path: string, body?: unknown): Promise<T>;
};

export const CAPTURE_ACCOUNT = {
  loginId: "readme-capture",
  nickname: "Dante",
  password: "readme-capture-local-only",
} as const;

export type CaptureFixture = {
  loginId: string;
  password: string;
  characterName: string;
  channelId: string;
  reportCardId: string;
  npcNames: ["Sophie", "Noah"];
  profileNames: ["sophie", "noah"];
};

type Identified = { id: string };
type RegistrationResponse = { user: Identified; existing?: boolean };
type CharacterResponse = { character: Identified & { name?: string } };
type CharactersResponse = { characters: Array<Identified & { name?: string }> };
type GatewayResponse = { gateway: Identified };
type GroupsResponse = { groups: Array<Identified & { isDefault?: boolean; slug?: string }> };
type ChannelResponse = { channel: Identified };
type ChannelDetail = { channel: Identified & { mapData?: unknown; mapConfig?: unknown } };
type ChannelsResponse = {
  channels: Array<Identified & { name?: string; ownerId?: string }>;
};
type RosterNpc = Identified & {
  name?: string | null;
  positionX?: number | null;
  positionY?: number | null;
  profile?: { profileName?: string; displayName?: string } | null;
};
type RosterResponse = { npcs: RosterNpc[] };

const PROFILE_REGISTRATIONS = [
  {
    profileName: "sophie",
    token: "readme-capture-sophie-token",
    displayName: "Sophie",
  },
  {
    profileName: "noah",
    token: "readme-capture-noah-token",
    displayName: "Noah",
  },
] as const;

const CHANNEL_NAME = "Dante Labs Office";
/** 캡처 채널의 환경. 배치는 서버가 코드에서 만들므로 ID 만 넘긴다. */
const CHANNEL_ENVIRONMENT_ID = "trading";
const REPORT_TITLE = "시네마틱 캡처 준비";

function assertLoopbackUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Capture gateway URL must be a valid loopback URL");
  }
  const host = url.hostname.toLowerCase();
  const loopback =
    host === "localhost" || host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
  if (!loopback || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Capture gateway URL must use a loopback host");
  }
}

function assertCaptureSqlitePath(sqlitePath: string): void {
  const normalized = path.resolve(sqlitePath);
  const marker = `${path.sep}.artifacts${path.sep}readme-capture${path.sep}runtime${path.sep}`;
  if (!normalized.includes(marker)) {
    throw new Error("SQLite path must stay inside the isolated readme-capture runtime");
  }
  const markerIndex = normalized.indexOf(marker);
  let current = normalized.slice(0, markerIndex);
  for (const segment of normalized.slice(markerIndex + path.sep.length).split(path.sep)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error("SQLite path must not traverse symlinks in the readme-capture runtime");
    }
  }
}

function requireId(value: Identified | undefined, label: string): string {
  if (!value || typeof value.id !== "string" || !value.id) {
    throw new Error(`${label} response is missing an ID`);
  }
  return value.id;
}

/** 회의실 입구 타일. 좌석을 회의실 가까이 골라 모이는 시간을 줄인다. */
function meetingEntryTile(mapData: unknown): { col: number; row: number } | null {
  const layout = deriveChannelMotionLayout(
    { mapData } as Parameters<typeof deriveChannelMotionLayout>[0],
    [],
  );
  const entry = layout?.meetingSpace?.entry;
  return entry ? { col: Math.floor(entry.x), row: Math.floor(entry.y) } : null;
}

/** Sophie 를 스폰에서 얼마나 떼어 놓을지(타일). 호출 장면은 걸어야 하고, 회의는 9초 안에 모여야 한다. */
const SOPHIE_DISTANCE = 6;

/**
 * 장면에 쓸 좌석 두 개와 플레이어 스폰을 고른다.
 *
 * - Noah 는 스폰 바로 옆에 앉힌다 — 근처에 누가 있어야 방 입력이 열린 채로 장면이 시작된다
 *   (대화 사거리 64px = 2칸).
 * - Sophie 는 몇 칸 떨어진 좌석에 앉힌다 — "호출하기" 장면은 그가 걸어와야 성립한다.
 *   그중 회의실에 가까운 자리를 고른다 — 회의 장면은 9초 안에 모여 발언까지 끝나야 한다.
 */
function captureSeating(
  seating: SeatingMap | null,
  meeting: { col: number; row: number } | null,
): { sophie: DeskSeat; noah: DeskSeat; spawn: { col: number; row: number } } | null {
  if (!seating || seating.seats.length < 2 || seating.standing.length === 0) return null;
  for (const noah of seating.seats) {
    const spawn = seating.standing.find(
      (tile) => Math.abs(tile.col - noah.col) <= 1 && Math.abs(tile.row - noah.row) <= 1,
    );
    if (!spawn) continue;
    // 가장 먼 자리는 쓰지 않는다 — 회의 장면에서 걸어오느라 9초 클립을 넘긴다(실측 17.7초).
    // 호출 장면이 성립할 만큼만 떨어뜨린다.
    const sophie = seating.seats
      .filter((seat) => seat.number !== noah.number)
      .map((seat) => ({
        seat,
        away: Math.hypot(seat.col - spawn.col, seat.row - spawn.row),
        toMeeting: meeting ? Math.hypot(seat.col - meeting.col, seat.row - meeting.row) : 0,
      }))
      .filter((entry) => entry.away > 3 && entry.away <= SOPHIE_DISTANCE)
      .sort((a, b) => a.toMeeting - b.toMeeting)[0]?.seat;
    if (!sophie) continue;
    return { sophie, noah, spawn };
  }
  return null;
}

function findRosterNpc(npcs: RosterNpc[], profileName: "sophie" | "noah"): RosterNpc {
  const displayName = profileName === "sophie" ? "Sophie" : "Noah";
  const npc = npcs.find(
    (entry) =>
      entry.profile?.profileName === profileName ||
      entry.profile?.displayName === displayName ||
      entry.name === displayName,
  );
  if (!npc) throw new Error(`${displayName} is missing from the channel roster`);
  return npc;
}

export async function prepareFixture(
  api: FixtureApi,
  gatewayBaseUrl: string,
  sqlitePath: string,
): Promise<CaptureFixture> {
  assertLoopbackUrl(gatewayBaseUrl);
  assertCaptureSqlitePath(sqlitePath);

  const registration = await api.request<RegistrationResponse>(
    "POST",
    "/api/auth/register",
    CAPTURE_ACCOUNT,
  );
  const userId = requireId(registration.user, "User");

  let character: Identified & { name?: string };
  if (registration.existing) {
    const existing = await api.request<CharactersResponse>("GET", "/api/characters");
    character =
      existing.characters.find((entry) => entry.name === "Dante") ??
      (
        await api.request<CharacterResponse>("POST", "/api/characters", {
          name: "Dante",
          appearance: officeLookAppearance(OFFICE_LOOKS[0].id),
        })
      ).character;
  } else {
    character = (
      await api.request<CharacterResponse>("POST", "/api/characters", {
        name: "Dante",
        appearance: officeLookAppearance(OFFICE_LOOKS[0].id),
      })
    ).character;
  }
  requireId(character, "Character");

  const gateway = await api.request<GatewayResponse>("POST", "/api/gateways", {
    url: gatewayBaseUrl,
    token: "readme-capture-gateway-token",
    displayName: "README Capture",
  });
  const gatewayId = requireId(gateway.gateway, "Gateway");

  for (const [index, profile] of PROFILE_REGISTRATIONS.entries()) {
    const registered = await api.request<{ profile: Identified }>(
      "POST",
      `/api/gateways/${encodeURIComponent(gatewayId)}/profiles`,
      profile,
    );
    await api.request(
      "PATCH",
      `/api/gateways/${encodeURIComponent(gatewayId)}/profiles/${requireId(registered.profile, "Profile")}`,
      {
        appearance: officeLookAppearance(OFFICE_LOOKS[index + 1].id),
      },
    );
  }

  const groups = await api.request<GroupsResponse>("GET", "/api/groups");
  const group = groups.groups.find((entry) => entry.isDefault || entry.slug === "default");
  const groupId = requireId(group, "Default group");

  let channelId: string;
  if (registration.existing) {
    const existing = await api.request<ChannelsResponse>("GET", "/api/channels");
    const channel = existing.channels.find(
      (entry) => entry.name === CHANNEL_NAME && entry.ownerId === userId,
    );
    channelId = channel
      ? requireId(channel, "Channel")
      : requireId(
          (
            await api.request<ChannelResponse>("POST", "/api/channels", {
              name: CHANNEL_NAME,
              description: "Hermes agents at work",
              isPublic: true,
              environmentId: CHANNEL_ENVIRONMENT_ID,
              groupId,
              gatewayConfig: { gatewayId },
            })
          ).channel,
          "Channel",
        );
  } else {
    const response = await api.request<ChannelResponse>("POST", "/api/channels", {
      name: CHANNEL_NAME,
      description: "Hermes agents at work",
      isPublic: true,
      environmentId: CHANNEL_ENVIRONMENT_ID,
      groupId,
      gatewayConfig: { gatewayId },
    });
    channelId = requireId(response.channel, "Channel");
  }

  const roster = await api.request<RosterResponse>(
    "GET",
    `/api/npcs?channelId=${encodeURIComponent(channelId)}&roster=1`,
  );
  const sophie = findRosterNpc(roster.npcs, "sophie");
  const noah = findRosterNpc(roster.npcs, "noah");
  // 좌석은 맵이 정한다 — 좌표를 박아 두면 좌석 배정이 바뀔 때마다 `not_a_desk_seat` 로 막힌다.
  const detail = await api.request<ChannelDetail>(
    "GET",
    `/api/channels/${encodeURIComponent(channelId)}`,
  );
  const seating = seatingMapFor({
    mapData: detail.channel.mapData,
    mapConfig: detail.channel.mapConfig,
  });
  const scene = captureSeating(seating, meetingEntryTile(detail.channel.mapData));
  if (scene) {
    // 플레이어가 대화 사거리(2칸) 안에서 시작하도록 스폰을 옮긴다 — 방 입력이 잠기지 않는다.
    await api.request("PUT", `/api/channels/${encodeURIComponent(channelId)}`, {
      mapConfig: {
        ...(typeof detail.channel.mapConfig === "object" && detail.channel.mapConfig !== null
          ? (detail.channel.mapConfig as Record<string, unknown>)
          : {}),
        spawnCol: scene.spawn.col,
        spawnRow: scene.spawn.row,
      },
    });
    await api.request("PUT", `/api/npcs/${sophie.id}`, {
      positionX: scene.sophie.col,
      positionY: scene.sophie.row,
      direction: "down",
    });
    await api.request("PUT", `/api/npcs/${noah.id}`, {
      positionX: scene.noah.col,
      positionY: scene.noah.row,
      direction: "down",
    });
  }

  // Cards remain in Hermes; DeskRPG creates only the board binding and room notices.
  const boardPath = `/api/channels/${encodeURIComponent(channelId)}/kanban`;
  const board = await api.request<KanbanBoard>("GET", `${boardPath}/board`);
  const existingCard = board.columns
    .flatMap((column) => column.tasks)
    .find((card) => card.title === REPORT_TITLE && card.assignee === "sophie");
  const reportCardId =
    existingCard?.id ??
    requireId(
      (
        await api.request<{ task: Identified }>("POST", `${boardPath}/tasks`, {
          title: REPORT_TITLE,
          body: "장면과 미디어 규격 점검을 완료했습니다.",
          assignee: sophie.id,
        })
      ).task,
      "Hermes card",
    );

  return {
    loginId: CAPTURE_ACCOUNT.loginId,
    password: CAPTURE_ACCOUNT.password,
    characterName: "Dante",
    channelId,
    reportCardId,
    npcNames: ["Sophie", "Noah"],
    profileNames: ["sophie", "noah"],
  };
}
