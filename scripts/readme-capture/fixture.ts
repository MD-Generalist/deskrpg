import fs from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import type { KanbanBoard } from "../../src/lib/hermes/deskrpg-plugin-types";

import { OFFICE_LOOKS, officeLookAppearance } from "../../src/game/three/office-looks";
import { ensureOfficeEnvironmentTemplate } from "../../src/lib/office-environment-template";

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

function fixtureApiAsFetch(api: FixtureApi): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString(), "http://fixture");
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (method !== "GET" && method !== "POST" && method !== "PUT") {
      throw new Error(`Unsupported fixture method: ${method}`);
    }
    const rawBody = init?.body;
    const body = typeof rawBody === "string" && rawBody ? JSON.parse(rawBody) : undefined;
    const data = await api.request(method, `${url.pathname}${url.search}`, body);
    return Response.json(data);
  }) as typeof globalThis.fetch;
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

  const mapTemplateId = await ensureOfficeEnvironmentTemplate("trading", fixtureApiAsFetch(api));

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
              mapTemplateId,
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
      mapTemplateId,
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
  await api.request("PUT", `/api/npcs/${sophie.id}`, {
    positionX: 13,
    positionY: 17,
    direction: "down",
  });
  await api.request("PUT", `/api/npcs/${noah.id}`, {
    positionX: 15,
    positionY: 18,
    direction: "down",
  });

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
