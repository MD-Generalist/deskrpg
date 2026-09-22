import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/lib/i18n";
import TaskEditorDialog from "./TaskEditorDialog";
import { EMPTY_TASK_FORM } from "./kanban-view-model";

test("대화 등록은 완료 조건과 담당 확인 후 원문을 보존해 제출한다", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const bodies: Record<string, unknown>[] = [];
  try {
    await act(async () =>
      root.render(
        <I18nProvider initialLocale="ko">
          <TaskEditorDialog
            mode="create"
            initial={{
              ...EMPTY_TASK_FORM,
              title: "안내",
              body: "원래 요청과 답변",
              assigneeNpcId: "n1",
            }}
            npcs={[{ npcId: "n1", npcName: "직원", profileName: "worker", active: true }]}
            candidates={[]}
            serverError={null}
            submitting={false}
            confirmChatDraft
            onSubmit={(body) => bodies.push(body)}
            onClose={() => {}}
          />
        </I18nProvider>,
      ),
    );
    const form = host.querySelector("form")!;
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    assert.equal(bodies.length, 0, "완료 조건이 없으면 제출하지 않는다");
    const criteria = host.querySelector<HTMLTextAreaElement>("#kanban-completion-criteria");
    assert.ok(criteria);
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(
        criteria,
        "담당자와 마감일을 포함한 세 문장",
      );
      criteria.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    assert.equal(bodies.length, 1);
    assert.match(String(bodies[0].body), /원래 요청과 답변/);
    assert.match(String(bodies[0].body), /담당자와 마감일을 포함한 세 문장/);
    assert.equal(bodies[0].assignee, "n1");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
