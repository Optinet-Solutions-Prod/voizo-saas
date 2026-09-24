"use client";

// The console shell (sidebar + header + scrolling main). The public pages — the landing page and
// the sign-in page — render full-bleed without it.
import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";

const BARE_PATHS = new Set(["/", "/login"]);

export default function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (BARE_PATHS.has(pathname)) return <>{children}</>;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      {/* right column: header + scrollable content */}
      {/* min-w-0: without it a wide table or nowrap strip inside a page widens this flex
          column past the phone screen and gets clipped instead of scrolling. */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <Header />
        {/* pt-14 offsets mobile top bar, pb-16 offsets mobile bottom nav. Transparent so the
            global dot-field shows through the content gutters. */}
        <main className="flex-1 overflow-y-auto pt-14 pb-16 md:pt-0 md:pb-0">
          {children}
        </main>
      </div>
    </div>
  );
}
