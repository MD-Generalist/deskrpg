/**
 * Why "create office" is off for this viewer, by what they can do about it. Only the first account
 * is a system admin; later sign-ups join the Default group as `member`, which lacks `create_channel`.
 *
 * - `no_group` — in no group at all: joining one with an invite code is the way in.
 * - `grant_yourself` — can edit a group's permissions, so they can turn `create_channel` on.
 * - `ask_admin` — only someone else can grant it.
 */
export type CreateBlockedReason = "no_group" | "grant_yourself" | "ask_admin";

export function createBlockedReason<
  G extends { canCreateChannel?: boolean; canManagePermissions?: boolean },
>(groups: G[]): CreateBlockedReason | null {
  if (groups.some((group) => group.canCreateChannel)) return null;
  if (groups.length === 0) return "no_group";
  if (groups.some((group) => group.canManagePermissions)) return "grant_yourself";
  return "ask_admin";
}
