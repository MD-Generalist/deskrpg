"use strict";

/**
 * `deskrpg reset-password` 의 SQLite 쪽 본체다. CLI(bin/deskrpg.js)는 큰 JS 한 덩어리라
 * 테스트가 닿지 않으므로, DB 를 실제로 건드리는 부분만 여기로 떼어 낸다.
 *
 * 비밀번호 평문은 여기까지 오지 않는다 — 호출자가 해시해서 넘긴다.
 */
function resetSqliteUserPassword(db, loginId, passwordHash) {
  const columns = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .map((column) => column.name);
  if (!columns.includes("must_change_password")) {
    throw new Error(
      "users.must_change_password 가 없습니다. 먼저 `deskrpg start` 로 한 번 부팅해 스키마를 올리세요.",
    );
  }

  const user = db
    .prepare("SELECT id, login_id, nickname FROM users WHERE login_id = ?")
    .get(loginId);
  if (!user) return null;

  db.prepare(
    "UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?",
  ).run(passwordHash, new Date().toISOString(), user.id);

  return { id: user.id, loginId: user.login_id, nickname: user.nickname };
}

module.exports = { resetSqliteUserPassword };
