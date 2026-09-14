-- Read-only PostgreSQL snapshot. Supply the public fixture as fixture_b64.
-- Run with psql -X -A -t -v ON_ERROR_STOP=1; redirect output to a private file.
-- Only identifiers, map-state summaries, counts and hashes leave the database.
-- chat_messages has no soft-delete column: include every persisted NPC-history row.
-- Shared rows are global, so even currently unbound/unassigned records are protected.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object(
  'kind', 'global',
  'usersCount', (SELECT count(*) FROM users),
  'usersHash', (SELECT md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM users t),
  'profilesCount', (SELECT count(*) FROM hermes_profiles),
  'profilesHash', (SELECT md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM hermes_profiles t),
  'gatewaysCount', (SELECT count(*) FROM gateway_resources),
  'gatewaysHash', (SELECT md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM gateway_resources t),
  'gatewaySharesCount', (SELECT count(*) FROM gateway_shares),
  'gatewaySharesHash', (SELECT md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM gateway_shares t),
  'groupsCount', (SELECT count(*) FROM groups),
  'groupsHash', (SELECT md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM groups t),
  'groupMembersCount', (SELECT count(*) FROM group_members),
  'groupMembersHash', (SELECT md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM group_members t),
  'charactersCount', (SELECT count(*) FROM characters),
  'charactersHash', (SELECT md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM characters t)
);
SELECT jsonb_build_object(
  'kind', 'channel', 'channelId', c.id,
  'eligibleV2', c.map_data = convert_from(decode(:'fixture_b64', 'base64'), 'UTF8')::jsonb,
  'width', c.map_data->'width', 'height', c.map_data->'height',
  'environmentVersion', jsonb_path_query_first(c.map_data, '$.layers[*].properties[*] ? (@.name == "officeEnvironmentVersion").value'),
  'mapHash', md5(coalesce(c.map_data::text, 'null')),
  'updatedAt', c.updated_at,
  'nonMapHash', md5((to_jsonb(c) - ARRAY['map_data', 'updated_at'])::text),
  'gatewayConfigHash', md5(coalesce(c.gateway_config::text, 'null')),
  'membersCount', (SELECT count(*) FROM channel_members m WHERE m.channel_id = c.id),
  'membersHash', (SELECT md5(coalesce(string_agg(to_jsonb(m)::text, E'\n' ORDER BY m.user_id), '')) FROM channel_members m WHERE m.channel_id = c.id),
  'bindingsCount', (SELECT count(*) FROM channel_gateway_bindings b WHERE b.channel_id = c.id),
  'bindingsHash', (SELECT md5(coalesce(string_agg(to_jsonb(b)::text, E'\n' ORDER BY b.id), '')) FROM channel_gateway_bindings b WHERE b.channel_id = c.id),
  'npcsCount', (SELECT count(*) FROM npcs n WHERE n.channel_id = c.id),
  'npcsHash', (SELECT md5(coalesce(string_agg(to_jsonb(n)::text, E'\n' ORDER BY n.id), '')) FROM npcs n WHERE n.channel_id = c.id),
  'roomsCount', (SELECT count(*) FROM chat_rooms r WHERE r.channel_id = c.id),
  'roomsHash', (SELECT md5(coalesce(string_agg(to_jsonb(r)::text, E'\n' ORDER BY r.id), '')) FROM chat_rooms r WHERE r.channel_id = c.id),
  'roomMembersCount', (SELECT count(*) FROM chat_room_members m JOIN chat_rooms r ON r.id = m.room_id WHERE r.channel_id = c.id),
  'roomMembersHash', (SELECT md5(coalesce(string_agg(to_jsonb(m)::text, E'\n' ORDER BY m.room_id, m.member_kind, m.member_id), '')) FROM chat_room_members m JOIN chat_rooms r ON r.id = m.room_id WHERE r.channel_id = c.id),
  'npcMessagesCount', (SELECT count(*) FROM chat_messages m JOIN npcs n ON n.id = m.npc_id WHERE n.channel_id = c.id),
  'npcMessagesHash', (SELECT md5(coalesce(string_agg(to_jsonb(m)::text, E'\n' ORDER BY m.id), '')) FROM chat_messages m JOIN npcs n ON n.id = m.npc_id WHERE n.channel_id = c.id),
  'messagesCount', (SELECT count(*) FROM chat_room_messages m JOIN chat_rooms r ON r.id = m.room_id WHERE r.channel_id = c.id),
  'messagesHash', (SELECT md5(coalesce(string_agg(to_jsonb(m)::text, E'\n' ORDER BY m.id), '')) FROM chat_room_messages m JOIN chat_rooms r ON r.id = m.room_id WHERE r.channel_id = c.id)
) FROM channels c ORDER BY c.id;
COMMIT;
