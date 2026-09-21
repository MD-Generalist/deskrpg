// src/db/schema.ts
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  date,
  index,
  unique,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  loginId: varchar("login_id", { length: 50 }).unique().notNull(),
  nickname: varchar("nickname", { length: 50 }).unique().notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  systemRole: varchar("system_role", { length: 20 }).notNull().default("user"),
  /** 관리자·CLI 가 임시 비밀번호를 발급하면 참이 된다. 본인이 바꾸면 거짓으로 돌아간다. */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const characters = pgTable(
  "characters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 50 }).notNull(),
    appearance: jsonb("appearance").notNull(),
    /** 자유 텍스트 소개 — 직원에게 가는 모든 대화 앞머리에 붙는다(스펙 2026-09-18). 상한 2,000자는 서버가 지킨다. */
    bio: text("bio"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("idx_characters_user_id").on(table.userId)],
);

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 100 }).unique().notNull(),
  description: varchar("description", { length: 500 }),
  isDefault: boolean("is_default").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  description: varchar("description", { length: 500 }),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
  mapData: jsonb("map_data"),
  mapConfig: jsonb("map_config"),
  isPublic: boolean("is_public").default(true),
  inviteCode: varchar("invite_code", { length: 20 }).unique(),
  maxPlayers: integer("max_players").default(50),
  password: varchar("password", { length: 255 }),
  gatewayConfig: jsonb("gateway_config"),
  /** NPC 걸음 속도(`npc-motion-config`). 비어 있으면 기본값 — 채널 공유 설정이다. */
  motionConfig: jsonb("motion_config"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const gatewayResources = pgTable(
  "gateway_resources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    baseUrl: text("base_url").notNull(),
    tokenEncrypted: text("token_encrypted").notNull(),
    pairedDeviceId: text("paired_device_id"),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    lastValidationStatus: varchar("last_validation_status", { length: 40 }),
    lastValidationError: text("last_validation_error"),
    localDiscoveryOptedInAt: timestamp("local_discovery_opted_in_at", { withTimezone: true }),
    localDiscoveryOptedInBy: uuid("local_discovery_opted_in_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // `GET /deskrpg/info` 판정 캐시. 매 화면 진입마다 원격을 찌르지 않기 위한 것이고,
    // 게이트웨이 테스트·편집 때 갱신된다. `plugin_status` 값은
    // src/lib/hermes/plugin-capability.ts 의 PluginStatus 와 같은 문자열이다.
    // pluginStatus 는 lastValidationStatus 와 같은 짧은 열거형 문자열이라 varchar(40) 을,
    // pluginCheckedAt 은 lastValidatedAt 과 같은 타임스탬프 열이라 같은 타입을 따른다.
    pluginStatus: varchar("plugin_status", { length: 40 }),
    pluginVersion: text("plugin_version"),
    pluginCheckedAt: timestamp("plugin_checked_at", { withTimezone: true }),
    // `GET /deskrpg/info` 응답 본문 캐시(JSON 문자열). plugin_status·plugin_version 은 판정 요약이고,
    // 칸반·cron 같은 세부 기능 지원 여부는 이 원문에서 읽는다.
    pluginInfoJson: text("plugin_info_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("idx_gateway_resources_owner_user_id").on(table.ownerUserId)],
);

export const gatewayShares = pgTable(
  "gateway_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gatewayId: uuid("gateway_id")
      .notNull()
      .references(() => gatewayResources.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 32 }).notNull().default("use"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_gateway_shares_gateway_id").on(table.gatewayId),
    index("idx_gateway_shares_user_id").on(table.userId),
    uniqueIndex("gateway_shares_gateway_user_idx").on(table.gatewayId, table.userId),
  ],
);

export const hermesProfiles = pgTable(
  "hermes_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gatewayId: uuid("gateway_id")
      .notNull()
      .references(() => gatewayResources.id, { onDelete: "cascade" }),
    profileName: varchar("profile_name", { length: 120 }).notNull(),
    tokenEncrypted: text("token_encrypted").notNull(),
    displayName: varchar("display_name", { length: 120 }),
    description: text("description"),
    /** 캐릭터 외형. NPC 의 정본이다 — npcs.appearance 는 이번 릴리스에 남기지만 쓰지 않는다. */
    appearance: jsonb("appearance"),
    provisionedByDeskrpg: boolean("provisioned_by_deskrpg").notNull().default(false),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    lastValidationStatus: varchar("last_validation_status", { length: 40 }),
    lastValidationError: text("last_validation_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_hermes_profiles_gateway_id").on(table.gatewayId),
    uniqueIndex("hermes_profiles_gateway_name_idx").on(table.gatewayId, table.profileName),
  ],
);

export const providerResources = pgTable(
  "provider_resources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerType: varchar("provider_type", { length: 20 }).notNull(),
    displayName: varchar("display_name", { length: 120 }),
    authMethod: varchar("auth_method", { length: 20 }).notNull(),
    credentialsEncrypted: text("credentials_encrypted"),
    baseUrl: text("base_url"),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    lastValidationStatus: varchar("last_validation_status", { length: 40 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("idx_provider_resources_owner").on(table.ownerUserId)],
);

export const providerShares = pgTable(
  "provider_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providerResources.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 10 }).notNull().default("use"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_provider_shares_provider").on(table.providerId),
    uniqueIndex("provider_shares_provider_user_idx").on(table.providerId, table.userId),
  ],
);

export const channelGatewayBindings = pgTable(
  "channel_gateway_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    gatewayId: uuid("gateway_id")
      .notNull()
      .references(() => gatewayResources.id, { onDelete: "cascade" }),
    boundByUserId: uuid("bound_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    boundAt: timestamp("bound_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_channel_gateway_bindings_gateway_id").on(table.gatewayId),
    uniqueIndex("channel_gateway_bindings_channel_idx").on(table.channelId),
  ],
);

// 채널 ↔ Hermes 칸반 보드 연결 장부. 채널마다 보드 하나라 channel_id 가 곧 PK 다.
// event_cursor 는 마지막으로 소비한 보드 이벤트 위치, last_error 는 마지막 폴링 실패 사유.
// 보드 이름은 Hermes 쪽이 정본이고 board_name_synced_at 은 그것을 마지막으로 맞춘 시각이다.
export const channelKanbanBoards = pgTable(
  "channel_kanban_boards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    gatewayId: uuid("gateway_id")
      .notNull()
      .references(() => gatewayResources.id, { onDelete: "cascade" }),
    boardSlug: varchar("board_slug", { length: 64 }).notNull(),
    isEventCarrier: boolean("is_event_carrier").notNull().default(false),
    boardNameSyncedAt: timestamp("board_name_synced_at", { withTimezone: true }),
    eventCursor: text("event_cursor"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
export const cronJobOrigins = pgTable(
  "cron_job_origins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gatewayId: uuid("gateway_id")
      .notNull()
      .references(() => gatewayResources.id, { onDelete: "cascade" }),
    profileName: varchar("profile_name", { length: 120 }).notNull(),
    jobId: varchar("job_id", { length: 120 }).notNull(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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

export const groupMembers = pgTable(
  "group_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull().default("member"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_group_members_group_id").on(table.groupId),
    index("idx_group_members_user_id").on(table.userId),
    unique("group_members_group_user_unique").on(table.groupId, table.userId),
  ],
);

export const groupInvites = pgTable(
  "group_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 64 }).unique().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    targetLoginId: varchar("target_login_id", { length: 50 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_group_invites_group_id").on(table.groupId),
    index("idx_group_invites_target_user_id").on(table.targetUserId),
  ],
);

export const groupJoinRequests = pgTable(
  "group_join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    message: text("message"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_group_join_requests_group_id").on(table.groupId),
    index("idx_group_join_requests_user_id").on(table.userId),
    unique("group_join_requests_group_user_unique").on(table.groupId, table.userId),
  ],
);

export const groupPermissions = pgTable(
  "group_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    permissionKey: varchar("permission_key", { length: 50 }).notNull(),
    effect: varchar("effect", { length: 10 }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_group_permissions_group_id").on(table.groupId),
    unique("group_permissions_group_permission_unique").on(table.groupId, table.permissionKey),
  ],
);

export const userPermissionOverrides = pgTable(
  "user_permission_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissionKey: varchar("permission_key", { length: 50 }).notNull(),
    effect: varchar("effect", { length: 10 }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
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

export const channelMembers = pgTable(
  "channel_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull().default("member"),
    lastX: integer("last_x"),
    lastY: integer("last_y"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_channel_members_channel_id").on(table.channelId),
    index("idx_channel_members_user_id").on(table.userId),
    unique("channel_members_channel_user_unique").on(table.channelId, table.userId),
  ],
);

export const npcs = pgTable(
  "npcs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }),
    positionX: integer("position_x"),
    positionY: integer("position_y"),
    direction: varchar("direction", { length: 10 }).default("down"),
    appearance: jsonb("appearance"),
    adapterType: varchar("adapter_type", { length: 20 }).notNull().default("hermes"),
    adapterConfig: jsonb("adapter_config"),
    hermesProfileId: uuid("hermes_profile_id")
      .notNull()
      .references(() => hermesProfiles.id, { onDelete: "cascade" }),
    agentConfig: jsonb("agent_config"),
    /** 이 채널에 출근 중인가. false 면 자리는 기억한 채 맵에서 빠진다. */
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_npcs_channel_id").on(table.channelId),
    unique("npcs_channel_position_unique").on(table.channelId, table.positionX, table.positionY),
    uniqueIndex("npcs_channel_profile_idx").on(table.channelId, table.hermesProfileId),
  ],
);

export const npcSessions = pgTable(
  "npc_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    npcId: uuid("npc_id")
      .notNull()
      .references(() => npcs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    adapterType: varchar("adapter_type", { length: 20 }).notNull(),
    sessionType: varchar("session_type", { length: 20 }).notNull(),
    sessionRef: varchar("session_ref", { length: 200 }).notNull(),
    contextKey: varchar("context_key", { length: 200 }).notNull(),
    lastSummary: text("last_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id),
    npcId: uuid("npc_id")
      .notNull()
      .references(() => npcs.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 10 }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_chat_messages_lookup").on(table.characterId, table.npcId, table.createdAt),
  ],
);

export const chatRooms = pgTable(
  "chat_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 10 }).notNull(), // "office" | "group"
    name: varchar("name", { length: 60 }).notNull(),
    replyPolicy: varchar("reply_policy", { length: 10 }).notNull(), // "mention" | "members"
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_chat_rooms_channel").on(t.channelId, t.lastMessageAt),
    uniqueIndex("uq_chat_rooms_office_per_channel")
      .on(t.channelId)
      .where(sql`kind = 'office'`),
  ],
);

export const chatRoomMembers = pgTable(
  "chat_room_members",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    memberKind: varchar("member_kind", { length: 8 }).notNull(), // "user" | "npc"
    memberId: uuid("member_id").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.memberKind, t.memberId] })],
);

export const chatRoomMessages = pgTable(
  "chat_room_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    senderKind: varchar("sender_kind", { length: 8 }).notNull(), // "user" | "npc" | "system"
    senderId: uuid("sender_id"),
    senderName: varchar("sender_name", { length: 100 }).notNull(),
    content: text("content").notNull(),
    // 시스템 메시지의 구조화 페이로드(JSON 문자열). 칸반 카드 이동·cron 결과 같은 알림이
    // 본문(content) 과 별도로 카드 렌더링에 쓸 데이터를 여기 담는다. 일반 메시지는 NULL.
    noticeJson: text("notice_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_chat_room_messages_room").on(t.roomId, t.createdAt)],
);

export const meetingMinutes = pgTable(
  "meeting_minutes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    transcript: text("transcript").notNull(),
    participants: jsonb("participants").notNull().default([]),
    totalTurns: integer("total_turns").notNull().default(0),
    durationSeconds: integer("duration_seconds"),
    initiatorId: uuid("initiator_id").references(() => users.id, { onDelete: "set null" }),
    keyTopics: jsonb("key_topics").notNull().default([]),
    conclusions: text("conclusions"),
    // 구조화된 회의 결과(결정·후속 업무·프로젝트 권고). 초안이지 카드 사본이 아니다.
    outcomeJson: jsonb("outcome_json"),
    summaryStatus: text("summary_status").notNull().default("ok"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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

export const channelProjects = pgTable(
  "channel_projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boardLinkId: uuid("board_link_id")
      .notNull()
      .unique()
      .references(() => channelKanbanBoards.id, { onDelete: "cascade" }),
    // 채널별 목록 질의를 조인 없이 하려고 둔 비정규화. 연결 행의 채널과 늘 같다.
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 24 }).notNull().default("planned"),
    leadNpcId: uuid("lead_npc_id").references(() => npcs.id, { onDelete: "set null" }),
    targetDate: date("target_date"),
    color: varchar("color", { length: 16 }),
    icon: varchar("icon", { length: 40 }),
    // 일시정지는 상태가 아니라 이 칸이 채워진 in_progress 다(Paperclip 과 같은 취급).
    pauseReason: text("pause_reason"),
    originMeetingId: uuid("origin_meeting_id").references(() => meetingMinutes.id, {
      onDelete: "set null",
    }),
    /** 결정 C-1 — 자리만 열어 둔다. 이 설계는 읽지도 쓰지도 않는다. */
    hermesProjectId: varchar("hermes_project_id", { length: 64 }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("idx_channel_projects_channel").on(table.channelId)],
);

export const channelSubprojects = pgTable(
  "channel_subprojects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => channelProjects.id, { onDelete: "cascade" }),
    /**
     * Hermes `tasks.tenant` 에 그대로 들어가는 값. **만든 뒤 절대 바꾸지 않는다** — 디스패처가
     * 작업자에게 `HERMES_TENANT` 를 넘기고 자식 카드가 그것을 상속하므로, 값이 바뀌면 이미
     * 만들어진 카드들이 고아가 된다. 표시 이름을 바꾸고 싶으면 `name` 만 바꾼다.
     */
    tenantSlug: varchar("tenant_slug", { length: 64 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 24 }).notNull().default("planned"),
    leadNpcId: uuid("lead_npc_id").references(() => npcs.id, { onDelete: "set null" }),
    targetDate: date("target_date"),
    color: varchar("color", { length: 16 }),
    icon: varchar("icon", { length: 40 }),
    pauseReason: text("pause_reason"),
    originMeetingId: uuid("origin_meeting_id").references(() => meetingMinutes.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("channel_subprojects_project_tenant_idx").on(table.projectId, table.tenantSlug),
  ],
);

/**
 * 실행 전 승인 관문의 레코드(설계 2026-09-21 execution-approval-gate).
 *
 * 하드 게이트 1 에 걸리지 않는다 — `approval_targets.task_id` 는 Hermes 카드를 **가리키기만**
 * 하고 제목·본문·상태를 복제하지 않는다. `channel_kanban_boards` 와 같은 성격이다.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    // "task_execution" | "project_registration" | … — 덩어리 1 이 같은 표를 type 만 달리해 쓴다.
    type: varchar("type", { length: 32 }).notNull(),
    // "pending" | "approved" | "rejected" | "revision_requested" | "cancelled"
    status: varchar("status", { length: 24 }).notNull(),
    /** 요청한 프로필 이름(직원). 사용자 id 가 아니다. */
    requestedBy: varchar("requested_by", { length: 64 }).notNull(),
    /** 로케일 무관 요약. 문장은 보는 사람의 언어로 화면이 만든다. */
    title: text("title").notNull(),
    /** {kind:"meeting"|"manual"|"chat_proposal", id} — 승인이 필요한지를 가른 출처. */
    sourceJson: text("source_json").notNull(),
    payloadJson: text("payload_json"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("approvals_channel_status_idx").on(t.channelId, t.status)],
);

export const approvalTargets = pgTable(
  "approval_targets",
  {
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => approvals.id, { onDelete: "cascade" }),
    /** Hermes 카드 id. FK 가 아니다 — 정본은 Hermes 다. */
    taskId: varchar("task_id", { length: 64 }).notNull(),
    /** 부분 승인용. null 이면 승인 전체의 결정을 따른다. */
    decision: varchar("decision", { length: 16 }),
  },
  (t) => [
    primaryKey({ columns: [t.approvalId, t.taskId] }),
    index("approval_targets_task_idx").on(t.taskId),
  ],
);

// 직원 패널의 탭별 열람 상태. 카드·크론 정본은 Hermes 에 있고 여기엔 "어디까지 봤는가" 만 둔다.
export const npcPanelReads = pgTable(
  "npc_panel_reads",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    npcId: uuid("npc_id")
      .notNull()
      .references(() => npcs.id, { onDelete: "cascade" }),
    tab: varchar("tab", { length: 8 }).notNull(), // "cron" | "cards"
    seenAt: timestamp("seen_at", { withTimezone: true }).defaultNow().notNull(),
    // 카드 탭용. KanbanTask 에 updated_at 이 없어 시각 워터마크를 쓸 수 없다.
    // 읽을 때마다 현재 담당 카드와 교집합으로 가지쳐 크기를 담당 카드 수로 묶는다.
    seenIds: text("seen_ids"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.npcId, t.tab] })],
);
