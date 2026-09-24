import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { isPublicPage, NO_ORG_PAGES } from "@/lib/auth";
import { getTenant } from "@/lib/tenant";

// Server component in the root layout: a signed-in user with no organization is sent to
// /onboarding before any console page renders. Public pages and /onboarding itself pass
// through, and so does everything while the tenancy migration hasn't been applied yet.
export default async function TenantGate({ children }: { children: ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? "/";
  if (isPublicPage(pathname) || NO_ORG_PAGES.has(pathname)) return <>{children}</>;

  const tenant = await getTenant();
  // Signed out on a console page can't happen (middleware redirects), but don't guess.
  if (tenant && tenant.provisioned && !tenant.org) redirect("/onboarding");
  return <>{children}</>;
}
