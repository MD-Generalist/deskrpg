import { eq } from "drizzle-orm";
import { db, npcs, hermesProfiles, gatewayResources } from "@/db";
import { parseDbJson } from "./db-json";

type NpcRow = typeof npcs.$inferSelect;
type ProfileRow = Pick<
  typeof hermesProfiles.$inferSelect,
  "id" | "gatewayId" | "profileName" | "displayName" | "appearance"
>;

export type ProjectedNpc = {
  id: string;
  channelId: string;
  name: string;
  appearance: unknown;
  positionX: number | null;
  positionY: number | null;
  direction: string | null;
  adapterType: string;
  adapterConfig: unknown;
  agentConfig: unknown;
  hermesProfileId: string;
  active: boolean;
  profile: {
    gatewayId: string;
    profileName: string;
    displayName: string | null;
    ownerUserId: string;
  };
};

/**
 * `npcs` 행 + 프로필 → 예전과 같은 모양의 NPC.
 *
 * 이름·외형은 **프로필이 정본**이다. `npcs.name`/`appearance` 는 이번 릴리스에 컬럼만
 * 남아 있고(롤백 안전) 여기서 읽지 않는다. 소비자 16개 파일이 이 모양을 그대로 쓰므로
 * 필드 이름을 바꾸지 않는다.
 */
export function projectNpcRow(npc: NpcRow, profile: ProfileRow, ownerUserId: string): ProjectedNpc {
  return {
    id: npc.id,
    channelId: npc.channelId,
    name: profile.displayName?.trim() || profile.profileName,
    appearance: parseDbJson<unknown>(profile.appearance) ?? profile.appearance ?? null,
    positionX: npc.positionX ?? null,
    positionY: npc.positionY ?? null,
    direction: npc.direction ?? null,
    adapterType: npc.adapterType,
    adapterConfig: parseDbJson<unknown>(npc.adapterConfig) ?? npc.adapterConfig ?? null,
    agentConfig: parseDbJson<unknown>(npc.agentConfig) ?? npc.agentConfig ?? null,
    hermesProfileId: npc.hermesProfileId,
    active: Boolean(npc.active),
    profile: {
      gatewayId: profile.gatewayId,
      profileName: profile.profileName,
      displayName: profile.displayName ?? null,
      ownerUserId,
    },
  };
}

/** 맵에 그릴 수 있는 것만 — 자리가 있고 출근 중. 기존 `/api/npcs` 계약이 이것이다. */
export function filterForMap(list: ProjectedNpc[]): ProjectedNpc[] {
  return list.filter((n) => n.active && n.positionX !== null && n.positionY !== null);
}

async function joined(where: ReturnType<typeof eq>) {
  const rows = await db
    .select({ npc: npcs, profile: hermesProfiles, ownerUserId: gatewayResources.ownerUserId })
    .from(npcs)
    .innerJoin(hermesProfiles, eq(hermesProfiles.id, npcs.hermesProfileId))
    .innerJoin(gatewayResources, eq(gatewayResources.id, hermesProfiles.gatewayId))
    .where(where);
  return rows.map((r) => projectNpcRow(r.npc, r.profile, r.ownerUserId));
}

/**
 * `roster` 는 "출근부" — 자리 미정과 휴면까지 전부 준다(관리 화면용).
 * `includeDormant: false` 는 그중 휴면만 뺀다 — 대화 참가자 명단이 이것이다.
 * 자리 미정은 남는다: 맵 밖에 있을 뿐 출근 중이고, 스펙상 휴면만 대화를 떠난다.
 */
export async function selectChannelNpcs(
  channelId: string,
  opts: { roster?: boolean; includeDormant?: boolean } = {},
) {
  const all = await joined(eq(npcs.channelId, channelId));
  if (!opts.roster) return filterForMap(all);
  return opts.includeDormant === false ? all.filter((n) => n.active) : all;
}

export async function selectNpcById(npcId: string): Promise<ProjectedNpc | null> {
  const [one] = await joined(eq(npcs.id, npcId));
  return one ?? null;
}
