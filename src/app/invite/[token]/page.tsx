import type { Metadata } from "next";
import Link from "next/link";
import InviteClient from "./InviteClient";

export const metadata: Metadata = { title: "You're invited · VOIZO" };

// Public invite landing. The client loads the invite preview, then offers: sign in / create an
// account (with the invite's email pre-filled and ?next back here), or Accept when signed in.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-12 sm:px-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-[1]" style={{ background: "radial-gradient(45% 40% at 50% 30%, #4d90f01f, transparent 70%)" }} />
      <div className="w-full max-w-md">
        <Link href="/" className="mb-10 flex items-center justify-center gap-2.5" aria-label="VOIZO home">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "linear-gradient(145deg,#4d90f0,#3a6fd0)", boxShadow: "0 2px 10px rgba(77,144,240,.35)" }}>
            <span className="text-base font-bold text-white">V</span>
          </span>
          <span className="text-lg font-bold tracking-tight text-[var(--text-1)]">VOIZO</span>
        </Link>
        <InviteClient token={token} />
      </div>
    </main>
  );
}
