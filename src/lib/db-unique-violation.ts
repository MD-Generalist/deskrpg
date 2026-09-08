/**
 * unique 제약 위반인가.
 *
 * PostgreSQL 은 SQLSTATE 23505 를, better-sqlite3 는 `SQLITE_CONSTRAINT_UNIQUE`
 * (또는 `_PRIMARYKEY`)를 던진다. **둘 다** 봐야 한다 — pg 코드만 보던 탓에 SQLite
 * 배포에서는 타일 중복이 409 가 아니라 500 으로 나갔고, 그 409 를 기다리던 클라이언트
 * 분기가 한 번도 돌지 않은 적이 있다.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return (
    code === "23505" ||
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    code === "SQLITE_CONSTRAINT_PRIMARYKEY"
  );
}
