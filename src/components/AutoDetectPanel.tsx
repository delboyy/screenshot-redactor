"use client";

import React from "react";
import type { RefObject } from "react";
import { detectBoxesFromCanvas } from "@/lib/ocr/detectorClient";
import { polyToRect, inflateRect, nmsMergeRects, type Rect } from "@/lib/ocr/geom";

type Props = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onApply(rects: Rect[]): void;
};

export default function AutoDetectPanel({ canvasRef, onApply }: Props) {
  const [working, setWorking] = React.useState(false);
  const runningRef = React.useRef(false);
  const [baseRects, setBaseRects] = React.useState<Rect[]>([]);
  const [padding, setPadding] = React.useState(4); // px
  const [mergeEnabled, setMergeEnabled] = React.useState(true);
  const [mergeDistance, setMergeDistance] = React.useState(6); // px
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Overlay alignment to the canvas
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const [overlayBox, setOverlayBox] = React.useState({ left: 0, top: 0, width: 0, height: 0, scaleX: 1, scaleY: 1 });

  const updateOverlayBox = React.useCallback(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;
    const parent = overlay.parentElement || document.body;
    const cb = canvas.getBoundingClientRect();
    const pb = parent.getBoundingClientRect();
    const left = cb.left - pb.left;
    const top = cb.top - pb.top;
    const width = cb.width;
    const height = cb.height;
    const scaleX = width / (canvas.width || 1);
    const scaleY = height / (canvas.height || 1);
    setOverlayBox({ left, top, width, height, scaleX, scaleY });
  }, [canvasRef]);

  React.useEffect(() => {
    updateOverlayBox();
    const ro = new ResizeObserver(() => updateOverlayBox());
    if (canvasRef.current) ro.observe(canvasRef.current);
    const onScroll = () => updateOverlayBox();
    window.addEventListener("resize", updateOverlayBox);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateOverlayBox);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [canvasRef, updateOverlayBox]);

  const previewRects = React.useMemo(() => {
    const infl = baseRects.map((r) => inflateRect(r, padding));
    if (!mergeEnabled) return infl;
    return nmsMergeRects(infl, { iouThresh: 0.15, distancePx: mergeDistance });
  }, [baseRects, padding, mergeEnabled, mergeDistance]);

  // selection maps to previewRects
  const [selected, setSelected] = React.useState<boolean[]>([]);
  React.useEffect(() => {
    setSelected(previewRects.map(() => true));
  }, [previewRects]);

  const toggleIdx = (i: number) => {
    setSelected((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  };

  const onSelectAll = () => setSelected(previewRects.map(() => true));
  const onClear = () => setSelected(previewRects.map(() => false));

  const runDetect = async () => {
    if (working || runningRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setWorking(true);
    runningRef.current = true;
    try {
      const polys = await detectBoxesFromCanvas(canvas, { longEdgePx: 1280, timing: true });
      const rects = polys.map((p) => polyToRect(p)).filter((r) => r.width > 0 && r.height > 0);
      setBaseRects(rects);
    } catch (e) {
      console.warn("Auto-detect failed:", e);
      setErrorMsg("Auto-detect failed. Please try again.");
      setBaseRects([]);
      // Clear message after a short delay
      setTimeout(() => setErrorMsg(null), 2500);
    } finally {
      setWorking(false);
      runningRef.current = false;
    }
  };

  const apply = () => {
    const finalRects: Rect[] = [];
    for (let i = 0; i < previewRects.length; i++) {
      if (selected[i]) finalRects.push(previewRects[i]);
    }
    onApply(finalRects);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button
          className="rounded border px-3 py-1 text-sm hover:bg-secondary disabled:opacity-60"
          onClick={runDetect}
          disabled={working}
        >
          {working ? "Detecting…" : "Auto-detect text (beta)"}
        </button>
        <div className="ml-2 flex items-center gap-2 text-xs">
          <label>Padding</label>
          <input
            type="range"
            min={0}
            max={12}
            value={padding}
            onChange={(e) => setPadding(Number(e.currentTarget.value))}
          />
          <span className="w-6 text-right">{padding}</span>
        </div>
        <div className="ml-4 flex items-center gap-2 text-xs">
          <label className="inline-flex items-center gap-1">
            <input type="checkbox" checked={mergeEnabled} onChange={(e) => setMergeEnabled(e.currentTarget.checked)} />
            Merge
          </label>
          <input
            type="range"
            min={0}
            max={12}
            value={mergeDistance}
            disabled={!mergeEnabled}
            onChange={(e) => setMergeDistance(Number(e.currentTarget.value))}
          />
          <span className="w-6 text-right">{mergeDistance}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="rounded border px-2 py-1 text-xs hover:bg-secondary" onClick={onSelectAll} disabled={previewRects.length === 0}>
            Select all
          </button>
          <button className="rounded border px-2 py-1 text-xs hover:bg-secondary" onClick={onClear} disabled={previewRects.length === 0}>
            Clear
          </button>
          <button className="rounded border px-2 py-1 text-xs hover:bg-secondary" onClick={apply} disabled={previewRects.length === 0}>
            Apply
          </button>
        </div>
      </div>

      {/* Overlay positioned over the canvas within the same container */}
      <div ref={overlayRef} className="pointer-events-none absolute inset-0" style={{ position: "absolute" }}>
        <div
          className="pointer-events-none absolute"
          style={{
            left: overlayBox.left,
            top: overlayBox.top,
            width: overlayBox.width,
            height: overlayBox.height,
          }}
        >
          {previewRects.map((r, idx) => {
            const sel = selected[idx];
            const x = r.x * overlayBox.scaleX;
            const y = r.y * overlayBox.scaleY;
            const w = r.width * overlayBox.scaleX;
            const h = r.height * overlayBox.scaleY;
            return (
              <div
                key={idx}
                className="absolute"
                style={{
                  left: x,
                  top: y,
                  width: w,
                  height: h,
                  border: sel ? "2px solid #22c55e" : "2px dashed rgba(34,197,94,0.6)",
                  background: sel ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.08)",
                  borderRadius: 4,
                  pointerEvents: "auto",
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // enable pointer events just for this click
                  toggleIdx(idx);
                }}
                // Allow clicking even though container has pointer-events-none
                onMouseDown={(e) => e.stopPropagation()}
              />
            );
          })}
          {working && (
            <div className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-white">
              Detecting…
            </div>
          )}
          {errorMsg && (
            <div className="absolute left-2 top-2 rounded bg-red-600/90 px-2 py-1 text-xs text-white">
              {errorMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
