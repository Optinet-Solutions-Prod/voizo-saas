import Link from "next/link";

// The VOIZO wordmark for the marketing pages (landing, sign-in): a small gradient mark in the
// theme's accent colors next to the name, like the reference site's left-aligned wordmark.
export default function MarketingLogo({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-10 w-10 rounded-lg text-base" : "h-8 w-8 rounded-md text-sm";
  const word = size === "lg" ? "text-xl" : "text-base";
  return (
    <Link href="/" className="inline-flex items-center gap-2.5" aria-label="VOIZO home">
      <span
        className={`${box} flex items-center justify-center font-bold text-[var(--accent-fg)]`}
        style={{ background: "linear-gradient(145deg, var(--accent), var(--accent-2))" }}
      >
        V
      </span>
      <span className={`${word} font-semibold tracking-tight text-[var(--text-1)]`}>VOIZO</span>
    </Link>
  );
}
