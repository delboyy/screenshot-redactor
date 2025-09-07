"use client";

import React from "react";
import { useDetections } from "@/store/detections";

type Props = {
  onFocusDetection?: (id: string) => void;
  minConfidence: number;
  autoMode: "blackout" | "blur" | "pixelate";
  onChangeAutoMode: (m: "blackout" | "blur" | "pixelate") => void;
  onApplyAccepted: () => void;
  onApplyType: (type: string) => void;
};

const TYPE_ORDER = ["email", "phone", "url", "ipv4", "credit_card", "name"] as const;

const TYPE_LABEL: Record<string, string> = {
  email: "Email",
  phone: "Phone",
  url: "URL",
  ipv4: "IP",
  credit_card: "Credit Card",
  name: "Name",
};

const TYPE_BADGE: Record<string, string> = {
  email: "bg-blue-500/15 text-blue-400",
  phone: "bg-emerald-500/15 text-emerald-400",
  url: "bg-cyan-500/15 text-cyan-400",
  ipv4: "bg-violet-500/15 text-violet-400",
  credit_card: "bg-amber-500/15 text-amber-400",
  name: "bg-pink-500/15 text-pink-400",
};

export default function DetectionPanel({ onFocusDetection, minConfidence, autoMode, onChangeAutoMode, onApplyAccepted, onApplyType }: Props) {
  const { detections, grouped, acceptedById, setAccepted, acceptAllOfType, rejectAllOfType } = useDetections();

  const total = detections.length;

  return (
    <div className="h-full overflow-auto">
      <div className="border-b p-4">
        <div className="text-sm font-medium">Detections</div>
        <div className="mt-1 text-xs text-muted-foreground">Found {total} items • Threshold {minConfidence}%</div>
        <div className="mt-2 flex items-center gap-2">
          <label className="text-xs">Redact as</label>
          <select
            className="h-7 rounded border bg-background px-2 text-xs"
            value={autoMode}
            onChange={(e) => onChangeAutoMode(e.target.value as "blackout" | "blur" | "pixelate")}
          >
            <option value="blackout">Black Bar</option>
            <option value="blur">Blur</option>
            <option value="pixelate">Pixelate</option>
          </select>
          <button className="ml-auto rounded border px-2 py-1 text-xs hover:bg-secondary" onClick={onApplyAccepted}>
            Apply to accepted
          </button>
        </div>
      </div>

      <div className="p-2">
        {TYPE_ORDER.map((t) => {
          const list = grouped[t] || [];
          if (list.length === 0) return null;
          // Removed unused variables: acceptedCount, openId
          return (
            <details key={t} open className="mb-2 rounded border bg-card">
              <summary className="flex cursor-pointer items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] ${TYPE_BADGE[t]}`}>{TYPE_LABEL[t]}</span>
                  <span className="text-xs text-muted-foreground">{list.length} items</span>
                </div>
                <div className="flex items-center gap-2">
                  <button className="rounded border px-2 py-1 text-xs hover:bg-secondary" onClick={(e) => { e.preventDefault(); acceptAllOfType(t); onApplyType(t); }}>Accept All</button>
                  <button className="rounded border px-2 py-1 text-xs hover:bg-secondary" onClick={(e) => { e.preventDefault(); rejectAllOfType(t); }}>Reject All</button>
                </div>
              </summary>

              <div className="divide-y">
                {list.map((d) => (
                  <div key={d.id} className="flex items-start gap-2 px-3 py-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={!!acceptedById[d.id]}
                      onChange={(e) => setAccepted(d.id, e.target.checked)}
                    />
                    <button
                      className="group flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                      onClick={() => onFocusDetection?.(d.id)}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm">{d.text}</div>
                        <div className="text-[10px] text-muted-foreground">{TYPE_LABEL[d.type]}</div>
                      </div>
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground group-hover:bg-secondary/80">{Math.round(d.confidence)}%</span>
                    </button>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}


