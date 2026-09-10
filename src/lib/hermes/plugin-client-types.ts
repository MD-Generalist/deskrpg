/** Pure plugin contracts shared by server clients and browser components. */
import type { PluginFailure } from "./plugin-errors";

export type PluginResponse<T> =
  { ok: true; data: T } | { ok: false; failure: PluginFailure; status: number };

export type IdentityPayload = {
  body: string | null;
  isDefaultTemplate: boolean | null;
  revision: string | null;
  unreadable?: boolean;
};

export type CreateProfilePayload = {
  name: string;
  apiKey?: string;
  keyIssued: boolean;
  keyError?: string;
};

export type DeleteProfilePayload = {
  name: string;
  removed: { profileDir: boolean; wrapperScript: boolean };
};

export type CatalogPayload = {
  providers: Array<{ id: string; name: string; authenticated: boolean }>;
  models: Record<string, string[]>;
  reasoningEfforts: string[];
};

export type PluginClient = {
  listProfiles(): Promise<PluginResponse<{ profiles: unknown[] }>>;
  createProfile(name: string): Promise<PluginResponse<CreateProfilePayload>>;
  deleteProfile(name: string): Promise<PluginResponse<DeleteProfilePayload>>;
  getIdentity(name: string, profileToken: string): Promise<PluginResponse<IdentityPayload>>;
  putIdentity(
    name: string,
    profileToken: string,
    input: { body: string; ifRevision: string },
  ): Promise<PluginResponse<{ revision: string }>>;
  getConfig(name: string, profileToken: string): Promise<PluginResponse<Record<string, unknown>>>;
  getCatalog(name: string, profileToken: string): Promise<PluginResponse<CatalogPayload>>;
  putConfig(
    name: string,
    profileToken: string,
    patch: Record<string, unknown>,
  ): Promise<PluginResponse<Record<string, unknown>>>;
};
