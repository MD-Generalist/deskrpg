-- Read-only schema/bootstrap evidence; run before and after the schema-only boot.
-- Supply the public canonical map as fixture_b64. No row contents leave PostgreSQL.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object(
  'kind', 'bootstrap',
  'gatewayPluginInfoColumn', EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('gateway_resources') AND attname = 'plugin_info_json' AND NOT attisdropped),
  'roomNoticeColumn', EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('chat_room_messages') AND attname = 'notice_json' AND NOT attisdropped),
  'channelKanbanBoardsTable', to_regclass('channel_kanban_boards') IS NOT NULL,
  'cronJobOriginsTable', to_regclass('cron_job_origins') IS NOT NULL,
  'legacyTasksAbsent', to_regclass('tasks') IS NULL,
  'legacyNpcReportsAbsent', to_regclass('npc_reports') IS NULL,
  'channelsCount', count(*),
  'exactV2Count', count(*) FILTER (WHERE c.map_data = convert_from(decode(:'fixture_b64', 'base64'), 'UTF8')::jsonb),
  'version2Count', count(*) FILTER (WHERE jsonb_path_query_first(c.map_data, '$.layers[*].properties[*] ? (@.name == "officeEnvironmentVersion").value') = '2'::jsonb),
  'version3Count', count(*) FILTER (WHERE jsonb_path_query_first(c.map_data, '$.layers[*].properties[*] ? (@.name == "officeEnvironmentVersion").value') = '3'::jsonb),
  'otherVersionCount', count(*) FILTER (WHERE coalesce(jsonb_path_query_first(c.map_data, '$.layers[*].properties[*] ? (@.name == "officeEnvironmentVersion").value') NOT IN ('2'::jsonb, '3'::jsonb), true)),
  'mapRowsHash', md5(coalesce(string_agg(jsonb_build_array(c.id, c.map_data)::text, E'\n' ORDER BY c.id), ''))
) FROM channels c;
COMMIT;
