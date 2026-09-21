// src/db/schema-sqlite.ts
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  unique,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  loginId: text("login_id").unique().notNull(),
  nickname: text("nickname").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  systemRole: text("system_role").notNull().default("user"),
  /** 관리자·CLI 가 임시 비밀번호를 발급하면 참이 된다. 본인이 바꾸면 거짓으로 돌아간다. */
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  lastActiveAt: text("last_active_at"),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

export const characters = sqliteTable(
  "characters",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    appearance: text("appearance").notNull(),
    bio: text("bio"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_characters_user_id").on(table.userId)],
);

export const groups = sqliteTable("groups", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").unique().notNull(),
  description: text("description"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

export const channels = sqliteTable("channels", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  groupId: text("group_id").references(() => groups.id, { onDelete: "set null" }),
  mapData: text("map_data"),
  mapConfig: text("map_config"),
  isPublic: integer("is_public", { mode: "boolean" }).default(true),
  inviteCode: text("invite_code").unique(),
  maxPlayers: integer("max_players").default(50),
  password: text("password"),
  gatewayConfig: text("gateway_config"),
  /** NPC 걸음 속도(`npc-motion-config`). 비어 있으면 기본값 — 채널 공유 설정이다. */
  motionConfig: text("motion_config"),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

export const gatewayResources = sqliteTable(
  "gateway_resources",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    baseUrl: text("base_url").notNull(),
    tokenEncrypted: text("token_encrypted").notNull(),
    pairedDeviceId: text("paired_device_id"),
    lastValidatedAt: text("last_validated_at"),
    lastValidationStatus: text("last_validation_status"),
    lastValidationError: text("last_validation_error"),
    localDiscoveryOptedInAt: text("local_discovery_opted_in_at"),
    localDiscoveryOptedInBy: text("local_discovery_opted_in_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // `GET /deskrpg/info` 판정 캐시. 매 화면 진입마다 원격을 찌르지 않기 위한 것이고,
    // 게이트웨이 테스트·편집 때 갱신된다. `plugin_status` 값은
    // src/lib/hermes/plugin-capability.ts 의 PluginStatus 와 같은 문자열이다.
    pluginStatus: text("plugin_status"),
    pluginVersion: text("plugin_version"),
    pluginCheckedAt: text("plugin_checked_at"),
    // `GET /deskrpg/info` 응답 본문 캐시(JSON 문자열). plugin_status·plugin_version 은 판정 요약이고,
    // 칸반·cron 같은 세부 기능 지원 여부는 이 원문에서 읽는다.
    pluginInfoJson: text("plugin_info_json"),
    createdAt: text("created_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
    updatedAt: text("updated_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
  },
  (table) => [index("idx_gateway_resources_owner_user_id").on(table.ownerUserId)],
);

export const gatewayShares = sqliteTable(
  "gateway_shares",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    gatewayId: text("gateway_id")
      .notNull()
      .references(() => gatewayResources.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("use"),
    createdAt: text("created_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
  },
  (table) => [
    index("idx_gateway_shares_gateway_id").on(table.gatewayId),
    index("idx_gateway_shares_user_id").on(table.userId),
    uniqueIndex("gateway_shares_gateway_user_idx").on(table.gatewayId, table.userId),
  ],
);

export const hermesProfiles = sqliteTable(
  "hermes_profiles",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    gatewayId: text("gateway_id")
      .notNull()
      .references(() => gatewayResources.id, { onDelete: "cascade" }),
    profileName: text("profile_name").notNull(),
    tokenEncrypted: text("token_encrypted").notNull(),
    displayName: text("display_name"),
    description: text("description"),
    /** 캐릭터 외형. NPC 의 정본이다 — npcs.appearance 는 이번 릴리스에 남기지만 쓰지 않는다. */
    appearance: text("appearance"),
    provisionedByDeskrpg: integer("provisioned_by_deskrpg", { mode: "boolean" })
      .notNull()
      .default(false),
    lastValidatedAt: text("last_validated_at"),
    lastValidationStatus: text("last_validation_status"),
    lastValidationError: text("last_validation_error"),
    createdAt: text("created_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
    updatedAt: text("updated_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
  },
  (table) => [
    index("idx_hermes_profiles_gateway_id").on(table.gatewayId),
    uniqueIndex("hermes_profiles_gateway_name_idx").on(table.gatewayId, table.profileName),
  ],
);

export const providerResources = sqliteTable(
  "provider_resources",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerType: text("provider_type").notNull(),
    displayName: text("display_name"),
    authMethod: text("auth_method").notNull(),
    credentialsEncrypted: text("credentials_encrypted"),
    baseUrl: text("base_url"),
    lastValidatedAt: text("last_validated_at"),
    lastValidationStatus: text("last_validation_status"),
    createdAt: text("created_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
    updatedAt: text("updated_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
  },
  (table) => [index("idx_provider_resources_owner").on(table.ownerUserId)],
);

export const providerShares = sqliteTable(
  "provider_shares",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    providerId: text("provider_id")
      .notNull()
      .references(() => providerResources.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("use"),
    createdAt: text("created_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
  },
  (table) => [
    index("idx_provider_shares_provider").on(table.providerId),
    uniqueIndex("provider_shares_provider_user_idx").on(table.providerId, table.userId),
  ],
);

export const channelGatewayBindings = sqliteTable(
  "channel_gateway_bindings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    gatewayId: text("gateway_id")
      .notNull()
      .references(() => gatewayResources.id, { onDelete: "cascade" }),
    boundByUserId: text("bound_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    boundAt: text("bound_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
  },
  (table) => [
    index("idx_channel_gateway_bindings_gateway_id").on(table.gatewayId),
    uniqueIndex("channel_gateway_bindings_channel_idx").on(table.channelId),
  ],
);

// 채널 ↔ Hermes 칸반 보드 연결 장부. 채널마다 보드 하나라 channel_id 가 곧 PK 다.
// event_cursor 는 마지막으로 소비한 보드 이벤트 위치, last_error 는 마지막 폴링 실패 사유.
// 보드 이름은 Hermes 쪽이 정본이고 board_name_synced_at 은 그것을 마지막으로 맞춘 시각이다.
export const channelKanbanBoards = sqliteTable(
  "channel_kanban_boards",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    gatewayId: text("gateway_id")
      .notNull()
      .references(() => gatewayResources.id, { onDelete: "cascade" }),
    boardSlug: text("board_slug").notNull(),
    isEventCarrier: integer("is_event_carrier", { mode: "boolean" }).notNull().default(false),
    boardNameSyncedAt: text("board_name_synced_at"),
    eventCursor: text("event_cursor"),
    lastPolledAt: text("last_polled_at"),
    lastError: text("last_error"),
    createdAt: text("created_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
    updatedAt: text("updated_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
  },
  (table) => [
    index("idx_channel_kanban_boards_gateway_id").on(table.gatewayId),
    uniqueIndex("channel_kanban_boards_channel_slug_idx").on(table.channelId, table.boardSlug),
    // 채널마다 사건 수신 보드(크론·아티팩트를 받는 행)는 정확히 하나다 — 사무실 방 불변식과 같은 수법.
    uniqueIndex("channel_kanban_boards_carrier_idx")
      .on(table.channelId)
      .where(sql`${table.isEventCarrier}`),
  ],
);

// DeskRPG 가 만든 Hermes cron 작업의 출처 장부. Hermes 쪽 작업은 (게이트웨이, 프로필, job id)
// 세 값으로 유일하게 정해지므로 그 조합이 유니크다. 채널이 사라지면 장부도 같이 사라지고,
// 만든 사용자가 탈퇴해도 작업 자체는 남아야 하니 created_by 는 set null 이다.
export const cronJobOrigins = sqliteTable(
  "cron_job_origins",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    gatewayId: text("gateway_id")
      .notNull()
      .references(() => gatewayResources.id, { onDelete: "cascade" }),
    profileName: text("profile_name").notNull(),
    jobId: text("job_id").notNull(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
  },
  (table) => [
    index("idx_cron_job_origins_channel_id").on(table.channelId),
    uniqueIndex("cron_job_origins_gateway_profile_job_idx").on(
      table.gatewayId,
      table.profileName,
      table.jobId,
    ),
  ],
);

export const groupMembers = sqliteTable(
  "group_members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    approvedBy: text("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: text("approved_at"),
    joinedAt: text("joined_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_group_members_group_id").on(table.groupId),
    index("idx_group_members_user_id").on(table.userId),
    unique("group_members_group_user_unique").on(table.groupId, table.userId),
  ],
);

export const groupInvites = sqliteTable(
  "group_invites",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    token: text("token").unique().notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: text("target_user_id").references(() => users.id, { onDelete: "set null" }),
    targetLoginId: text("target_login_id"),
    expiresAt: text("expires_at"),
    acceptedBy: text("accepted_by").references(() => users.id, { onDelete: "set null" }),
    acceptedAt: text("accepted_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_group_invites_group_id").on(table.groupId),
    index("idx_group_invites_target_user_id").on(table.targetUserId),
  ],
);

export const groupJoinRequests = sqliteTable(
  "group_join_requests",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    message: text("message"),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_group_join_requests_group_id").on(table.groupId),
    index("idx_group_join_requests_user_id").on(table.userId),
    unique("group_join_requests_group_user_unique").on(table.groupId, table.userId),
  ],
);

export const groupPermissions = sqliteTable(
  "group_permissions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull(),
    effect: text("effect").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_group_permissions_group_id").on(table.groupId),
    unique("group_permissions_group_permission_unique").on(table.groupId, table.permissionKey),
  ],
);

export const userPermissionOverrides = sqliteTable(
  "user_permission_overrides",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull(),
    effect: text("effect").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_user_permission_overrides_group_id").on(table.groupId),
    index("idx_user_permission_overrides_user_id").on(table.userId),
    unique("user_permission_overrides_group_user_permission_unique").on(
      table.groupId,
      table.userId,
      table.permissionKey,
    ),
  ],
);

export const channelMembers = sqliteTable(
  "channel_members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    lastX: integer("last_x"),
    lastY: integer("last_y"),
    joinedAt: text("joined_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_channel_members_channel_id").on(table.channelId),
    index("idx_channel_members_user_id").on(table.userId),
    unique("channel_members_channel_user_unique").on(table.channelId, table.userId),
  ],
);

export const npcs = sqliteTable(
  "npcs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    name: text("name"),
    positionX: integer("position_x"),
    positionY: integer("position_y"),
    direction: text("direction").default("down"),
    appearance: text("appearance"),
    adapterType: text("adapter_type").notNull().default("hermes"),
    adapterConfig: text("adapter_config"),
    hermesProfileId: text("hermes_profile_id")
      .notNull()
      .references(() => hermesProfiles.id, { onDelete: "cascade" }),
    agentConfig: text("agent_config"),
    /** 이 채널에 출근 중인가. false 면 자리는 기억한 채 맵에서 빠진다. */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_npcs_channel_id").on(table.channelId),
    unique("npcs_channel_position_unique").on(table.channelId, table.positionX, table.positionY),
    uniqueIndex("npcs_channel_profile_idx").on(table.channelId, table.hermesProfileId),
  ],
);

export const npcSessions = sqliteTable(
  "npc_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    npcId: text("npc_id")
      .notNull()
      .references(() => npcs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    adapterType: text("adapter_type").notNull(),
    sessionType: text("session_type").notNull(),
    sessionRef: text("session_ref").notNull(),
    contextKey: text("context_key").notNull(),
    lastSummary: text("last_summary"),
    createdAt: text("created_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
    updatedAt: text("updated_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
  },
  (table) => [
    index("idx_npc_sessions_npc").on(table.npcId),
    uniqueIndex("npc_sessions_npc_user_context_idx").on(
      table.npcId,
      table.userId,
      table.contextKey,
    ),
  ],
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id),
    npcId: text("npc_id")
      .notNull()
      .references(() => npcs.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_chat_messages_lookup").on(table.characterId, table.npcId, table.createdAt),
  ],
);

export const chatRooms = sqliteTable(
  "chat_rooms",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    replyPolicy: text("reply_policy").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    lastMessageAt: text("last_message_at"),
  },
  (t) => [
    index("idx_chat_rooms_channel").on(t.channelId, t.lastMessageAt),
    uniqueIndex("uq_chat_rooms_office_per_channel")
      .on(t.channelId)
      .where(sql`kind = 'office'`),
  ],
);

export const chatRoomMembers = sqliteTable(
  "chat_room_members",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    memberKind: text("member_kind").notNull(),
    memberId: text("member_id").notNull(),
    invitedBy: text("invited_by").references(() => users.id),
    joinedAt: text("joined_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.memberKind, t.memberId] })],
);

export const chatRoomMessages = sqliteTable(
  "chat_room_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    roomId: text("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    senderKind: text("sender_kind").notNull(),
    senderId: text("sender_id"),
    senderName: text("sender_name").notNull(),
    content: text("content").notNull(),
    // 시스템 메시지의 구조화 페이로드(JSON 문자열). 칸반 카드 이동·cron 결과 같은 알림이
    // 본문(content) 과 별도로 카드 렌더링에 쓸 데이터를 여기 담는다. 일반 메시지는 NULL.
    noticeJson: text("notice_json"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("idx_chat_room_messages_room").on(t.roomId, t.createdAt)],
);

export const meetingMinutes = sqliteTable(
  "meeting_minutes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    transcript: text("transcript").notNull(),
    participants: text("participants").notNull().default("[]"),
    totalTurns: integer("total_turns").notNull().default(0),
    durationSeconds: integer("duration_seconds"),
    initiatorId: text("initiator_id").references(() => users.id, { onDelete: "set null" }),
    keyTopics: text("key_topics").notNull().default("[]"),
    conclusions: text("conclusions"),
    // 구조화된 회의 결과(결정·후속 업무·프로젝트 권고). 초안이지 카드 사본이 아니다.
    outcomeJson: text("outcome_json"),
    summaryStatus: text("summary_status").notNull().default("ok"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_meeting_minutes_channel").on(table.channelId),
    index("idx_meeting_minutes_created").on(table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// 프로젝트 목록표 (설계 2026-09-21 project-registry)
//
// 보드 = 프로젝트, 테넌트 = 서브프로젝트다. **이름·설명·진행률은 여기 두지 않는다** —
// Hermes 보드 메타와 `GET /kanban/boards` 의 `counts` 가 정본이고, 사본을 두면 하드 게이트 1을
// 어기며 언젠가 어긋난다. 여기 남는 것은 Hermes 가 담을 자리가 없는 사람 쪽 정보뿐이다:
// 상태·리드 직원·목표일·색·아이콘·일시정지 사유, 그리고 "왜 이 일을 하는가" 에 답하는 출처 회의.
// ---------------------------------------------------------------------------

export const channelProjects = sqliteTable(
  "channel_projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    boardLinkId: text("board_link_id")
      .notNull()
      .unique()
      .references(() => channelKanbanBoards.id, { onDelete: "cascade" }),
    // 채널별 목록 질의를 조인 없이 하려고 둔 비정규화. 연결 행의 채널과 늘 같다.
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("planned"),
    leadNpcId: text("lead_npc_id").references(() => npcs.id, { onDelete: "set null" }),
    targetDate: text("target_date"),
    color: text("color"),
    icon: text("icon"),
    // 일시정지는 상태가 아니라 이 칸이 채워진 in_progress 다(Paperclip 과 같은 취급).
    pauseReason: text("pause_reason"),
    originMeetingId: text("origin_meeting_id").references(() => meetingMinutes.id, {
      onDelete: "set null",
    }),
    /** 결정 C-1 — 자리만 열어 둔다. 이 설계는 읽지도 쓰지도 않는다. */
    hermesProjectId: text("hermes_project_id"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
    updatedAt: text("updated_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
  },
  (table) => [index("idx_channel_projects_channel").on(table.channelId)],
);

export const channelSubprojects = sqliteTable(
  "channel_subprojects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => channelProjects.id, { onDelete: "cascade" }),
    /**
     * Hermes `tasks.tenant` 에 그대로 들어가는 값. **만든 뒤 절대 바꾸지 않는다** — 디스패처가
     * 작업자에게 `HERMES_TENANT` 를 넘기고 자식 카드가 그것을 상속하므로, 값이 바뀌면 이미
     * 만들어진 카드들이 고아가 된다. 표시 이름을 바꾸고 싶으면 `name` 만 바꾼다.
     */
    tenantSlug: text("tenant_slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("planned"),
    leadNpcId: text("lead_npc_id").references(() => npcs.id, { onDelete: "set null" }),
    targetDate: text("target_date"),
    color: text("color"),
    icon: text("icon"),
    pauseReason: text("pause_reason"),
    originMeetingId: text("origin_meeting_id").references(() => meetingMinutes.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
    updatedAt: text("updated_at")
      .$defaultFn(() => new Date().toISOString())
      .notNull(),
  },
  (table) => [
    uniqueIndex("channel_subprojects_project_tenant_idx").on(table.projectId, table.tenantSlug),
  ],
);

/**
 * 실행 전 승인 관문의 레코드. PG 쪽 approvals·approvalTargets 와 컬럼 집합이 같아야 한다.
 * 시각은 SQLite 관례대로 ISO 문자열이다.
 */
export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    status: text("status").notNull(),
    requestedBy: text("requested_by").notNull(),
    title: text("title").notNull(),
    sourceJson: text("source_json").notNull(),
    payloadJson: text("payload_json"),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: text("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("approvals_channel_status_idx").on(t.channelId, t.status)],
);

export const approvalTargets = sqliteTable(
  "approval_targets",
  {
    approvalId: text("approval_id")
      .notNull()
      .references(() => approvals.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull(),
    decision: text("decision"),
  },
  (t) => [
    primaryKey({ columns: [t.approvalId, t.taskId] }),
    index("approval_targets_task_idx").on(t.taskId),
  ],
);

// 직원 패널의 탭별 열람 상태. PG 쪽 npcPanelReads 와 컬럼 집합이 같아야 한다.
export const npcPanelReads = sqliteTable(
  "npc_panel_reads",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    npcId: text("npc_id")
      .notNull()
      .references(() => npcs.id, { onDelete: "cascade" }),
    tab: text("tab").notNull(), // "cron" | "cards"
    seenAt: text("seen_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    // 카드 탭용. KanbanTask 에 updated_at 이 없어 시각 워터마크를 쓸 수 없다.
    seenIds: text("seen_ids"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.npcId, t.tab] })],
);
