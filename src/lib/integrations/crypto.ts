import { webcrypto } from "node:crypto";

// Credentials at rest: AES-256-GCM, one random IV per record, stored as base64
// "v1.<iv>.<ciphertext+tag>". The key is INTEGRATIONS_ENCRYPTION_KEY (any string; hashed to
// 256 bits). When unset we derive one from the service-role key so the feature works out of
// the box — set a dedicated key in production so rotating the Supabase key doesn't orphan
// stored credentials.

const subtle = webcrypto.subtle;
let keyPromise: Promise<CryptoKey> | null = null;

function keyMaterial(): string {
  const explicit = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (explicit && explicit.length >= 16) return `voizo-integrations:${explicit}`;
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!fallback) throw new Error("INTEGRATIONS_ENCRYPTION_KEY (or SUPABASE_SERVICE_ROLE_KEY) is required to store credentials");
  return `voizo-integrations-fallback:${fallback}`;
}

async function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const digest = await subtle.digest("SHA-256", new TextEncoder().encode(keyMaterial()));
      return subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    })();
  }
  return keyPromise;
}

const b64 = (buf: ArrayBuffer | Uint8Array) => Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

export async function encryptJson(value: unknown): Promise<string> {
  const key = await getKey();
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function decryptJson<T = Record<string, string>>(payload: string): Promise<T> {
  const [v, ivB64, ctB64] = payload.split(".");
  if (v !== "v1" || !ivB64 || !ctB64) throw new Error("Unrecognised credential format");
  const key = await getKey();
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, key, unb64(ctB64));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

/** "sk-live-abcdef123456" → "sk-l••••3456" for display. */
export function maskSecret(value: string | undefined | null): string {
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
