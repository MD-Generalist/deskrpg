import assert from "node:assert/strict";
import test from "node:test";
import { decideChatError } from "./chat-error-dispatch";

test("not_joined → request a rejoin, do not go to the list", () => {
  assert.deepEqual(decideChatError({ roomId: "r1", code: "not_joined" }), {
    toastKey: "game.room.error.not_joined",
    rejoin: true,
    backToList: false,
  });
});

test("not_found and forbidden send you back to the list — that room can no longer be seen", () => {
  for (const code of ["not_found", "forbidden"]) {
    assert.deepEqual(
      decideChatError({ code }),
      { toastKey: `game.room.error.${code}`, rejoin: false, backToList: true },
      code,
    );
  }
});

test("other codes only toast — the screen does not move", () => {
  for (const code of ["not_open", "empty", "cooldown", "invalid"]) {
    assert.deepEqual(
      decideChatError({ code }),
      { toastKey: `game.room.error.${code}`, rejoin: false, backToList: false },
      code,
    );
  }
});

test("unknown codes give a generic failure toast, with neither rejoin nor navigation", () => {
  const generic = { toastKey: "game.channelChatFailed", rejoin: false, backToList: false };
  assert.deepEqual(decideChatError({ code: "weird" }), generic);
  assert.deepEqual(decideChatError(null), generic);
  assert.deepEqual(decideChatError({}), generic);
});

test("skill-chip refusals toast the shared wording for their code and do not move the screen", () => {
  assert.deepEqual(decideChatError({ code: "skill_requires_single_mention" }), {
    toastKey: "errors.skillRequiresSingleMention",
    rejoin: false,
    backToList: false,
  });
  assert.equal(decideChatError({ code: "too_many_skills" }).toastKey, "errors.tooManySkills");
  assert.equal(decideChatError({ code: "skill_disabled" }).toastKey, "errors.skillDisabled");
  assert.equal(
    decideChatError({ code: "plugin_update_required" }).toastKey,
    "errors.pluginUpdateRequired",
  );
  assert.equal(decideChatError({ code: "plugin_not_loaded" }).toastKey, "errors.pluginNotLoaded");
  assert.equal(decideChatError({ code: "gateway_unreachable" }).toastKey, "npc.gatewayUnreachable");
  assert.equal(decideChatError({ code: "made_up" }).toastKey, "game.channelChatFailed");
});
