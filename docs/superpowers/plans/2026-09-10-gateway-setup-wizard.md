# Gateway setup wizard Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Track each deliverable and its checks here.

**Goal:** Connect local or remote Hermes and prepare the DeskRPG plugin from My Gateways.
**Architecture:** A protected setup service coordinates native/SSH executors and an API-only path. Existing gateway/profile resources hold credentials. Host setup is operator-enabled and system-admin only.
**Tech Stack:** TypeScript, Node child_process/OpenSSH, Next.js, React, Hermes CLI/Python.
**Spec:** `docs/superpowers/specs/2026-09-10-gateway-setup-wizard-design.md`

## Global constraints

No arbitrary shell commands or private keys from the browser. Fixed reviewed plugin revision. No implicit Hermes upgrades. Never return discovered tokens. Gate filesystem access before inspection. Native local means server host. Keep service restart scoped to the selected candidate. URL-only does not install missing plugins. Profile import remains gateway-owned.

## Task 1: Host preparation adapter

Files: `src/lib/hermes/setup/host.ts`, `host.test.ts`, supporting script in same folder. Shared types: `types.ts`.
Interfaces: `discoverHost(execute: HostExecutor): Promise<SetupCandidate[]>`; `inspectHost(execute, candidateId): Promise<SetupInspection>`; `prepareHost(execute, candidateId, onStep, signal): Promise<PreparedHost>`.
- [x] Write tests with temporary homes/fake executors: secrets absent from discovery, missing plugin/install failure, key reuse, profile validation, port conflict and interrupted preparation.
- [x] Run `npx tsx --test src/lib/hermes/setup/host.test.ts` before implementation, observing expected missing implementation failures.
- [x] Implement verified Hermes CLI calls and bounded structured helper output. Use immutable plugin commit `9e200eb1d2418d47c3b65a754ca111e13c5aafb4`.
- [x] Re-run tests and review helper serialization and restart ownership.

## Task 2: SSH/local execution and transport

Files: `src/lib/hermes/setup/executor.ts`, `transport.ts`, their tests; gateway client integration where necessary.
Interfaces: `localExecutor: HostExecutor`; `getSshHosts(): {id:string,label:string}[]`; `sshExecutor(hostId): HostExecutor`; `ensureSshTunnel(hostId, remotePort): Promise<string>`; persistent transport resolver for gateway clients.
- [x] Test argv injection rejection, unknown aliases, timeouts, output bounds and changed-host-key failures with fake spawn.
- [x] Implement fixed OpenSSH BatchMode/strict known-host enforcement and loopback tunnel ownership. Persist stable target identity and recreate tunnels after app restart. Do not expose server SSH configuration unless opted in.
- [x] Verify tunnel lifecycle independently with mocked processes and transport resolution coverage.

## Task 3: Protected orchestration API

Files: `src/lib/hermes/setup/service.ts`, `policy.ts`, `store.ts`, tests; `src/app/api/gateways/setup/route.ts`.
HTTP interface: GET capabilities; POST `{action:'discover',mode,hostId?}` → `{candidates}`; POST `{action:'inspect',mode,hostId?,candidateId}` → inspection; POST `{action:'prepare',mode,hostId?,candidateId}` → `{job}`; GET `?job=id` → `{job}`; POST `{action:'cancel',jobId}`; POST `{action:'connect-url',url,token,displayName}` → `{gatewayId,pluginStatus}`. Browser never receives PreparedHost.
- [x] Test `hostSetupAllowed(false,'system_admin') === false`, wrong-origin rejection, cross-user job access and safe serialization.
- [x] Implement administrator/operator gates, per-target lock, cancellation at safe boundaries, persistent sanitized progress, validated URL-only probes with redirect denial and encrypted existing resource storage.
- [x] Import host-returned profile credentials through `registerHermesProfile` only after live plugin verification; complete job only after gateway/profile writes succeed. Preserve actual step failure rather than claiming success.
- [x] Run route/policy tests and typecheck.

## Task 4: Wizard UI and integration

Files: `src/components/gateway/GatewaySetupWizard.tsx`, supporting localized copy/tests; `src/app/gateways/page.tsx`.
Props: `{onConnected:(gatewayId:string)=>void}`. Consume the HTTP contract above.
- [x] Test first choice local/remote, remote SSH/URL split, disabled local capability, stale response handling and failed jobs.
- [x] Implement discovery cards, inspect/review, install/connect action, progress/polling/cancel/retry, URL credentials and SSH fallback. Link successful gateway to `/profiles?gateway=id`.
- [x] Integrate replacing create form with wizard while preserving existing edit/share/delete controls.
- [x] Run component tests and Chrome extension verification.

## Task 5: Combined review and verification

- [x] Run focused tests, `npm run typecheck`, lint changed files and production build.
- [x] Inspect local host again; enable operator flag only in isolated preview launch. Exercise discovery/review in Chrome. Actual mutation must match displayed selected service, not an arbitrary running profile.
- [x] Review API authorization, secret handling, SSRF boundaries, subprocess ownership and restart behavior. Fix findings and re-run affected checks.
- [x] Document supported environment and remote test limitations; commit only scoped files, no deployment.

## Completion evidence

2026-09-10: 1,275 tests passed, 3 skipped, 0 failed; production build and changed-file lint passed. Chrome extension verified six local candidates, noah installation review with selected profile, remote SSH/URL split and URL credentials form. No live Hermes installation/restart or remote SSH target was executed; these environment-level checks remain explicitly unverified. Independent review findings on cancellation, loaded service identity, browser/server imports, warning handling and profile selection were resolved with regression tests.

Implementation rulings: standalone named-profile gateways are supported without enabling multiplex; cancellation is safe-boundary-only for both local and SSH; persistent SSH transports continue after host-setup flag is disabled but approved-alias removal revokes reconnect.
