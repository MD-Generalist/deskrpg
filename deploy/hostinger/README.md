# DeskRPG on Hostinger VPS (Docker Manager)

One VPS, two containers: **DeskRPG** (the virtual office) and **Hermes Agent** (the employees' brain). Everything runs 24/7 on the server, so your agents keep working and reporting after you close the laptop.

## 1. Deploy Traefik first — not optional

hPanel → VPS → **Docker Manager** shows a banner, _"Enable HTTPS for Docker projects"_, with a **Deploy Traefik** button. Press it once and enter your e-mail.

> ⚠️ **Do this before DeskRPG.** This compose joins the `traefik-proxy` network as `external: true`, so `docker compose up` fails outright when Traefik has not created that network yet. Hostinger reports the failure only as a project stuck at `created` whose logs read **"Docker project not found"** — a message that names neither Traefik nor the network. Measured 2026-09-16.
>
> `external: true` is the right setting even so: the catalog Traefik owns that network and we are a guest on it. Dropping it would break the opposite case — Compose refuses to adopt a network it did not create, so everyone who installed Traefik first would fail instead.

## 2. One-click

[![Deploy on Hostinger](https://assets.hostinger.com/vps/deploy.svg)](https://www.hostinger.com/vps/docker-hosting?compose_url=https://raw.githubusercontent.com/dandacompany/deskrpg/refs/heads/master/docker-compose.yml)

No VPS yet? [Get one here first](https://hostinger.com/DANTE-HERMES) — a referral link that supports this project at no extra cost to you. It lands on Hostinger's offer page, not on Docker Manager, so buy there and then press the button above.

The button opens Docker Hosting. Pick **KVM 2** (2 vCPU / 8 GB — Hostinger's own minimum for Hermes), finish checkout, and Docker Manager opens with this compose already loaded.

Already have a VPS? hPanel → VPS → **Docker Manager** → **Compose** → **Compose from URL** → paste:

```
https://raw.githubusercontent.com/dandacompany/deskrpg/refs/heads/master/docker-compose.yml
```

Project name: `deskrpg` (3–64 chars, letters/digits/`-`/`_`).

## 2-1. Before you press Deploy

Fill the **Environment variables** box (one `KEY=value` per line):

```
JWT_SECRET=<long random string>
HERMES_API_KEY=<long random string>
OPENROUTER_API_KEY=<your provider key>   # or OPENAI_API_KEY / ANTHROPIC_API_KEY
```

Generate secrets on any machine with `openssl rand -hex 32`. Everything else has a safe default. If you leave `JWT_SECRET` at its default the app still boots, but do not invite other users until you change it (changing it logs everyone out).

## 3. Your HTTPS URL

After Traefik (step 1) and Deploy (step 2), the office is reachable at:

```
https://deskrpg.<srvNNNNNN.hstgr.cloud>
```

`TRAEFIK_HOST` is injected by Hostinger when the Traefik project exists. If the URL does not resolve, add `TRAEFIK_HOST=srvNNNNNN.hstgr.cloud` (from the Traefik project's page) to the environment box and press **Update**.

Custom domain: point an `A` record at the VPS IP and change the `Host(...)` rules to your domain.

## 4. Firewall

hPanel → VPS → Security → Firewall: allow **22, 80, 443** only. Do **not** open 3000, 3001, 8642 or 9119 — Traefik is the only public door, and Hermes' API server is reachable from DeskRPG on the private Docker network.

## 5. Connect the office to Hermes

1. Open your DeskRPG URL, create the first account (it becomes admin).
2. Top-right menu → **My Gateways** → **New gateway** → URL `http://hermes:8642`, token = your `HERMES_API_KEY` → **Test connection**.
3. Add profiles (each Hermes profile = one employee). With `deskrpg-hermes-plugin` installed in Hermes the list is discovered automatically; otherwise add name + key by hand.
4. Enter a channel → Settings → **AI Connection** → attach the gateway → hire NPCs.

Already running Hermes elsewhere (your laptop, another VPS)? Delete the `hermes` service from the compose and use your own API server URL in step 2. Hermes profiles you already have show up as employees — nothing to migrate.

## 6. Kanban and cron (optional)

Conversations work out of the box. Kanban boards, the event stream and schedules need
[`deskrpg-hermes-plugin`](https://github.com/dandacompany/deskrpg-hermes-plugin) inside the Hermes
container. Docker Manager → **Access → Terminal** on the `hermes` service, or from an SSH shell:

```bash
docker compose exec hermes hermes plugins install https://github.com/dandacompany/deskrpg-hermes-plugin
docker compose exec hermes hermes plugins enable deskrpg
docker compose restart hermes
```

`enable` is not optional — without it every plugin route answers 404 even though the install
succeeded, and DeskRPG's board screen keeps telling you the plugin is missing. The plugin lives in
the `hermes-data` volume, so it survives Update. Verify:

```bash
docker compose exec hermes sh -lc 'curl -s -H "Authorization: Bearer $API_SERVER_KEY" http://127.0.0.1:8642/deskrpg/info'
```

Set `timezone:` in Hermes' `config.yaml` if you schedule anything — cron times are read in that zone.

## 7. Day-2

Docker Manager → project → **Options**: Restart / Update (edit YAML, re-create) / View logs / Delete. **Access → Terminal** opens a shell in the container. Data lives in the named volumes `deskrpg-data` (SQLite + uploads) and `hermes-data` (`~/.hermes`) and survives Update.

## How Docker Manager reads this repo (measured 2026-09-16)

- **It always takes the repo-root `docker-compose.yml`.** A raw URL for a file in a
  subdirectory is resolved back to the root — a URL for
  `deploy/hostinger/docker-compose.yml` deployed the root file instead. That is why the
  compose lives at the repo root and must stay there.
- **It pre-fills the Environment box from the repo-root `.env.example`, verbatim.** That box
  has no comment syntax, so a line starting with `#` becomes a variable named `# FOO` and is
  rejected as an invalid name. `.env.example` is therefore kept comment-free; the prose lives
  in [`ENVIRONMENT.md`](../../ENVIRONMENT.md).
- The API takes the compose as a URL, a GitHub repository URL, or raw YAML, and `environment`
  as one `KEY=value` string capped at **8 192 characters**. That cap is on the environment
  string, not on the compose file.
- `build:` is used by Hostinger's own template repo, so it is presumably supported. This
  compose does not use it — a published image is faster to deploy and easier to pin.

## Constraints baked into the compose

- Every `${VAR}` has a default so an empty environment box still boots.
- App ports are not published; Traefik routes `/socket.io` to the internal Socket.IO port (3001) and everything else to Next.js (3000), same-origin.
- SQLite mode; switch to Postgres by adapting `docker/docker-compose.external.yml` if you need multi-instance.
