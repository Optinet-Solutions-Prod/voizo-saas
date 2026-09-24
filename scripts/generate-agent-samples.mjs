#!/usr/bin/env node
// Generates the ~20-second sample clip for each pre-built agent and uploads it to the public
// Supabase Storage bucket `agent-samples` as <key>.mp3 (the landing page and /agents play them).
//
//   node scripts/generate-agent-samples.mjs                 # OpenAI TTS (needs OPENAI_API_KEY)
//   node scripts/generate-agent-samples.mjs --provider elevenlabs   # needs ELEVENLABS_API_KEY;
//        uses each agent's own library voice id, so the sample sounds like the real agent
//   node scripts/generate-agent-samples.mjs --only appointment-reminder,lead-qualifier
//   node scripts/generate-agent-samples.mjs --force        # regenerate clips that already exist
//
// Reads .env.local for NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the provider key.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.existsSync(path.join(root, ".env.local")) ? fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/\s+#.*$/, "").trim();
}

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const provider = opt("provider", process.env.ELEVENLABS_API_KEY ? "elevenlabs" : "openai");
const only = opt("only", "")?.split(",").filter(Boolean);
const force = args.includes("--force");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing"); process.exit(1); }

// The catalog is TypeScript; strip the types with a tiny regex-free approach: import via tsx if
// available, else read the compiled fields we need with a loose parse.
async function loadCatalog() {
  try {
    const { register } = await import("node:module");
    void register;
    const mod = await import(path.join(root, "src/lib/agents/catalog.ts"));
    return mod.AGENT_CATALOG;
  } catch {
    // Node without TS support: pull key / sampleText / voiceId / gender with a regex on the source.
    const src = fs.readFileSync(path.join(root, "src/lib/agents/catalog.ts"), "utf8");
    const voices = Object.fromEntries([...src.matchAll(/^\s+(\w+): "([A-Za-z0-9]+)",\s+\/\/ (fe)?male/gm)].map((m) => [m[1], m[2]]));
    const out = [];
    for (const block of src.split(/\n  \{\n    key: "/).slice(1)) {
      const key = block.slice(0, block.indexOf('"'));
      const sampleText = block.match(/sampleText: "((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\"/g, '"');
      const voiceRef = block.match(/voiceId: V\.(\w+)/)?.[1];
      const gender = block.match(/gender: "(\w+)"/)?.[1] ?? "female";
      if (key && sampleText) out.push({ key, sampleText, voiceId: voices[voiceRef] ?? null, gender });
    }
    return out;
  }
}

const OPENAI_VOICE = { female: ["nova", "shimmer", "coral"], male: ["onyx", "echo", "ash"] };

async function ttsOpenAI(text, gender, i) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const voice = OPENAI_VOICE[gender][i % OPENAI_VOICE[gender].length];
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text, response_format: "mp3", instructions: "Warm, natural phone-call delivery at a relaxed pace, like a friendly professional leaving a clear voice message." }),
  });
  if (!r.ok) throw new Error(`OpenAI TTS ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

async function ttsElevenLabs(text, voiceId) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY missing");
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.0 } }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function ensureBucket() {
  const list = await (await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { headers: H })).json();
  if (Array.isArray(list) && list.some((b) => b.id === "agent-samples")) return;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "agent-samples", name: "agent-samples", public: true, file_size_limit: 5_000_000, allowed_mime_types: ["audio/mpeg"] }),
  });
  if (!r.ok) throw new Error(`create bucket: ${r.status} ${await r.text()}`);
  console.log("created public bucket agent-samples");
}

async function exists(key) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/public/agent-samples/${key}.mp3`, { method: "HEAD" });
  return r.ok;
}

async function upload(key, buf) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/agent-samples/${key}.mp3`, {
    method: "POST", headers: { ...H, "Content-Type": "audio/mpeg", "x-upsert": "true" }, body: buf,
  });
  if (!r.ok) throw new Error(`upload ${key}: ${r.status} ${await r.text()}`);
}

const catalog = await loadCatalog();
await ensureBucket();
let i = 0, done = 0, skipped = 0;
for (const a of catalog) {
  if (only?.length && !only.includes(a.key)) continue;
  if (!force && (await exists(a.key))) { skipped++; continue; }
  try {
    const buf = provider === "elevenlabs" && a.voiceId ? await ttsElevenLabs(a.sampleText, a.voiceId) : await ttsOpenAI(a.sampleText, a.gender, i++);
    await upload(a.key, buf);
    done++;
    console.log(`✓ ${a.key} (${(buf.length / 1024).toFixed(0)} KB, ${provider})`);
  } catch (e) {
    console.error(`✗ ${a.key}: ${e.message}`);
  }
}
console.log(`done: ${done} generated, ${skipped} already existed`);
