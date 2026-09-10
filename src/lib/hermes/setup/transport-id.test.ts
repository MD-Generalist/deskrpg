import test from "node:test";
import assert from "node:assert/strict";
import { isManagedSshUrl } from "./transport-id";
test("reject reserved SSH targets regardless of casing, credentials, path or trailing DNS dot", () => {
  for (const url of [
    "http://abc.deskrpg-ssh.invalid",
    "http://ABC.DESKRPG-SSH.INVALID./p/alice",
    "http://user:pass@abc.deskrpg-ssh.invalid:80/health",
    "http://%61bc.deskrpg-ssh.invalid",
  ])
    assert.equal(isManagedSshUrl(url), true, url);
  for (const url of [
    "https://example.com",
    "http://localhost:8642",
    "not-url",
    null,
    "http://abc.deskrpg-ssh.invalid.example.com",
  ])
    assert.equal(isManagedSshUrl(url), false, String(url));
});
