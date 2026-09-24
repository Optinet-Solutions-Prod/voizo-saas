import { beforeAll, describe, expect, it } from "vitest";
import { decryptJson, encryptJson, maskSecret } from "./crypto";

beforeAll(() => {
  process.env.INTEGRATIONS_ENCRYPTION_KEY = "test-key-for-vitest-0123456789";
});

describe("credential encryption", () => {
  it("round-trips JSON and never stores it in the clear", async () => {
    const creds = { apiKey: "sk-live-secret-123", region: "eu" };
    const enc = await encryptJson(creds);
    expect(enc.startsWith("v1.")).toBe(true);
    expect(enc).not.toContain("sk-live");
    expect(await decryptJson(enc)).toEqual(creds);
  });

  it("uses a fresh IV per record", async () => {
    const a = await encryptJson({ k: "same" });
    const b = await encryptJson({ k: "same" });
    expect(a).not.toBe(b);
  });

  it("rejects tampered payloads", async () => {
    const enc = await encryptJson({ k: "v" });
    const [v, iv, ct] = enc.split(".");
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 0xff;
    await expect(decryptJson(`${v}.${iv}.${flipped.toString("base64")}`)).rejects.toThrow();
  });
});

describe("maskSecret", () => {
  it("keeps only the edges", () => {
    expect(maskSecret("sk-live-abcdef123456")).toBe("sk-l••••3456");
    expect(maskSecret("short")).toBe("••••");
    expect(maskSecret("")).toBe("");
  });
});
