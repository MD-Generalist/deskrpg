import { PLUGIN_PIN } from "./setup/pin";

/**
 * The **single source of truth** for the `deskrpg-hermes-plugin` install command.
 *
 * Kanban (`kanban-view-model.ts`) and cron (`cron-api.ts`) used to each hold the same string,
 * and now the gateway onboarding guide shows the same command too. Instead of making a third copy,
 * we gather it here — if the repository address changes, there is one place to fix.
 */
const PLUGIN_REPO_URL = "https://github.com/dandacompany/deskrpg-hermes-plugin";

export const PLUGIN_INSTALL_COMMAND = `hermes plugins install ${PLUGIN_REPO_URL} && hermes plugins enable deskrpg`;

/**
 * The same install pinned to the commit this app expects, then a gateway restart so the gateway
 * loads it. An already-installed but disabled plugin makes `install` fail, so `enable` is the fallback.
 */
export const PINNED_PLUGIN_SETUP_COMMAND = `(hermes plugins install ${PLUGIN_REPO_URL} --ref ${PLUGIN_PIN} --enable || hermes plugins enable deskrpg) && hermes gateway restart`;

/** The official Hermes Agent repository — where users who have not started a gateway yet should go. */
export const HERMES_AGENT_REPO_URL = "https://github.com/NousResearch/hermes-agent";
