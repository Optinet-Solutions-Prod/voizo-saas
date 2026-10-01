// Cloudflare Turnstile verification for the public demo endpoints. Off until both keys exist:
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY (widget)  ·  TURNSTILE_SECRET_KEY (this check)

export const turnstileEnabled = () => Boolean(process.env.TURNSTILE_SECRET_KEY);

export async function verifyTurnstile(token: string | undefined | null, ip: string): Promise<{ ok: boolean; skipped: boolean; reason?: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, skipped: false, reason: "missing token" };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip === "unknown" ? undefined : ip }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; "error-codes"?: string[] };
    return j.success ? { ok: true, skipped: false } : { ok: false, skipped: false, reason: (j["error-codes"] ?? []).join(",") || "rejected" };
  } catch (e) {
    return { ok: false, skipped: false, reason: e instanceof Error ? e.message : "verify failed" };
  }
}
