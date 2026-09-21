/**
 * 이미 방에 남은 알림 한 줄을 **같은 id 로** 되쓰고 다시 방송한다.
 *
 * 등록·승인처럼 DeskRPG 안에서 해소되는 알림이 쓴다. 해소 상태를 알림 자체에 두면 렌더러가 다른 표를
 * 다시 읽지 않아도 되고, 과거 메시지를 스크롤해도 그때의 결과가 보인다. 방송은 열려 있는 화면이 새로고침
 * 없이 버튼을 결과로 바꾸게 한다(`room-state` 가 같은 id 의 바뀐 알림을 제자리에서 갈아 끼운다).
 *
 * **던지지 않는다.** 알림이 낡는 것과 등록·승인이 실패하는 것은 무게가 다르다.
 */
import { and, eq, like } from "drizzle-orm";

import { chatRoomMessages, chatRooms, db } from "@/db";
import { requestEmitRoomMessage } from "@/lib/automation-registry";
import { parseRoomNotice, type RoomNotice } from "@/lib/chat-rooms-policy";

export async function rewriteRoomNotices(input: {
  channelId: string;
  /** LIKE 로 후보를 좁히는 문자열(알림에 든 id). 정확한 판정은 `update` 가 한다. */
  needle: string;
  /** 이 알림을 바꿀 것이면 새 알림을, 아니면 null 을 돌려준다. */
  update: (notice: RoomNotice) => RoomNotice | null;
}): Promise<number> {
  let rewritten = 0;
  try {
    const rows = await db
      .select({
        id: chatRoomMessages.id,
        roomId: chatRoomMessages.roomId,
        senderKind: chatRoomMessages.senderKind,
        senderId: chatRoomMessages.senderId,
        senderName: chatRoomMessages.senderName,
        content: chatRoomMessages.content,
        createdAt: chatRoomMessages.createdAt,
        noticeJson: chatRoomMessages.noticeJson,
      })
      .from(chatRoomMessages)
      .innerJoin(chatRooms, eq(chatRooms.id, chatRoomMessages.roomId))
      .where(
        and(
          eq(chatRooms.channelId, input.channelId),
          like(chatRoomMessages.noticeJson, `%${input.needle}%`),
        ),
      );
    for (const row of rows) {
      const notice = parseRoomNotice(row.noticeJson);
      const next = notice ? input.update(notice) : null;
      if (!next) continue;
      await db
        .update(chatRoomMessages)
        .set({ noticeJson: JSON.stringify(next) })
        .where(eq(chatRoomMessages.id, row.id));
      rewritten += 1;
      requestEmitRoomMessage(row.roomId, {
        id: row.id,
        roomId: row.roomId,
        senderKind: row.senderKind,
        senderId: row.senderId,
        senderName: row.senderName,
        content: row.content,
        createdAt:
          row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
        notice: next,
      });
    }
  } catch (error) {
    console.warn("[room-notice] 알림을 되쓰지 못했다", { channelId: input.channelId }, error);
  }
  return rewritten;
}
