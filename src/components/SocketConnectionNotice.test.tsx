import "../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/lib/i18n";
import SocketConnectionNotice from "./SocketConnectionNotice";

class FakeSocket extends EventEmitter {
  connected = true;
  attempts = 0;
  connect() {
    this.attempts++;
    return this;
  }
}

test("disconnect survives toast expiry; retry does not imply recovery; connect removes notice", async () => {
  const socket = new FakeSocket();
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(
        <I18nProvider initialLocale="ko">
          <SocketConnectionNotice socket={socket} />
        </I18nProvider>,
      ),
    );
    assert.equal(el.textContent, "");
    await act(async () => {
      socket.connected = false;
      socket.emit("disconnect");
    });
    assert.ok(el.querySelector('[role="alert"]'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 4100));
    });
    assert.match(el.textContent!, /연결이 끊어졌습니다/);
    await act(async () => el.querySelector("button")!.click());
    assert.equal(socket.attempts, 1);
    assert.ok(el.querySelector('[role="status"]'), "retry must not claim successful connection");
    await act(async () => {
      socket.emit("connect_error");
    });
    assert.ok(el.querySelector('[role="alert"]'));
    await act(async () => {
      socket.connected = true;
      socket.emit("connect");
    });
    assert.equal(el.textContent, "");
  } finally {
    await act(async () => root.unmount());
    el.remove();
  }
  for (const event of ["connect", "disconnect", "connect_error"])
    assert.equal(socket.listenerCount(event), 0);
});
