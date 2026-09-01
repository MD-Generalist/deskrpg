ALTER TABLE "gateway_resources" ADD COLUMN IF NOT EXISTS "plugin_status" varchar(40);
ALTER TABLE "gateway_resources" ADD COLUMN IF NOT EXISTS "plugin_version" text;
ALTER TABLE "gateway_resources" ADD COLUMN IF NOT EXISTS "plugin_checked_at" timestamp with time zone;
