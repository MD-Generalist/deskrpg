import assert from "node:assert/strict";
import { describe, it } from "node:test";

import en from "@/lib/i18n/locales/en";
import ja from "@/lib/i18n/locales/ja";
import ko from "@/lib/i18n/locales/ko";
import zh from "@/lib/i18n/locales/zh";

import {
  WIZARD_ERROR_CODES,
  WIZARD_ERROR_MESSAGE_KEYS,
  getWizardErrorMessage,
  isWizardErrorCode,
  wizardErrorMessageKey,
} from "./wizard-error-codes";

// 이 테스트가 막는 구멍: `src/lib/i18n/error-codes.test.ts` 의 "every error code a
// route emits is registered" 가드는 라우트 소스의 **리터럴** `errorCode: "..."` 만
// 정규식으로 훑는다. 플러그인 프록시 라우트는 `res.failure.code` 를 그대로 실어
// 보내는 동적 값이라 그 가드의 시야 밖이다 — 번역이 없어도 조용히 통과한다.
describe("wizard-error-codes — 4개 로케일 커버리지", () => {
  it("등록된 모든 코드가 4개 로케일 전부에 문구를 갖는다", () => {
    const locales: Array<[string, Record<string, string>]> = [
      ["ko", ko],
      ["en", en],
      ["ja", ja],
      ["zh", zh],
    ];
    const missing: string[] = [];
    for (const code of WIZARD_ERROR_CODES) {
      const key = WIZARD_ERROR_MESSAGE_KEYS[code];
      for (const [lang, dict] of locales) {
        if (!dict[key]) missing.push(`${lang}: ${key} (${code})`);
      }
    }
    assert.deepEqual(missing, [], `번역이 없는 마법사 에러코드:\n  ${missing.join("\n  ")}`);
  });

  it("unknown fallback 키도 4개 로케일 전부에 있다", () => {
    const locales: Array<[string, Record<string, string>]> = [
      ["ko", ko],
      ["en", en],
      ["ja", ja],
      ["zh", zh],
    ];
    for (const [lang, dict] of locales) {
      assert.ok(dict["hermes.wizard.error.unknown"], `${lang} 에 unknown fallback 이 없습니다`);
    }
  });

  it("미등록 코드는 unknown 으로 접힌다", () => {
    assert.equal(isWizardErrorCode("something_never_registered"), false);
    assert.equal(
      wizardErrorMessageKey("something_never_registered"),
      "hermes.wizard.error.unknown",
    );
    assert.equal(wizardErrorMessageKey(null), "hermes.wizard.error.unknown");
    assert.equal(wizardErrorMessageKey(undefined), "hermes.wizard.error.unknown");
  });

  it("등록된 코드는 안정적인 키로 매핑된다", () => {
    assert.equal(
      wizardErrorMessageKey("profile_has_service"),
      "hermes.wizard.error.profileHasService",
    );
    assert.equal(
      wizardErrorMessageKey("revision_conflict"),
      "hermes.wizard.error.revisionConflict",
    );
    assert.equal(
      wizardErrorMessageKey("identity_unreadable"),
      "hermes.wizard.error.identityUnreadable",
    );
  });

  it("getWizardErrorMessage 는 t() 로 번역된 문구를 돌려준다", () => {
    const t = (key: string) => ko[key] ?? key;
    assert.equal(
      getWizardErrorMessage(t, "already_exists"),
      ko["hermes.wizard.error.alreadyExists"],
    );
    assert.equal(getWizardErrorMessage(t, "totally_unknown"), ko["hermes.wizard.error.unknown"]);
  });
});

describe("결함 8 — revision_mismatch 는 revision_conflict 와 같은 문구를 가리킨다", () => {
  // 스펙은 `revision_conflict` 라고 적었지만 플러그인은 `revision_mismatch` 를 낸다
  // (team-lead 라이브 실측, deskrpg_plugin/identity.py:142). 플러그인을 고치면 구버전
  // 게이트웨이가 깨지므로 두 코드를 모두 등록해 같은 키를 가리키게 한다.
  it("두 코드가 동일한 번역 키로 매핑된다", () => {
    assert.equal(
      wizardErrorMessageKey("revision_mismatch"),
      wizardErrorMessageKey("revision_conflict"),
    );
    assert.equal(
      wizardErrorMessageKey("revision_mismatch"),
      "hermes.wizard.error.revisionConflict",
    );
  });

  it("WIZARD_ERROR_CODES 목록에 실제로 등록돼 있다", () => {
    assert.ok(
      (WIZARD_ERROR_CODES as readonly string[]).includes("revision_mismatch"),
      "revision_mismatch 가 목록에 없으면 신버전 플러그인의 409 가 unknown 으로 접힌다",
    );
  });
});
