// Tenant helpers with no server dependencies (safe for client components and vitest).

export type OrgRole = "owner" | "admin" | "member";

export const ROLE_RANK: Record<OrgRole, number> = { member: 0, admin: 1, owner: 2 };

export function canManageOrg(role: OrgRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** URL-safe slug: "Fortune Play!" → "fortune-play". */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "brand";
}
