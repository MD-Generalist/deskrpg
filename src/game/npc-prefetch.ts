/**
 * `GET /api/npcs` 를 부르는 자리. 시뮬레이션에서 떼어 둔 이유는 두 가지다 —
 * 따로 두면 node 에서 fetch 만 바꿔 끼워 테스트할 수 있고, 여기서 잘못되면
 * **맵에 NPC 가 한 명도 안 뜨는데 아무 오류도 안 나는** 실패로 나타난다.
 *
 * 그 실패는 실제로 있었다. 예전 코드는 `this.channelId` 가 비면 `/api/npcs` 를
 * 채널 없이 불렀고(씬 재시작 경로 — `pendingChannelData` 는 소비 후 null 이 된다),
 * 라우트가 400 을 돌려주면 `data.npcs || []` 가 그것을 빈 목록으로 삼켰다.
 */

export type PrefetchedNpc = {
  id: string;
  name: string;
  positionX: number;
  positionY: number;
  direction: string;
  appearance?: unknown;
};

export type NpcPrefetchResult =
  | { ok: true; npcs: PrefetchedNpc[] }
  | { ok: false; reason: "no-channel" | "http-error" | "network-error"; message: string };

/**
 * 채널의 NPC 목록을 읽는다. 채널이 없으면 **부르지 않는다** — 채널 없는
 * `/api/npcs` 는 400(`channel_id_required`)이고, 그것을 빈 목록으로 삼키면
 * 사용자에게는 "NPC 0명"이 정상처럼 보인다.
 */
export async function fetchChannelNpcs(
  channelId: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<NpcPrefetchResult> {
  if (!channelId) {
    return {
      ok: false,
      reason: "no-channel",
      message: "channelId is empty — skipping the NPC prefetch (the map will have no NPCs)",
    };
  }

  try {
    const res = await fetchImpl(`/api/npcs?channelId=${encodeURIComponent(channelId)}`);
    if (!res.ok) {
      return {
        ok: false,
        reason: "http-error",
        message: `GET /api/npcs?channelId=${channelId} responded ${res.status}`,
      };
    }
    const data = (await res.json()) as { npcs?: PrefetchedNpc[] };
    return { ok: true, npcs: data.npcs ?? [] };
  } catch (err) {
    return {
      ok: false,
      reason: "network-error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
