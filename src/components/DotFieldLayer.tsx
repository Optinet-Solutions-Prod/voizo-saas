"use client";

// The app-wide dot-field background, except on the dashboard and the Audience tab: the mockups
// for both sit on a flat ground (Jasiel, 2026-09-03 and 2026-09-05), so the layer steps aside
// there and stays everywhere else.
import { usePathname } from "next/navigation";
import DotField from "@/components/DotField";

const FLAT_PREFIXES = ["/dashboard", "/analytics", "/audience"];

export default function DotFieldLayer() {
  const pathname = usePathname();
  if (FLAT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <DotField />
    </div>
  );
}
