"use client";

import { Check } from "lucide-react";
import type { Step } from "../wizardState";
import { STEPS } from "../wizardState";

interface Props {
  currentStep: Step;
  onJump: (step: Step) => void;
}

// Vertical rail with step descriptions from lg up. Below lg it is a horizontal strip above the
// form: circle + short name only, scrolling sideways if the five steps don't fit the width.
export default function Stepper({ currentStep, onJump }: Props) {
  return (
    <aside className="border-b lg:border-b-0 lg:border-r border-[var(--border)] overflow-x-auto hide-scrollbar lg:overflow-y-auto px-4 py-3 lg:py-8 lg:pl-6 lg:pr-2">
      <p className="hidden lg:block text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-3)] mb-5">
        Create campaign
      </p>
      <div className="glow-card flex lg:flex-col items-stretch rounded-2xl p-2 lg:p-4 min-w-max lg:min-w-0">
        {STEPS.map((s, i) => {
          const isDone = s.step < currentStep;
          const isActive = s.step === currentStep;
          const isLast = i === STEPS.length - 1;
          return (
            <button
              key={s.step}
              type="button"
              onClick={() => onJump(s.step)}
              aria-current={isActive ? "step" : undefined}
              className="group relative flex lg:grid lg:grid-cols-[32px_1fr] items-center lg:items-start gap-2 lg:gap-3.5 px-2 py-1.5 lg:px-0 lg:py-2 text-left"
            >
              <div
                className={`relative w-7 h-7 rounded-full grid place-items-center text-xs font-semibold font-mono border-[1.5px] z-[2] transition-all shrink-0 ${
                  isActive
                    ? "bg-blue-500 border-blue-500 text-white shadow-[0_0_0_4px_rgba(79,141,248,0.25)]"
                    : isDone
                      ? "bg-emerald-500 border-emerald-500 text-white"
                      : "bg-[var(--bg-card)] border-[var(--border-2)] text-[var(--text-3)] group-hover:border-[var(--border-2)] group-hover:text-[var(--text-2)]"
                }`}
              >
                {isDone ? <Check size={13} strokeWidth={3} /> : s.step}
              </div>
              <div className="lg:pt-0.5">
                <div className="hidden lg:block text-[11px] uppercase tracking-[0.08em] font-semibold text-[var(--text-3)]">
                  {s.label}
                </div>
                <div
                  className={`text-[13px] lg:text-sm lg:mt-0.5 whitespace-nowrap transition-colors ${
                    isActive
                      ? "text-[var(--text-1)] font-semibold"
                      : isDone
                        ? "text-[var(--text-2)] font-medium"
                        : "text-[var(--text-2)] font-medium group-hover:text-[var(--text-1)]"
                  }`}
                >
                  {s.name}
                </div>
                <div className="hidden lg:block text-[11px] mt-1 leading-snug text-[var(--text-3)]">
                  {s.defaultSummary}
                </div>
              </div>
              {!isLast && (
                <span
                  aria-hidden
                  className={`hidden lg:block absolute left-[13.5px] top-[36px] bottom-[-10px] w-[1.5px] z-[1] ${
                    isDone ? "bg-emerald-500" : "bg-[var(--border-2)]"
                  }`}
                />
              )}
              {!isLast && (
                // Connector between steps on the horizontal strip.
                <span aria-hidden className={`lg:hidden ml-1 h-[1.5px] w-4 shrink-0 ${isDone ? "bg-emerald-500" : "bg-[var(--border-2)]"}`} />
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
