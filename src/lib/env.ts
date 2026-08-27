// src/lib/env.ts
function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
}

export const env = {
  get DATABASE_URL() {
    return getEnv("DATABASE_URL");
  },
  get JWT_SECRET() {
    return getEnv("JWT_SECRET");
  },
};
