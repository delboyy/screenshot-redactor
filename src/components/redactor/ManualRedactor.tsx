"use client";

import React from "react";
import Link from "next/link";
import { useDetections } from "@/store/detections";
import { pipelineBasic, pipelineHighContrast } from "@/lib/imagePreprocess";
import { luhnOk, ipv4Ok } from "@/lib/pii";
import DetectionPanel from "@/components/redactor/DetectionPanel";
import { processOcrForDetections } from "@/lib/enhanced_detection";

type RedactionTool = "blackout" | "blur" | "pixelate";

type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export default function ManualRedactor() {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const overlayRef = React.useRef<HTMLCanvasElement | null>(null);
  const imageRef = React.useRef<HTMLImageElement | null>(null);

  const [error, setError] = React.useState<string | null>(null);
  const [tool, setTool] = React.useState<RedactionTool>("blackout");
  const [isDragging, setIsDragging] = React.useState(false);
  const [selection, setSelection] = React.useState<SelectionRect | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [format, setFormat] = React.useState<"PNG" | "JPG" | "WEBP">("PNG");
  const [stripExif, setStripExif] = React.useState(true);
  const [minConfidence, setMinConfidence] = React.useState(65);
  const [autoMode, setAutoMode] = React.useState<RedactionTool>("blackout");

  const undoStack = React.useRef<ImageData[]>([]);
  const redoStack = React.useRef<ImageData[]>([]);
  const overlayDivRef = React.useRef<HTMLDivElement | null>(null);
  const { setDetections } = useDetections();
  type Candidate = {
    id: string;
    type: string;
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  };
  const lastCandidatesRef = React.useRef<Candidate[]>([]);

  const get2d = (c: HTMLCanvasElement | null) => c?.getContext("2d") || null;

  const pushUndoSnapshot = React.useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = get2d(canvas);
    if (!canvas || !ctx) return;
    try {
      const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
      undoStack.current.push(snapshot);
      // Clamp history length if needed
      if (undoStack.current.length > 50) undoStack.current.shift();
    } catch (e) {
      console.warn("Failed to snapshot canvas for undo:", e);
    }
  }, []);

  const initializeCanvasWithImage = React.useCallback((img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const container = containerRef.current;
    if (!canvas || !overlay || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const maxWidth = Math.min(container.clientWidth - 32, img.width);
    const scale = Math.min(maxWidth / img.width, 1);
    const displayWidth = Math.round(img.width * scale);
    const displayHeight = Math.round(img.height * scale);

    // Internal canvas size in device pixels
    canvas.width = Math.round(displayWidth * dpr);
    canvas.height = Math.round(displayHeight * dpr);
    overlay.width = canvas.width;
    overlay.height = canvas.height;

    // CSS display size
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    overlay.style.width = canvas.style.width;
    overlay.style.height = canvas.style.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Draw in device pixels to align with selection and overlay
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Seed undo history with initial state
    pushUndoSnapshot();
    drawOverlay(null);
  }, [pushUndoSnapshot]);

  React.useEffect(() => {
    const dataUrl = sessionStorage.getItem("sr:imageDataURL");
    if (!dataUrl) {
      setError("No image found. Go back and upload a screenshot.");
      return;
    }
    const img = new Image();
    imageRef.current = img;
    img.onload = () => {
      initializeCanvasWithImage(img);
      // Kick off OCR on downscaled bitmap
      runOcrAsync();
    };
    img.onerror = () => setError("Failed to load image.");
    img.src = dataUrl;
    // Clean redo on fresh load
    redoStack.current = [];
  }, [initializeCanvasWithImage]);

  

  const undo = () => {
    const canvas = canvasRef.current;
    const ctx = get2d(canvas);
    if (!canvas || !ctx) return;
    if (undoStack.current.length <= 1) return; // Keep at least initial state
    const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    redoStack.current.push(current);
    const previous = undoStack.current[undoStack.current.length - 2];
    undoStack.current.pop();
    ctx.putImageData(previous, 0, 0);
  };

  const redo = () => {
    const canvas = canvasRef.current;
    const ctx = get2d(canvas);
    if (!canvas || !ctx) return;
    const next = redoStack.current.pop();
    if (!next) return;
    pushUndoSnapshot();
    ctx.putImageData(next, 0, 0);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!overlayRef.current || !canvasRef.current) return;
    overlayRef.current.setPointerCapture(e.pointerId);
    setIsDragging(true);
    const start = clientToCanvasCoords(e.clientX, e.clientY);
    setSelection({ x: start.x, y: start.y, width: 0, height: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !selection) return;
    const current = clientToCanvasCoords(e.clientX, e.clientY);
    const updated: SelectionRect = normalizeRect({
      x: selection.x,
      y: selection.y,
      width: current.x - selection.x,
      height: current.y - selection.y,
    });
    setSelection(updated);
    drawOverlay(updated);
  };

  const onPointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (!selection) {
      drawOverlay(null);
      return;
    }
    applyEffect(selection, tool);
    setSelection(null);
    drawOverlay(null);
  };

  const clientToCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width; // accounts for DPR and zoom
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    return { x, y };
  };

  const normalizeRect = (rect: SelectionRect): SelectionRect => {
    const { x, y, width, height } = rect;
    const nx = width < 0 ? x + width : x;
    const ny = height < 0 ? y + height : y;
    return {
      x: Math.round(nx),
      y: Math.round(ny),
      width: Math.round(Math.abs(width)),
      height: Math.round(Math.abs(height)),
    };
  };

  const drawOverlay = (rect: SelectionRect | null) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!rect) return;
    ctx.save();
    ctx.strokeStyle = "#2563EB"; // Tailwind blue-600
    ctx.lineWidth = 2;
    ctx.fillStyle = "rgba(37, 99, 235, 0.15)";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
  };

  // OCR integration
  const runOcrAsync = React.useCallback(async () => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Preprocess with two pipelines; try basic first, then high-contrast
      const pass1 = pipelineBasic(canvas);
      const pass2 = pipelineHighContrast(canvas);
      const dataUrl1 = pass1.canvas.toDataURL("image/png");
      const dataUrl2 = pass2.canvas.toDataURL("image/png");

      const WorkerCtor = await (async () => {
        // Using new Worker with module
        const mod = new URL("../../workers/ocrWorker.ts", import.meta.url);
        return new Worker(mod, { type: "module" });
      })();

      await new Promise<void>((resolve, reject) => {
        const onMessage = (ev: MessageEvent) => {
          if (ev.data?.type === "ready") {
            WorkerCtor.removeEventListener("message", onMessage);
            resolve();
          }
        };
        WorkerCtor.addEventListener("message", onMessage);
        WorkerCtor.postMessage({ type: "init" });
        setTimeout(() => reject(new Error("OCR init timeout")), 10000);
      });

      const runOnce = (payloadUrl: string) => new Promise<{ ocr: { width: number; height: number; scaleX: number; scaleY: number; lines: Array<{ words: Array<{ text: string; conf: number; bbox: { x: number; y: number; w: number; h: number } }>; joined: string; spans: { start: number; end: number; wordIdx: number }[]; meanCharWidth: number }> } }>((resolve, reject) => {
        const onMessage = (ev: MessageEvent) => {
          if (ev.data?.type === "result") {
            WorkerCtor.removeEventListener("message", onMessage);
            resolve(ev.data.payload);
          } else if (ev.data?.type === "error") {
            WorkerCtor.removeEventListener("message", onMessage);
            reject(new Error(ev.data.payload.message));
          }
        };
        WorkerCtor.addEventListener("message", onMessage);
        WorkerCtor.postMessage({ type: "run", payload: { imageBitmapDataURL: payloadUrl } });
      });

      let payload = await runOnce(dataUrl1);
      // If few or no words, try the second pass
      if (!payload || payload.ocr.lines.length < 1) {
        payload = await runOnce(dataUrl2);
      }

      // Line-aware detection based on worker OCR space; map to full-res using returned scales
      const scaleX = payload.ocr.scaleX;
      const scaleY = payload.ocr.scaleY;
      // NEW CODE (using the enhanced detection):
      const detectionsMapped = processOcrForDetections(payload.ocr, minConfidence);
      const candidates = detectionsMapped.map(d => ({
       id: d.id,
       type: d.type,
       text: d.text,
       confidence: d.confidence,
       bbox: { x0: d.bbox.x0, y0: d.bbox.y0, x1: d.bbox.x1, y1: d.bbox.y1 },
      }));
lastCandidatesRef.current = candidates;
setDetections(detectionsMapped);
      // Render suggestion overlays as HTML boxes layered above
      renderOverlayBoxes(detectionsMapped);

      WorkerCtor.terminate();
    } catch (err) {
      console.warn("OCR error:", err);
    }
  }, [setDetections, minConfidence]);

  // Build detections per line using whitespace-tolerant regex and word span mapping
  function buildLineDetectionsFromOcr(
    lines: Array<{ words: Array<{ text: string; conf: number; bbox: { x: number; y: number; w: number; h: number } }>; joined: string; spans: { start: number; end: number; wordIdx: number }[]; meanCharWidth: number }>
  ) {
    // index words by y-band (line bbox)
    const lineDetections: Array<{ type: string; text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; confidence: number }> = [];
    for (const ln of lines) {
      let J = ln.joined || "";
      // normalization of lookalikes and variants
      J = J
        .replace(/[\uFF1A\uFE55\uA789]/g, ":") // fullwidth/variant colons
        .replace(/[\uFF0F]/g, "/") // fullwidth slash
        .replace(/[\uFF20]/g, "@") // fullwidth at
        .replace(/[\u00B7\u2022\u2219]/g, ".") // middot/bullets to dot
        .replace(/\s+/g, (m) => (m.length >= 2 ? "  " : " ")) // keep double spaces inserted by gap guard
        .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " "); // unicode spaces to ASCII space

      // at/dot variants → canonical
      J = J.replace(/\s*(?:\(at\)|\[at\]|\{at\}|\bat\b)\s*/gi, "@");
      J = J.replace(/\s*(?:\(dot\)|\[dot\]|\{dot\}|\bdot\b)\s*/gi, ".");
      // regex with whitespace tolerance
      const patterns: Array<{ type: string; re: RegExp }> = [
        { type: "credit_card", re: /(?:\d[\s-]?){13,19}/g },
        { type: "email", re: /[A-Za-z0-9._%+-]+\s*(?:\(at\)|\[at\]|\{at\}|@|\bat\b)\s*[A-Za-z0-9.-]+\s*(?:\(dot\)|\[dot\]|\{dot\}|\.|\bdot\b)\s*[A-Za-z]{2,}/gi },
        { type: "url", re: /(https?)[\s]*:[\s]*\/[\s]*\/(?:[\w-]+[\s]*\.)+[\w-]{2,}(?:\/[\S]*)?/gi },
        { type: "ipv4", re: /(\d{1,3})\s*\.\s*(\d{1,3})\s*\.\s*(\d{1,3})\s*\.\s*(\d{1,3})/g },
        { type: "phone", re: /\+?\d[\d\s()\-]{6,}/g },
      ];
      for (const { type, re } of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(J)) !== null) {
          const spanStart = m.index;
          const spanEnd = m.index + m[0].length;
          // Map span to words on this line
          const inSpan = ln.spans
            .filter(({ start, end }) => end > spanStart && start < spanEnd)
            .map(({ wordIdx }) => ln.words[wordIdx]);
          if (inSpan.length === 0) continue;
          const text = normalizeForType(inSpan.map((w) => w.text).join(" "));
          const bbox = unionBBoxes(inSpan.map((w) => ({ x0: w.bbox.x, y0: w.bbox.y, x1: w.bbox.x + w.bbox.w, y1: w.bbox.y + w.bbox.h })));
          const confidence = Math.min(...inSpan.map((w) => w.conf));
          // Sanity guard on extremely flat spans for CC/IP
          const textHeight = bbox.y1 - bbox.y0;
          const textWidth = bbox.x1 - bbox.x0;
          if ((type === "credit_card" || type === "ipv4") && textWidth > 40 * Math.max(1, textHeight)) continue;
          // strict validators and type preference handled by pattern order
          if (type === "credit_card" && !luhnOk(text)) continue;
          if (type === "ipv4" && !ipv4Ok(text.replace(/\s+/g, ""))) continue;
          lineDetections.push({ type, text, bbox, confidence });
        }
      }
    }
    return lineDetections;
  }

  function unionBBoxes(bboxes: Array<{ x0: number; y0: number; x1: number; y1: number }>) {
    return {
      x0: Math.min(...bboxes.map((b) => b.x0)),
      y0: Math.min(...bboxes.map((b) => b.y0)),
      x1: Math.max(...bboxes.map((b) => b.x1)),
      y1: Math.max(...bboxes.map((b) => b.y1)),
    };
  }

  function overlapY(a: { y0: number; y1: number }, b: { y0: number; y1: number }) {
    const top = Math.max(a.y0, b.y0);
    const bottom = Math.min(a.y1, b.y1);
    const inter = Math.max(0, bottom - top);
    const height = Math.max(1, Math.min(a.y1 - a.y0, b.y1 - b.y0));
    return inter / height;
  }

  function normalizeForType(s: string) {
    return s
      .replace(/\s*\(at\)\s*|\s*\[at\]\s*|\s*\{at\}\s*|\bat\b/gi, "@")
      .replace(/\s*\(dot\)\s*|\s*\[dot\]\s*|\s*\{dot\}\s*|\bdot\b/gi, ".")
      .replace(/\s+/g, " ")
      .trim();
  }

  React.useEffect(() => {
    // Re-filter current candidates when slider changes
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const filtered = filterDetections(lastCandidatesRef.current, canvasEl, minConfidence);
    setDetections(filtered);
    renderOverlayBoxes(filtered);
  }, [minConfidence, zoom, setDetections]); // ADD zoom here

  // Ensure overlay scales when zoom changes
  React.useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const filtered = filterDetections(lastCandidatesRef.current, canvasEl, minConfidence);
    renderOverlayBoxes(filtered);
  }, [zoom, minConfidence]);

  function filterDetections(
    items: Array<{
      id: string;
      type: string;
      text: string;
      confidence: number;
      bbox: { x0: number; y0: number; x1: number; y1: number };
    }>,
    canvasEl: HTMLCanvasElement,
    threshold: number
  ) {
    // use slider-provided threshold
    const minConfidence = threshold; // 0-100
    const width = canvasEl.width;
    const height = canvasEl.height;
    // Heuristic UI band to ignore (toolbar). Relax to 8% to avoid hitting content.
    const ignoreTopPx = Math.floor(height * 0.08);

    const withinUi = (b: { y0: number; y1: number }) => b.y1 < ignoreTopPx;

    const lengthOk = (type: string, text: string) => {
      const t = text.trim();
      switch (type) {
        case "email":
          return t.length >= 6 && t.length <= 254;
        case "url":
          return t.length >= 8 && t.length <= 2083;
        case "ipv4":
          return t.length >= 7 && t.length <= 15;
        case "phone":
          return t.replace(/\D/g, "").length >= 7 && t.replace(/\D/g, "").length <= 15;
        case "credit_card":
          return t.replace(/\D/g, "").length >= 13 && t.replace(/\D/g, "").length <= 19;
        case "name":
          return t.length >= 3 && t.length <= 64;
        default:
          return true;
      }
    };

    return items.filter((d) => {
      if (d.confidence < minConfidence) return false;
      if (!lengthOk(d.type, d.text)) return false;
      if (withinUi(d.bbox)) return false;
      // Discard extremely wide/flat boxes typical of rulers/menus
      const w = d.bbox.x1 - d.bbox.x0;
      const h = d.bbox.y1 - d.bbox.y0;
      if (w > width * 0.9 && h < height * 0.02) return false;
      return true;
    });
  }

  function renderOverlayBoxes(detections: Array<{ bbox: { x0: number; y0: number; x1: number; y1: number }, type: string, text: string }>) {
    const overlayDiv = overlayDivRef.current;
    const canvasEl = canvasRef.current;
    if (!(overlayDiv && canvasEl)) return;
    
    // Clear existing boxes efficiently
    overlayDiv.innerHTML = "";
    
    const canvasRect = canvasEl.getBoundingClientRect();
    // IMPORTANT: Account for zoom level in scaling
    const scaleX = (canvasRect.width / canvasEl.width) * zoom;
    const scaleY = (canvasRect.height / canvasEl.height) * zoom;
    
    // Create a document fragment to avoid multiple DOM updates
    const fragment = document.createDocumentFragment();
    
    detections.forEach((det) => {
      const d = document.createElement("div");
      d.style.position = "absolute";
      d.style.left = `${det.bbox.x0 * scaleX}px`;
      d.style.top = `${det.bbox.y0 * scaleY}px`;
      d.style.width = `${(det.bbox.x1 - det.bbox.x0) * scaleX}px`;
      d.style.height = `${(det.bbox.y1 - det.bbox.y0) * scaleY}px`;
      d.style.border = "2px solid #22c55e";
      d.style.background = "rgba(34,197,94,0.1)";
      d.style.borderRadius = "4px";
      d.style.pointerEvents = "none";
      d.style.zIndex = "10";
      d.title = `${det.type}: ${det.text}`;
      fragment.appendChild(d);
    });
    
    // Single DOM update
    overlayDiv.appendChild(fragment);
  }
  const applyEffect = (rect: SelectionRect, toolToApply: RedactionTool) => {
    const canvas = canvasRef.current;
    const ctx = get2d(canvas);
    if (!canvas || !ctx) return;
    if (rect.width === 0 || rect.height === 0) return;

    pushUndoSnapshot();
    redoStack.current = [];

    switch (toolToApply) {
      case "blackout": {
        ctx.save();
        ctx.fillStyle = "#000000";
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        ctx.restore();
        break;
      }
      case "blur": {
        const imageData = ctx.getImageData(rect.x, rect.y, rect.width, rect.height);
        const BLUR_RADIUS = 10;
        const PASSES = 2;
        let blurred = imageData;
        for (let i = 0; i < PASSES; i++) {
          blurred = boxBlur(blurred, BLUR_RADIUS);
        }
        ctx.putImageData(blurred, rect.x, rect.y);
        break;
      }
      case "pixelate": {
        pixelate(ctx, rect.x, rect.y, rect.width, rect.height, 10);
        break;
      }
    }
  };

  const boxBlur = (imageData: ImageData, radius: number) => {
    const { data, width, height } = imageData;
    const original = new Uint8ClampedArray(data);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, a = 0, count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const idx = (ny * width + nx) * 4;
              r += original[idx + 0];
              g += original[idx + 1];
              b += original[idx + 2];
              a += original[idx + 3];
              count++;
            }
          }
        }
        const i = (y * width + x) * 4;
        data[i + 0] = Math.round(r / count);
        data[i + 1] = Math.round(g / count);
        data[i + 2] = Math.round(b / count);
        data[i + 3] = Math.round(a / count);
      }
    }
    return imageData;
  };

  const pixelate = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    blockSize: number
  ) => {
    for (let py = y; py < y + height; py += blockSize) {
      for (let px = x; px < x + width; px += blockSize) {
        const bw = Math.min(blockSize, x + width - px);
        const bh = Math.min(blockSize, y + height - py);
        const block = ctx.getImageData(px, py, bw, bh);
        const data = block.data;
        let r = 0, g = 0, b = 0, a = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i + 0];
          g += data[i + 1];
          b += data[i + 2];
          a += data[i + 3];
          count++;
        }
        if (count > 0) {
          const rr = Math.round(r / count);
          const gg = Math.round(g / count);
          const bb = Math.round(b / count);
          const aa = Math.round(a / count);
          for (let i = 0; i < data.length; i += 4) {
            data[i + 0] = rr;
            data[i + 1] = gg;
            data[i + 2] = bb;
            data[i + 3] = aa;
          }
        }
        ctx.putImageData(block, px, py);
      }
    }
  };

  const handleExport = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let mime = "image/png";
    let quality = 1;
    if (format === "JPG") {
      mime = "image/jpeg";
      quality = 0.92;
    } else if (format === "WEBP") {
      mime = "image/webp";
      quality = 0.92;
    }
    let dataUrl = canvas.toDataURL(mime, quality);
    if (stripExif && mime === "image/jpeg") {
      try {
        const mod = await import("piexifjs");
        const m = mod as unknown as { remove?: (s: string) => string; default?: { remove: (s: string) => string } };
        const remover = m.remove ?? m.default?.remove;
        if (remover) dataUrl = remover(dataUrl);
      } catch (e) {
        console.warn("EXIF strip failed:", e);
      }
    }
    const original = sessionStorage.getItem("sr:filename") || "screenshot";
    const base = original.replace(/\.[^.]+$/, "");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${base}-redacted.${format.toLowerCase()}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Success toast (simple inline)
    try {
      const div = document.createElement("div");
      div.textContent = "Redaction burned in. EXIF removed.";
      div.className = "fixed bottom-4 right-4 z-50 rounded bg-emerald-600 px-3 py-2 text-sm text-white shadow";
      document.body.appendChild(div);
      setTimeout(() => div.remove(), 2500);
    } catch {}
  };

  const changeZoom = (factor: number) => {
    setZoom((z) => {
      const next = Math.max(0.25, Math.min(5, z * factor));
      return Number(next.toFixed(2));
    });
  };

  const fitToScreen = () => setZoom(1);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl w-full p-4">
        <p className="text-destructive">{error}</p>
        <Link href="/" className="text-sm text-muted-foreground underline">Go back</Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-40px)] flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-baseline gap-2">
            <h1 className="text-xl font-semibold text-blue-600">Screenshot Redactor</h1>
            <span className="text-xs text-muted-foreground">Manual Redaction</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Privacy-first: all in your browser</span>
          </div>
        </div>
      </header>

      {/* Main grid */}
      <div className="grid min-h-[calc(100vh-120px)] flex-1 grid-rows-[1fr_auto] md:grid-cols-[280px_1fr] md:grid-rows-[1fr_auto]">
        {/* Sidebar with detection review */}
        <aside className="hidden border-r bg-card md:block">
          <div className="sticky top-0 border-b p-4">
            <h3 className="text-sm font-medium">Selections</h3>
            <p className="mt-1 text-xs text-muted-foreground">Manual rectangles you apply</p>
          </div>
          <DetectionPanel
            minConfidence={minConfidence}
            autoMode={autoMode}
            onChangeAutoMode={setAutoMode}
            onFocusDetection={(id) => {
              const d = lastCandidatesRef.current.find((x) => x.id === id);
              if (!d) return;
              // center and zoom slightly around the bbox
              const canvasEl = canvasRef.current;
              if (!canvasEl) return;
              // Compute desired zoom to make bbox ~40% of viewport width
              const view = containerRef.current;
              if (!view) return;
              const boxWidth = d.bbox.x1 - d.bbox.x0;
              const viewport = view.clientWidth;
              const desiredZoom = Math.min(5, Math.max(0.5, (0.4 * canvasEl.width) / boxWidth));
              setZoom(desiredZoom);
              // Scroll to center
              const centerX = ((d.bbox.x0 + d.bbox.x1) / 2) * (view.scrollWidth / canvasEl.width);
              const centerY = ((d.bbox.y0 + d.bbox.y1) / 2) * (view.scrollHeight / canvasEl.height);
              view.scrollTo({ left: Math.max(0, centerX - viewport / 2), top: Math.max(0, centerY - view.clientHeight / 2), behavior: "smooth" });
            }}
            onApplyAccepted={() => {
              const canvasEl = canvasRef.current;
              const ctx = get2d(canvasEl);
              if (!(canvasEl && ctx)) return;
              const items = lastCandidatesRef.current;
              // Apply to accepted only
              const { acceptedById } = useDetections.getState();
              pushUndoSnapshot();
              for (const det of items) {
                if (!acceptedById[det.id]) continue;
                const r = det.bbox;
                switch (autoMode) {
                  case "blackout":
                    ctx.save();
                    ctx.fillStyle = "#000";
                    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
                    ctx.restore();
                    break;
                  case "blur": {
                    const imageData = ctx.getImageData(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
                    let blurred = imageData;
                    for (let i = 0; i < 2; i++) blurred = boxBlur(blurred, 10);
                    ctx.putImageData(blurred, r.x0, r.y0);
                    break;
                  }
                  case "pixelate":
                    pixelate(ctx, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 10);
                    break;
                }
              }
            }}
            onApplyType={(type) => {
              const canvasEl = canvasRef.current;
              const ctx = get2d(canvasEl);
              if (!(canvasEl && ctx)) return;
              const items = lastCandidatesRef.current.filter((d) => d.type === type);
              // Mark all of type accepted first
              useDetections.getState().acceptAllOfType(type);
              pushUndoSnapshot();
              for (const det of items) {
                const r = det.bbox;
                switch (autoMode) {
                  case "blackout":
                    ctx.save();
                    ctx.fillStyle = "#000";
                    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
                    ctx.restore();
                    break;
                  case "blur": {
                    const imageData = ctx.getImageData(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
                    let blurred = imageData;
                    for (let i = 0; i < 2; i++) blurred = boxBlur(blurred, 10);
                    ctx.putImageData(blurred, r.x0, r.y0);
                    break;
                  }
                  case "pixelate":
                    pixelate(ctx, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 10);
                    break;
                }
              }
            }}
          />
        </aside>

        {/* Canvas area */}
        <div className="flex flex-col">
          {/* Controls */}
          <div className="flex items-center justify-between border-b bg-card px-4 py-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => changeZoom(0.8)}
                className="h-8 w-8 rounded border text-sm hover:bg-secondary"
                aria-label="Zoom out"
              >
                -
              </button>
              <span className="min-w-[56px] text-center text-sm">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => changeZoom(1.2)}
                className="h-8 w-8 rounded border text-sm hover:bg-secondary"
                aria-label="Zoom in"
              >
                +
              </button>
              <button
                onClick={fitToScreen}
                className="h-8 rounded border px-2 text-sm hover:bg-secondary"
              >
                Fit
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={undo}
                className="h-8 rounded border px-2 text-sm hover:bg-secondary"
              >
                Undo
              </button>
              <button
                onClick={redo}
                className="h-8 rounded border px-2 text-sm hover:bg-secondary"
              >
                Redo
              </button>
              <div className="ml-2 hidden items-center gap-2 md:flex">
                <label className="text-xs text-muted-foreground">Min conf</label>
                <input
                  type="range"
                  min={40}
                  max={95}
                  step={1}
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(Number(e.target.value))}
                />
                <span className="text-xs w-8 text-right">{minConfidence}%</span>
              </div>
            </div>
          </div>

          {/* Canvas container */}
          <div ref={containerRef} className="relative flex flex-1 items-center justify-center overflow-auto bg-[rgba(185,28,28,0.15)] p-2">
            <div
              className="relative"
              style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
            >
              <canvas ref={canvasRef} className="block rounded shadow" />
              <canvas
                ref={overlayRef}
                className="pointer-events-auto absolute left-0 top-0"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              />
              <div ref={overlayDivRef} className="pointer-events-none absolute left-0 top-0" />
            </div>
          </div>

          {/* Bottom toolbar */}
          <div className="flex flex-col items-stretch justify-between gap-3 border-t bg-card px-4 py-3 md:flex-row md:items-center">
            <div>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Redaction Tools</h4>
              <div className="flex flex-wrap gap-2">
                <button
                  className={`rounded border px-3 py-1 text-sm hover:bg-secondary ${tool === "blackout" ? "bg-blue-600 text-white border-blue-600" : ""}`}
                  onClick={() => setTool("blackout")}
                >
                  Black Bar
                </button>
                <button
                  className={`rounded border px-3 py-1 text-sm hover:bg-secondary ${tool === "blur" ? "bg-blue-600 text-white border-blue-600" : ""}`}
                  onClick={() => setTool("blur")}
                >
                  Blur
                </button>
                <button
                  className={`rounded border px-3 py-1 text-sm hover:bg-secondary ${tool === "pixelate" ? "bg-blue-600 text-white border-blue-600" : ""}`}
                  onClick={() => setTool("pixelate")}
                >
                  Pixelate
                </button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">All effects permanently overwrite pixels on the canvas.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-sm">Format</label>
                <select
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as "PNG" | "JPG" | "WEBP")}
                >
                  <option>PNG</option>
                  <option>JPG</option>
                  <option>WEBP</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={stripExif}
                  onChange={(e) => setStripExif(e.target.checked)}
                />
                Strip EXIF (JPEG)
              </label>
              <div className="text-xs text-muted-foreground">
                Removes embedded photo metadata (location, device, timestamp). Applies to JPEG exports.
              </div>
              <button
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
                onClick={handleExport}
              >
                Export Image
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


