import { NextRequest, NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { customVoices, libraryVoices } from "@/lib/voices/orgVoices";

// GET /api/org/voices[?refresh=1] → { library, custom, connected, error? }
// The voice pickers (script builder, lab config) read this; the library part always works.
export async function GET(request: NextRequest) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const library = libraryVoices();
  if (!tenant.org) return NextResponse.json({ library, custom: [], connected: false });
  const force = request.nextUrl.searchParams.get("refresh") === "1";
  const { voices, connected, error } = await customVoices(tenant.org.id, { force });
  return NextResponse.json({ library, custom: voices, connected, ...(error ? { error } : {}) });
}
