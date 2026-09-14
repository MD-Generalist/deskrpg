import { createHash } from "node:crypto";
import { and, eq, isNull, sql, type AnyColumn } from "drizzle-orm";
/** PostgreSQL Date decoding loses microseconds. Keep the database epoch as text;
 * unlike timestamptz::text this token is independent of the session timezone. */
export function channelRowRevisionExpression(updatedAt: AnyColumn, postgres: boolean) {
  return postgres
    ? sql<string | null>`extract(epoch from ${updatedAt})::text`
    : sql<string | null>`${updatedAt}`;
}
export function mapUpgradeCondition(
  columns: { id: AnyColumn; mapData: AnyColumn; updatedAt: AnyColumn },
  selected: { id: string; mapData: unknown; rowRevision: string | null },
  postgres: boolean,
) {
  const revision = channelRowRevisionExpression(columns.updatedAt, postgres);
  return and(
    eq(columns.id, selected.id),
    selected.rowRevision === null ? isNull(revision) : eq(revision, selected.rowRevision),
    eq(columns.mapData, selected.mapData),
  );
}

/** Runtime admission follows persisted map content, not channel metadata writes.
 * Canonical object ordering gives PostgreSQL jsonb and SQLite JSON the same token.
 * Arrays retain order, so tile/object edits always change the token. */
export function mapContentRevision(mapData: unknown): string {
  let value = mapData;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      /* Invalid persisted JSON still gets a distinct token. */
    }
  }
  const canonical =
    JSON.stringify(value, (_key, item: unknown) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : item,
    ) ?? "null";
  return "map-sha256:" + createHash("sha256").update(canonical).digest("hex");
}
