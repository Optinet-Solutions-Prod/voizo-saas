import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTenant } from "@/lib/tenant";
import { supabaseService } from "@/lib/supabaseServer";
import OnboardingClient from "./OnboardingClient";

export const metadata: Metadata = { title: "Set up your organization · VOIZO" };

// Signed-in users without an organization land here. Two ways out: accept a pending invite
// for their email, or create a new organization (which makes them its owner). Users who
// arrived through an invite link see only the invite path.
export default async function OnboardingPage() {
  const tenant = await getTenant();
  if (!tenant) redirect("/login?next=/onboarding");
  if (tenant.org) redirect("/dashboard");

  let invites: { token: string; orgName: string; role: string }[] = [];
  if (tenant.provisioned && tenant.user.email) {
    const { data } = await supabaseService
      .from("organization_invites")
      .select("token, role, organizations(name)")
      .ilike("email", tenant.user.email)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString());
    invites = (data ?? []).map((r) => {
      const org = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations;
      return { token: r.token as string, role: r.role as string, orgName: (org as { name: string } | null)?.name ?? "an organization" };
    });
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-12 sm:px-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-[1]" style={{ background: "radial-gradient(45% 40% at 50% 30%, #4d90f01f, transparent 70%)" }} />
      <div className="w-full max-w-lg">
        <Link href="/" className="mb-10 flex items-center justify-center gap-2.5" aria-label="VOIZO home">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "linear-gradient(145deg,#4d90f0,#3a6fd0)", boxShadow: "0 2px 10px rgba(77,144,240,.35)" }}>
            <span className="text-base font-bold text-white">V</span>
          </span>
          <span className="text-lg font-bold tracking-tight text-[var(--text-1)]">VOIZO</span>
        </Link>
        <OnboardingClient email={tenant.user.email ?? ""} invites={invites} provisioned={tenant.provisioned} />
      </div>
    </main>
  );
}
