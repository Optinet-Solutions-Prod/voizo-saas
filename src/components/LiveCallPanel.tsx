"use client";

import { useEffect, useRef } from "react";
import { Loader2, Mic, MicOff, Phone, PhoneOff, Sparkles } from "lucide-react";
import type { useVapiWebCall } from "@/lib/useVapiWebCall";

// The in-call view shared by the in-app "Try an agent" page and the public demo modal:
// status row with the End button, the two level meters, and the live transcript.

const PRIMARY = "#4d90f0";

export function formatSeconds(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default function LiveCallPanel({ call, agentName, transcriptClass = "min-h-[220px] max-h-[40vh]" }: {
  call: ReturnType<typeof useVapiWebCall>;
  agentName: string;
  transcriptClass?: string;
}) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => { transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" }); }, [call.transcript]);

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3.5 py-3">
        <span className={`relative flex h-9 w-9 items-center justify-center rounded-full ${call.status === "live" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-300"}`}>
          {call.status === "live" && <span className="lp-ping absolute inset-0 rounded-full bg-emerald-400/40" />}
          {call.status === "mic" ? <Mic size={16} /> : call.status === "connecting" ? <Loader2 size={16} className="animate-spin" /> : <Phone size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--text-1)]">{call.status === "mic" ? "Checking your microphone…" : call.status === "connecting" ? "Connecting to the agent…" : call.assistantSpeaking ? `${agentName} is speaking` : "Listening — go ahead and talk"}</p>
          <p className="text-[11px] text-[var(--text-3)]">{call.mic.deviceLabel ? `Mic: ${call.mic.deviceLabel}` : "Mic: waiting for permission"}</p>
        </div>
        <span className="font-mono text-sm text-[var(--text-2)]">{formatSeconds(call.seconds)}</span>
        <button type="button" onClick={call.stop} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-500"><PhoneOff size={13} /> End</button>
      </div>
      <div className="grid grid-cols-2 gap-3 text-[11px] text-[var(--text-3)]">
        <div>
          <div className="mb-1 flex items-center gap-1.5">{call.mic.ok ? <Mic size={12} /> : <MicOff size={12} />} You</div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]"><div className="h-full rounded-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${Math.round(call.mic.level * 100)}%` }} /></div>
        </div>
        <div>
          <div className="mb-1 flex items-center gap-1.5"><Sparkles size={12} /> {agentName}</div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]"><div className="h-full rounded-full transition-[width] duration-75" style={{ width: `${Math.round(Math.min(1, call.assistantLevel * 3) * 100)}%`, background: PRIMARY }} /></div>
        </div>
      </div>
      {call.status === "live" && call.mic.level < 0.02 && call.seconds > 6 && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">Your microphone level is flat. If the agent can&apos;t hear you, check the input device in your browser or system settings.</p>
      )}
      <div ref={transcriptRef} className={`${transcriptClass} flex-1 space-y-2 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-app)] p-3`}>
        {call.transcript.length === 0 && <p className="text-xs text-[var(--text-4)]">The conversation will appear here as you speak.</p>}
        {call.transcript.map((l, i) => (
          <div key={i} className={`flex ${l.role === "assistant" ? "justify-start" : "justify-end"}`}>
            <p className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-snug ${l.role === "assistant" ? "bg-[var(--bg-elevated)] text-[var(--text-1)] rounded-bl-md" : "text-white rounded-br-md"} ${l.final ? "" : "opacity-70"}`} style={l.role === "assistant" ? undefined : { background: PRIMARY }}>{l.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
