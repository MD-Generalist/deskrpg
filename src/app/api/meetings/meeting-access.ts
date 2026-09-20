export type MeetingMinutesAccessResult =
  | { ok: true }
  | {
      ok: false;
      status: 403 | 404;
      errorCode: "not_a_member" | "channel_not_found" | "not_channel_owner";
      error: string;
    };

export type MeetingMinutesAccessDeps = {
  loadChannelOwner: (channelId: string) => Promise<string | null>;
  loadMembership: (channelId: string, userId: string) => Promise<boolean>;
};

export async function resolveMeetingMinutesAccess(args: {
  userId: string;
  channelId: string;
  deps: MeetingMinutesAccessDeps;
}): Promise<MeetingMinutesAccessResult> {
  const ownerId = await args.deps.loadChannelOwner(args.channelId);
  if (!ownerId) {
    return {
      ok: false,
      status: 404,
      errorCode: "channel_not_found",
      error: "Channel not found",
    };
  }

  if (ownerId === args.userId) {
    return { ok: true };
  }

  const isMember = await args.deps.loadMembership(args.channelId, args.userId);
  if (!isMember) {
    return {
      ok: false,
      status: 403,
      errorCode: "not_a_member",
      error: "Not a member",
    };
  }

  return { ok: true };
}

export async function resolveMeetingMinutesOwnerAccess(args: {
  userId: string;
  channelId: string;
  deps: MeetingMinutesAccessDeps;
}): Promise<MeetingMinutesAccessResult> {
  const ownerId = await args.deps.loadChannelOwner(args.channelId);
  if (!ownerId) {
    return {
      ok: false,
      status: 404,
      errorCode: "channel_not_found",
      error: "Channel not found",
    };
  }

  if (ownerId !== args.userId) {
    return {
      ok: false,
      status: 403,
      errorCode: "not_channel_owner",
      error: "Only the channel owner can delete meeting minutes",
    };
  }

  return { ok: true };
}

/**
 * 회의 결과를 등록하거나 요약을 다시 시킬 수 있는가. 회의를 제어하던 기준
 * (`canControlMeeting` — 주재자 또는 채널 소유자)과 같다.
 */
export function canManageMeetingMinutes(args: {
  userId: string;
  ownerId: string | null;
  minutes: { initiatorId: string | null };
}): boolean {
  if (args.ownerId && args.ownerId === args.userId) return true;
  return Boolean(args.minutes.initiatorId) && args.minutes.initiatorId === args.userId;
}
