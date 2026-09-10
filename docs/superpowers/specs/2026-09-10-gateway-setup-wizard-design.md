# Gateway setup wizard — design for review

Date: 2026-09-10. Status: approved and implemented on feat/ui2-frontend; actual host installation/restart remains unexecuted.

## Goal and decisions

Make `/gateways` the entry point for connecting Hermes, preparing the DeskRPG plugin, and importing gateway-scoped profiles. NPCs always derive from profiles; setup never creates an unrelated character.

Recommended approach: server-side setup orchestration with two execution adapters (native local and SSH), plus an API-only connection path. Reuse existing gateway/profile resources and encrypted token storage.

Alternatives: a separate desktop/local companion would also support a remotely hosted DeskRPG controlling the visitor's computer, but adds installation and pairing infrastructure. Instructions-only setup is simpler but does not satisfy the requested automation. The first release targets native local DeskRPG and operator-managed SSH hosts; a visitor-PC companion is deferred.

## Entry and user flows

First show icon cards: **로컬 연결** and **원격 연결**. Remote then offers **SSH로 연결** and **게이트웨이 주소로 연결**.

Local means the machine running the DeskRPG server, not automatically the browser's computer. Show this explicitly. Disable host discovery when the operator capability is unavailable (including ordinary hosted/container instances without configured host access).

Local sequence:
1. On choosing local, perform read-only discovery of Hermes executable, version, homes/profiles, API listener and managed gateway service. Return opaque candidate IDs and display metadata, never keys.
2. Select a discovered installation/service and click 연결하기. Multiple installations or service owners must be distinguishable; never guess the first running profile owns the API listener.
3. Check installed/enabled plugin and live authenticated `/deskrpg/info`. Show absent, disabled, pending restart, unauthorized, unreachable and ready separately.
4. Show a preparation summary and explicit 설치 및 연결 action when changes are needed. It names the plugin and the exact gateway service affected by a restart.
5. Install/enable the fixed DeskRPG plugin source as needed. Reuse existing valid API keys; provision only missing keys. Apply the minimum API/multiplex settings for the selected listener owner. Detect port conflicts and stop rather than disrupting another service.
6. Start/restart only the identified service when requested. Verify the real API and live plugin route before reporting success.
7. Save the gateway and show its profile list. Import selected existing profiles using profile-scoped credentials, then expose NPC appearance and office placement through the existing flow.

SSH sequence: choose an operator-approved SSH config alias (or administrator-provisioned host definition), verify host identity and key/agent authentication, discover remote Hermes, then reuse the local preparation stages through a constrained SSH executor. Support Linux and macOS initially. The API can remain bound to remote loopback; DeskRPG owns a loopback SSH tunnel and reconnects it across app restarts. No password/private-key text fields in the browser in this first release. Display SSH failures as actionable states; host-key changes fail closed.

Gateway URL sequence: enter address and existing gateway credential, validate API identity/authentication and plugin capability, save and list profiles. If plugin is absent, offer **SSH로 설치하기** or an installation guide. URL-only mode cannot mint the initial authentication key or install a missing plugin using the currently inspected API. An unauthorized response is not evidence of absence. This path remains available to ordinary gateway owners without host execution privileges.

## Architecture and persistence

- Capability endpoint exposes allowed connection modes without disclosing host details to unauthorized users.
- Setup service manages inspect → review → prepare → verify → save → profiles, with progress, cancellation and retry. Browser selects actions and opaque targets; it never supplies executable shell commands.
- Local/SSH adapters implement bounded inspection and fixed installation/configuration operations. Validate current target identity again before each mutation. Pin a reviewed plugin revision when implementation begins, with its version shown in the review step.
- Persist setup metadata, step outcomes and gateway transport configuration. Keep secrets in the existing encrypted credential mechanism; use restricted transient transport only when necessary, never return keys or raw environment/process output to the browser. Hermes necessarily stores its own API key in its supported secret configuration; preserve existing secret-provider behavior.
- SSH transport configuration stores stable remote identity/port, not an ephemeral tunnel URL. A server-side resolver supplies the current tunnel endpoint to gateway and profile clients. Tunnel lifecycle belongs to the DeskRPG server, not a Next.js request. Deduplicate tunnels and setup jobs per target; bound concurrent work and clean up only owned resources.
- Reuse existing plugin profile provisioning/proxy and resource ownership rules. Any schema changes include PostgreSQL migrations, SQLite fresh-runtime bootstrap/compatibility, and Docker runtime copies as required by project instructions.

## Boundaries and failure behavior

Host execution requires both an instance-operator opt-in and an authenticated administrator. Owning a gateway record alone does not grant access to the server filesystem, SSH agent or host credentials. Ordinary users can still register accessible API gateways.

Require same-origin mutation protection. Resolve targets server-side; restrict redirects and token destinations so discovered credentials cannot be sent to an arbitrary URL. SSH aliases and parameters must be validated and operator-approved; honor verified known hosts and never disable host-key verification. Do not copy a desktop application's trust model into a multiuser server without these restrictions.

Keep commands bounded with timeouts/output limits. Tokens travel outside argv and logs. On retry, re-inspect instead of repeating installations or regenerating keys. On cancellation stop owned work at a safe boundary; do not claim transactional rollback of an already completed installation. On interrupted configuration use atomic updates and preserve prior configuration. Do not automatically upgrade Hermes, delete profiles, restart unrelated gateways or invoke sudo. Unsupported service managers yield an explicit manual-start step.

## Verification and acceptance

Unit/contract checks cover authorization, target validation, key redaction, state transitions, absent versus unauthorized plugin responses, idempotent retries, port conflicts, SSH host-key failures and tunnel recovery. Verify SQLite fresh and existing DBs if persistence changes. Mock execution by default; tests must not install software on the developer host.

Use the Chrome Codex extension for real wizard checks: local discovery, honest unavailable states, plugin preparation and verified profile listing on the chosen local installation. Remote acceptance requires a dedicated authorized SSH target; do not silently use the production/staging gateway. If no target is supplied, report remote integration as unverified while completing contract tests.

Release acceptance: the user can connect the local installation from `/gateways`, see actual preparation progress, and select profiles only after live API/plugin verification. URL-only users receive truthful capability limits. No key appears in browser payloads or logs.

## Source evidence inspected

- DeskRPG: `src/app/api/gateways/[id]/local-discovery/route.ts`, `src/lib/hermes/local-discovery-gate.ts`, `src/lib/hermes/plugin-capability.ts`, `src/lib/hermes/plugin-provision.ts`, `src/lib/gateway-resources.ts`.
- Sibling `deskrpg-hermes-plugin/README.md`: install/enable commands and `/deskrpg/info`, profile/config/identity routes. CLI doctor alone does not establish live route availability.
- Local Hermes `gateway/platforms/api_server.py`, `_http_route_table`: API routes inspected expose no plugin-install operation.
- Sibling `hermes-desktop-korean-language-pack/apps/desktop/electron/ssh-connection.ts`: OpenSSH control sockets, key/agent auth, forwarding and timeouts.
- Same checkout `remote-lifecycle.ts`: remote install discovery and owned dashboard process lifecycle. Its `serve --isolated` and dashboard session token are not DeskRPG API-server authentication and must not be substituted for them.

Implementation finding: a standalone named-profile gateway accepts `/p/<own-name>/` with multiplex disabled. The wizard supports this mode, prepares only the chosen profile's service, and imports only selected verified profiles. Default multiplex activation still refuses conflicts with independently running profile bots.

Local Chrome inspection verified six installations/profile candidates and noah's own gateway review. Existing noah key can be reused; plugin installation and restart were not executed. New owner keys eligible for safe provisioning remain selectable during the first setup; missing sibling keys are not generated.

The standard ~/.hermes installation layout, Python3, and an existing Hermes user service definition are prerequisites. Operator-supplied SSH targets and actual remote end-to-end verification remain an environment dependency. See docs/gateway-setup.md for supported cases and controls.
