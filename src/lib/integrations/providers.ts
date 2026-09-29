// The services an organization can connect, what each needs, and how to test it.
//
// Secrets live in org_integrations.credentials (encrypted, see ./crypto.ts); non-secret
// settings (region, host, sender ids) in org_integrations.config. `test()` makes ONE cheap,
// read-only call to the provider with the org's own credentials and reports plainly.

export type FieldType = "secret" | "text" | "select";

export interface ProviderField {
  key: string;
  label: string;
  type: FieldType;
  secret?: boolean;          // stored encrypted (true for type "secret")
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}

export interface TestResult {
  ok: boolean;
  /** One plain sentence for the operator. */
  detail: string;
  /** Extra facts worth showing (account name, balance, number count…). */
  facts?: Record<string, string>;
}

export interface ProviderDef {
  key: string;
  name: string;
  category: "crm" | "telephony" | "ai" | "sms" | "email" | "voice";
  description: string;
  docsUrl: string;
  fields: ProviderField[];
  test: (creds: Record<string, string>, config: Record<string, string>) => Promise<TestResult>;
}

const TIMEOUT_MS = 12_000;

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

function fail(detail: string): TestResult {
  return { ok: false, detail };
}

function netError(e: unknown, what: string): TestResult {
  const msg = e instanceof Error ? e.message : String(e);
  return fail(/abort/i.test(msg) ? `${what} didn't answer within ${TIMEOUT_MS / 1000}s.` : `Couldn't reach ${what}: ${msg}`);
}

const basic = (u: string, p: string) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

export const PROVIDERS: ProviderDef[] = [
  {
    key: "customerio",
    name: "Customer.io",
    category: "crm",
    description: "Import audiences from Customer.io segments and send call outcomes back as events.",
    docsUrl: "https://customer.io/docs/api/",
    fields: [
      { key: "region", label: "Region", type: "select", required: true, options: [{ value: "us", label: "US" }, { value: "eu", label: "EU" }] },
      { key: "appApiKey", label: "App API key", type: "secret", secret: true, required: true, help: "Settings → API Credentials → App API Keys. Used to read segments and messages." },
      { key: "siteId", label: "Track site ID", type: "text", help: "Settings → API Credentials → Track API Keys. Needed to send events back." },
      { key: "trackApiKey", label: "Track API key", type: "secret", secret: true },
    ],
    async test(creds, config) {
      const eu = config.region === "eu";
      try {
        const r = await call(`${eu ? "https://api-eu.customer.io" : "https://api.customer.io"}/v1/segments`, { headers: { Authorization: `Bearer ${creds.appApiKey}` } });
        if (r.status === 401 || r.status === 403) return fail("Customer.io rejected the App API key.");
        if (!r.ok) return fail(`Customer.io answered ${r.status}.`);
        const j = (await r.json().catch(() => ({}))) as { segments?: unknown[] };
        const facts: Record<string, string> = { segments: String(j.segments?.length ?? 0) };
        if (creds.siteId && creds.trackApiKey) {
          const t = await call(`${eu ? "https://track-eu.customer.io" : "https://track.customer.io"}/api/v1/accounts/region`, { headers: { Authorization: basic(creds.siteId, creds.trackApiKey) } });
          if (!t.ok) return { ok: false, detail: "App API key works, but the Track site ID / key were rejected.", facts };
          facts.track = "ok";
        }
        return { ok: true, detail: `Connected to Customer.io (${eu ? "EU" : "US"}).`, facts };
      } catch (e) {
        return netError(e, "Customer.io");
      }
    },
  },
  {
    key: "squaretalk",
    name: "Squaretalk",
    category: "telephony",
    description: "Contact-centre telephony. Connect your Squaretalk API so campaigns can dial through it (dialing via Squaretalk is coming; this stores and checks the connection).",
    docsUrl: "https://squaretalk.com/programmable-voice/",
    fields: [
      { key: "baseUrl", label: "API base URL", type: "text", required: true, placeholder: "https://api.squaretalk.com", help: "From your Squaretalk account manager or developer settings." },
      { key: "apiKey", label: "API key / token", type: "secret", secret: true, required: true },
    ],
    async test(creds, config) {
      const base = (config.baseUrl ?? "").replace(/\/+$/, "");
      if (!/^https:\/\//.test(base)) return fail("The base URL must start with https://");
      try {
        const r = await call(base, { headers: { Authorization: `Bearer ${creds.apiKey}`, "X-API-Key": creds.apiKey } });
        if (r.status === 401 || r.status === 403) return fail("Squaretalk reached, but it rejected the API key.");
        return { ok: true, detail: `Squaretalk endpoint reachable (HTTP ${r.status}). The key format could not be fully verified without a dial.` };
      } catch (e) {
        return netError(e, "Squaretalk");
      }
    },
  },
  {
    key: "freeswitch",
    name: "FreeSWITCH",
    category: "telephony",
    description: "Your own FreeSWITCH dialer through the VOIZO originate shim. Campaigns place calls with it.",
    docsUrl: "https://developer.signalwire.com/freeswitch/",
    fields: [
      { key: "shimUrl", label: "Shim URL", type: "text", required: true, placeholder: "http://1.2.3.4:7777", help: "The originate shim's address (without /originate)." },
      { key: "shimSecret", label: "Shim secret", type: "secret", secret: true, required: true, help: "SHIM_SECRET on the shim; signs every originate request." },
      { key: "webhookSecret", label: "Webhook secret", type: "secret", secret: true, help: "VOIZO_WEBHOOK_SECRET on the shim; verifies call-status webhooks." },
      { key: "callerId", label: "Default caller ID", type: "text", placeholder: "+442036953434" },
    ],
    async test(_creds, config) {
      const base = (config.shimUrl ?? "").replace(/\/+(originate)?$/, "");
      if (!/^https?:\/\//.test(base)) return fail("The shim URL must start with http:// or https://");
      try {
        const r = await call(`${base}/health`);
        if (!r.ok) return fail(`The shim answered ${r.status} on /health.`);
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; ts?: string };
        return j.ok ? { ok: true, detail: "FreeSWITCH shim is up.", facts: j.ts ? { shimTime: j.ts } : undefined } : fail("The shim's health check didn't report ok.");
      } catch (e) {
        return netError(e, "the FreeSWITCH shim");
      }
    },
  },
  {
    key: "siptrunk",
    name: "Your SIP trunk",
    category: "telephony",
    description: "Bring your own SIP trunk from any carrier. In bring-your-own mode, campaign calls go out through it instead of VOIZO's trunk.",
    docsUrl: "https://docs.vapi.ai/advanced/sip/sip-trunk",
    fields: [
      { key: "host", label: "SIP host", type: "text", required: true, placeholder: "sip.yourcarrier.com", help: "Hostname or IP of the trunk's signalling gateway." },
      { key: "port", label: "Port", type: "text", placeholder: "5060" },
      { key: "transport", label: "Transport", type: "select", options: [{ value: "udp", label: "UDP" }, { value: "tcp", label: "TCP" }, { value: "tls", label: "TLS" }] },
      { key: "username", label: "Auth username", type: "text" },
      { key: "password", label: "Auth password", type: "secret", secret: true },
      { key: "callerId", label: "Default caller ID", type: "text", placeholder: "+442036953434" },
    ],
    async test(_creds, config) {
      const host = (config.host ?? "").trim();
      if (!host) return fail("Enter the SIP host.");
      const port = Number(config.port || 5060);
      const transport = (config.transport || "udp").toLowerCase();
      try {
        const dns = await import("node:dns/promises");
        const addrs = await dns.lookup(host, { all: true });
        const ip = addrs[0]?.address;
        if (!ip) return fail(`${host} doesn't resolve.`);
        if (transport === "udp") return { ok: true, detail: `${host} resolves to ${ip}. UDP trunks can't be probed without a call; registration is checked on the first dial.`, facts: { ip, port: String(port) } };
        const net = await import("node:net");
        const reachable = await new Promise<boolean>((resolve) => {
          const s = net.createConnection({ host: ip, port });
          const done = (v: boolean) => { s.destroy(); resolve(v); };
          s.setTimeout(6000, () => done(false));
          s.once("connect", () => done(true));
          s.once("error", () => done(false));
        });
        return reachable
          ? { ok: true, detail: `${host} (${ip}) accepts ${transport.toUpperCase()} connections on port ${port}.`, facts: { ip, port: String(port) } }
          : fail(`${host} (${ip}) didn't accept a ${transport.toUpperCase()} connection on port ${port}.`);
      } catch (e) {
        return netError(e, host);
      }
    },
  },
  {
    key: "whatsapp",
    name: "WhatsApp Business Calling",
    category: "telephony",
    description: "Call customers on WhatsApp through Meta's Business Calling API. Enable calling on your WhatsApp Business number in WhatsApp Manager, then connect it here.",
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/calling",
    fields: [
      { key: "phoneNumberId", label: "Phone number ID", type: "text", required: true, help: "WhatsApp Manager → Phone numbers → the number's ID (not the phone number itself)." },
      { key: "wabaId", label: "WhatsApp Business Account ID", type: "text" },
      { key: "accessToken", label: "System user access token", type: "secret", secret: true, required: true, help: "A permanent token with whatsapp_business_messaging and whatsapp_business_management." },
    ],
    async test(creds, config) {
      const id = (config.phoneNumberId ?? "").trim();
      if (!/^\d{5,}$/.test(id)) return fail("The phone number ID should be numeric.");
      const H = { Authorization: `Bearer ${creds.accessToken}` };
      try {
        const r = await call(`https://graph.facebook.com/v21.0/${id}?fields=display_phone_number,verified_name,quality_rating`, { headers: H });
        const j = (await r.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; quality_rating?: string; error?: { message?: string } };
        if (!r.ok) return fail(`Meta rejected the connection: ${j.error?.message ?? `HTTP ${r.status}`}`);
        const s = await call(`https://graph.facebook.com/v21.0/${id}/settings`, { headers: H });
        const sj = (await s.json().catch(() => ({}))) as { calling?: { status?: string } };
        const calling = (sj.calling?.status ?? "unknown").toLowerCase();
        const facts = { number: j.display_phone_number ?? "", name: j.verified_name ?? "", quality: j.quality_rating ?? "", calling };
        const who = `${j.verified_name ?? "Number"} (${j.display_phone_number ?? id})`;
        return calling === "enabled"
          ? { ok: true, detail: `${who} is connected and calling is enabled.`, facts }
          : { ok: true, detail: `${who} is connected. Calling status: ${calling} — enable calling for this number in WhatsApp Manager before dialing.`, facts };
      } catch (e) {
        return netError(e, "Meta's Graph API");
      }
    },
  },
  {
    key: "openai",
    name: "OpenAI",
    category: "ai",
    description: "Scores calls with the QA judge, analyses transcripts and drafts scripts.",
    docsUrl: "https://platform.openai.com/api-keys",
    fields: [{ key: "apiKey", label: "API key", type: "secret", secret: true, required: true, placeholder: "sk-…" }],
    async test(creds) {
      try {
        const r = await call("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${creds.apiKey}` } });
        if (r.status === 401) return fail("OpenAI rejected the API key.");
        if (!r.ok) return fail(`OpenAI answered ${r.status}.`);
        const j = (await r.json().catch(() => ({}))) as { data?: { id: string }[] };
        return { ok: true, detail: "Connected to OpenAI.", facts: { models: String(j.data?.length ?? 0) } };
      } catch (e) {
        return netError(e, "OpenAI");
      }
    },
  },
  {
    key: "mobivate",
    name: "Mobivate",
    category: "sms",
    description: "Sends the follow-up SMS after a call and records opt-outs.",
    docsUrl: "https://wiki.mobivatebulksms.com/overview/introduction",
    fields: [
      { key: "apiHost", label: "API host", type: "text", required: true, placeholder: "api.example.mobivate.com", help: "Provided by Mobivate for your account (no https://)." },
      { key: "apiKey", label: "API key", type: "secret", secret: true, required: true },
      { key: "senderId", label: "Default sender ID", type: "text", placeholder: "VOIZO", help: "Per-brand sender IDs can be set on the brand later." },
    ],
    async test(creds, config) {
      const host = (config.apiHost ?? "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
      if (!host) return fail("Enter the API host.");
      try {
        const r = await call(`https://${host}/wallet/balance`, { headers: { Authorization: `Bearer ${creds.apiKey}` } });
        if (r.status === 401 || r.status === 403) return fail("Mobivate rejected the API key.");
        if (r.ok) {
          const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
          const bal = j.balance ?? j.credits ?? j.amount;
          return { ok: true, detail: "Connected to Mobivate.", facts: bal !== undefined ? { balance: String(bal) } : undefined };
        }
        return { ok: true, detail: `Mobivate host reachable (HTTP ${r.status}); the balance endpoint isn't exposed on this account, so the key was not verified.` };
      } catch (e) {
        return netError(e, "Mobivate");
      }
    },
  },
  {
    key: "twilio",
    name: "Twilio",
    category: "telephony",
    description: "Phone numbers and, later, dialing through Twilio. Used to verify the numbers you register.",
    docsUrl: "https://console.twilio.com/",
    fields: [
      { key: "accountSid", label: "Account SID", type: "text", required: true, placeholder: "AC…" },
      { key: "authToken", label: "Auth token", type: "secret", secret: true, required: true },
    ],
    async test(creds, config) {
      const sid = config.accountSid ?? "";
      if (!/^AC[0-9a-f]{32}$/i.test(sid)) return fail("The Account SID should look like AC followed by 32 characters.");
      try {
        const r = await call(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, { headers: { Authorization: basic(sid, creds.authToken) } });
        if (r.status === 401) return fail("Twilio rejected the SID / auth token.");
        if (!r.ok) return fail(`Twilio answered ${r.status}.`);
        const j = (await r.json().catch(() => ({}))) as { friendly_name?: string; status?: string };
        return { ok: true, detail: "Connected to Twilio.", facts: { account: j.friendly_name ?? sid, status: j.status ?? "" } };
      } catch (e) {
        return netError(e, "Twilio");
      }
    },
  },
  {
    key: "resend",
    name: "Resend",
    category: "email",
    description: "Transactional email: invites, daily snapshot, alerts.",
    docsUrl: "https://resend.com/api-keys",
    fields: [
      { key: "apiKey", label: "API key", type: "secret", secret: true, required: true, placeholder: "re_…" },
      { key: "from", label: "From address", type: "text", required: true, placeholder: "VOIZO <alerts@yourdomain.com>", help: "Must be on a domain verified in Resend." },
    ],
    async test(creds) {
      try {
        const r = await call("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${creds.apiKey}` } });
        if (r.status === 401 || r.status === 403) return fail("Resend rejected the API key.");
        if (!r.ok) return fail(`Resend answered ${r.status}.`);
        const j = (await r.json().catch(() => ({}))) as { data?: { name: string; status: string }[] };
        const verified = (j.data ?? []).filter((d) => d.status === "verified").map((d) => d.name);
        return { ok: true, detail: "Connected to Resend.", facts: { verifiedDomains: verified.join(", ") || "none yet" } };
      } catch (e) {
        return netError(e, "Resend");
      }
    },
  },
  {
    key: "brevo",
    name: "Brevo",
    category: "email",
    description: "Email (and SMS) via Brevo, formerly Sendinblue.",
    docsUrl: "https://developers.brevo.com/",
    fields: [
      { key: "apiKey", label: "API key", type: "secret", secret: true, required: true, placeholder: "xkeysib-…" },
      { key: "from", label: "From address", type: "text", placeholder: "alerts@yourdomain.com" },
    ],
    async test(creds) {
      try {
        const r = await call("https://api.brevo.com/v3/account", { headers: { "api-key": creds.apiKey, accept: "application/json" } });
        if (r.status === 401) return fail("Brevo rejected the API key.");
        if (!r.ok) return fail(`Brevo answered ${r.status}.`);
        const j = (await r.json().catch(() => ({}))) as { email?: string; companyName?: string; plan?: { type: string; credits: number }[] };
        const credits = j.plan?.find((p) => p.type === "sms")?.credits;
        return { ok: true, detail: "Connected to Brevo.", facts: { account: j.companyName ?? j.email ?? "", ...(credits !== undefined ? { smsCredits: String(credits) } : {}) } };
      } catch (e) {
        return netError(e, "Brevo");
      }
    },
  },
  {
    key: "elevenlabs",
    name: "ElevenLabs",
    category: "voice",
    description: "Use the voices in your own ElevenLabs account on your agents.",
    docsUrl: "https://elevenlabs.io/app/settings/api-keys",
    fields: [{ key: "apiKey", label: "API key", type: "secret", secret: true, required: true }],
    async test(creds) {
      try {
        const r = await call("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": creds.apiKey } });
        if (r.status === 401) return fail("ElevenLabs rejected the API key.");
        if (!r.ok) return fail(`ElevenLabs answered ${r.status}.`);
        const j = (await r.json().catch(() => ({}))) as { tier?: string; character_count?: number; character_limit?: number };
        return {
          ok: true,
          detail: "Connected to ElevenLabs.",
          facts: { plan: j.tier ?? "", charactersUsed: j.character_limit ? `${j.character_count ?? 0} / ${j.character_limit}` : "" },
        };
      } catch (e) {
        return netError(e, "ElevenLabs");
      }
    },
  },
];

export const PROVIDER_MAP: Record<string, ProviderDef> = Object.fromEntries(PROVIDERS.map((p) => [p.key, p]));

/** Split submitted values into the encrypted part and the plain config part. */
export function splitFields(def: ProviderDef, values: Record<string, string>) {
  const creds: Record<string, string> = {};
  const config: Record<string, string> = {};
  for (const f of def.fields) {
    const v = (values[f.key] ?? "").trim();
    if (!v) continue;
    if (f.type === "secret" || f.secret) creds[f.key] = v;
    else config[f.key] = v;
  }
  return { creds, config };
}

export function missingRequired(def: ProviderDef, creds: Record<string, string>, config: Record<string, string>): string[] {
  return def.fields.filter((f) => f.required && !(creds[f.key] || config[f.key])).map((f) => f.label);
}
