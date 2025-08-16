"use client";

import React from "react";
import Link from "next/link";

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

  const undoStack = React.useRef<ImageData[]>([]);
  const redoStack = React.useRef<ImageData[]>([]);

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
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `redacted.${format.toLowerCase()}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
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
        {/* Sidebar placeholder for future detections */}
        <aside className="hidden border-r bg-card md:block">
          <div className="sticky top-0 border-b p-4">
            <h3 className="text-sm font-medium">Selections</h3>
            <p className="mt-1 text-xs text-muted-foreground">Manual rectangles you apply</p>
          </div>
          <div className="p-4 text-sm text-muted-foreground">Auto-detection coming soon.</div>
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
                  title="Warning: Can be reversed"
                >
                  Blur ⚠️
                </button>
                <button
                  className={`rounded border px-3 py-1 text-sm hover:bg-secondary ${tool === "pixelate" ? "bg-blue-600 text-white border-blue-600" : ""}`}
                  onClick={() => setTool("pixelate")}
                  title="Warning: Can be reversed"
                >
                  Pixelate ⚠️
                </button>
              </div>
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


