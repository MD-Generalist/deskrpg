/** Reserved server-managed targets cannot be supplied through browser URL registration/probe forms. */
export function isManagedSshUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).hostname
      .toLowerCase()
      .replace(/\.$/, "")
      .endsWith(".deskrpg-ssh.invalid");
  } catch {
    return false;
  }
}
