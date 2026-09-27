import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyGatewayHost,
  composePluginUpdateCommand,
  composeServiceHost,
} from "./gateway-host-target";

test("a loopback address is this server's host", () => {
  assert.deepEqual(classifyGatewayHost("http://127.0.0.1:8642"), { mode: "local", port: 8642 });
  assert.deepEqual(classifyGatewayHost("http://localhost:8642/"), { mode: "local", port: 8642 });
});

test("an SSH-registered address must recover its host id — here we only classify it as ssh", () => {
  const url = `http://${"a".repeat(64)}.deskrpg-ssh.invalid`;
  assert.deepEqual(classifyGatewayHost(url), { mode: "ssh" });
});

test("any other address is not a host we can manage", () => {
  // Common in container deployments — Hermes lives on the host and we cannot run on that host.
  assert.deepEqual(classifyGatewayHost("http://host.docker.internal:8642"), {
    mode: "unsupported",
  });
  assert.deepEqual(classifyGatewayHost("https://hermes.example.com"), { mode: "unsupported" });
  assert.deepEqual(classifyGatewayHost("not a url"), { mode: "unsupported" });
});

test("no port means not local — a gateway always has a port", () => {
  assert.deepEqual(classifyGatewayHost("http://127.0.0.1"), { mode: "unsupported" });
});

test("a single-label hostname is a Compose service Hermes; hosts, IPs and loopback are not", () => {
  assert.equal(composeServiceHost("http://hermes:8642"), "hermes");
  assert.equal(composeServiceHost("http://hermes-agent:8642/"), "hermes-agent");
  for (const url of [
    "http://host.docker.internal:8642",
    "http://127.0.0.1:8642",
    "http://localhost:8642",
    "http://10.0.0.5:8642",
    "https://gw.example.com",
    "http://s1.deskrpg-ssh.invalid:8642",
    "not a url",
  ])
    assert.equal(composeServiceHost(url), null, url);
});

test("the Compose update command recreates the Hermes service, which re-runs the plugin one-shot first", () => {
  assert.equal(
    composePluginUpdateCommand("hermes"),
    "docker compose up -d --force-recreate hermes",
  );
});
