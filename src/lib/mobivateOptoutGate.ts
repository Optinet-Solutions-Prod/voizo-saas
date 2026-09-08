// Before a text goes out: is this number on Mobivate's opt-out list (mirrored nightly into
// mobivate_optouts)? Mobivate accepts such a send, charges nothing, drops it silently and sends
// no receipt, so our row sat at 'sent' forever (552 of 906 all-time 'sent' rows, 2026-09-07).
// This gate turns that silent drop into an explicit skip. It is SMS-only by design: the dialer
// keeps its own gate (suppression_list + do_not_call); player_opt_out rows are also written to
// suppression_list by the reconcile, which stops calls too.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface OptoutGateResult {
  blocked: boolean;
  kind: string | null;
  /** Set when the read failed; `blocked` is then true (fail closed, like the dedup gate). */
  error: string | null;
}

export async function mobivateOptoutGate(supabase: SupabaseClient, phoneE164: string): Promise<OptoutGateResult> {
  const { data, error } = await supabase
    .from("mobivate_optouts")
    .select("kind")
    .eq("phone_e164", phoneE164)
    .limit(1);
  if (error) return { blocked: true, kind: null, error: error.message };
  const hit = (data ?? [])[0] as { kind?: string } | undefined;
  return hit ? { blocked: true, kind: hit.kind ?? "unknown", error: null } : { blocked: false, kind: null, error: null };
}
