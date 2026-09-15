# DeskRPG on Hostinger VPS (Docker Manager)

One VPS, two containers: **DeskRPG** (the virtual office) and **Hermes Agent** (the employees' brain). Everything runs 24/7 on the server, so your agents keep working and reporting after you close the laptop.

## 1. One-click

[![Deploy on Hostinger](https://assets.hostinger.com/vps/deploy.svg)](https://www.hostinger.com/docker-hosting?compose_url=https://raw.githubusercontent.com/dandacompany/deskrpg/refs/tags/2026.9.19/deploy/hostinger/docker-compose.yml)

The button opens Docker Hosting. Pick **KVM 2** (2 vCPU / 8 GB — Hostinger's own minimum for Hermes), finish checkout, and Docker Manager opens with this compose already loaded.

Already have a VPS? hPanel → VPS → **Docker Manager** → **Compose** → **Compose from URL** → paste:

```
https://raw.githubusercontent.com/dandacompany/deskrpg/refs/tags/2026.9.19/deploy/hostinger/docker-compose.yml
```

Project name: `deskrpg` (3–64 chars, letters/digits/`-`/`_`).

## 2. Before you press Deploy

Fill the **Environment variables** box (one `KEY=value` per line):

```
JWT_SECRET=<long random string>
HERMES_API_KEY=<long random string>
OPENROUTER_API_KEY=<your provider key>   # or OPENAI_API_KEY / ANTHROPIC_API_KEY
```

Generate secrets on any machine with `openssl rand -hex 32`. Everything else has a safe default. If you leave `JWT_SECRET` at its default the app still boots, but do not invite other users until you change it (changing it logs everyone out).

## 3. HTTPS (Traefik)

Deploy Hostinger's **Traefik** project from the catalog once (enter your e-mail). DeskRPG's compose already joins the `traefik-proxy` network and carries the labels, so after Deploy you get:

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

## Constraints baked into the compose

- Docker Manager ingests **one file**: no `build:`, no `env_file:`, no sibling `.env`, ≤ 8 192 characters.
- Every `${VAR}` has a default so an empty environment box still boots.
- App ports are not published; Traefik routes `/socket.io` to the internal Socket.IO port (3001) and everything else to Next.js (3000), same-origin.
- SQLite mode; switch to Postgres by adapting `docker/docker-compose.external.yml` if you need multi-instance.
