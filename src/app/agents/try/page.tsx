import { Suspense } from "react";
import type { Metadata } from "next";
import TryAgentClient from "./TryAgentClient";

export const metadata: Metadata = { title: "Try an agent · VOIZO" };

// In-app demo: pick one of the 20 agents, enter your name and brand, talk to it in the browser.
export default function TryAgentPage() {
  return (
    <Suspense fallback={null}>
      <TryAgentClient />
    </Suspense>
  );
}
