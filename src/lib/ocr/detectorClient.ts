// Client-side OCR detector bridge to the module worker.
// Creates a singleton Worker and manages request/response correlation.

type Boxes = number[][]; // polygon as [x1,y1,x2,y2,...]
import { devLog } from "@/lib/dev";

export type DetectOptions = {
  longEdgePx?: number; // Downscale so max(width,height) === longEdgePx (if larger)
  timing?: boolean; // Log timings in development
};

type WorkerOk = { id: string; ok: true; boxes: Boxes };
type WorkerErr = { id: string; ok: false; error: string };

type Pending = {
  resolve: (boxes: Boxes) => void;
  reject: (err: unknown) => void;
};

let workerInstance: Worker | null = null;
const pending = new Map<string, Pending>();

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getWorker(): Worker {
  if (workerInstance) return workerInstance;
  if (typeof window === "undefined") {
    throw new Error("ocr detector worker can only be used in the browser");
  }
  // Create a module worker referencing the TS source; Next/Turbopack resolves this via bundler URL handling.
  workerInstance = new Worker(new URL("../../workers/ocrWorker.ts", import.meta.url), { type: "module" });

  workerInstance.onmessage = (ev: MessageEvent<WorkerOk | WorkerErr>) => {
    const data = ev.data as WorkerOk | WorkerErr;
    const entry = pending.get(data.id);
    if (!entry) return; // unknown or already handled
    pending.delete(data.id);
    if (data.ok) {
      entry.resolve(data.boxes);
    } else {
      entry.reject(new Error(data.error));
    }
  };

  workerInstance.onerror = (ev) => {
    // Propagate a generic error to all pending requests, then reset the worker.
    const err = new Error((ev as ErrorEvent)?.message || "Worker error");
    for (const [, p] of pending) p.reject(err);
    pending.clear();
    try { workerInstance?.terminate(); } catch {}
    workerInstance = null;
  };

  workerInstance.onmessageerror = () => {
    const err = new Error("Worker message deserialization error");
    for (const [, p] of pending) p.reject(err);
    pending.clear();
    try { workerInstance?.terminate(); } catch {}
    workerInstance = null;
  };

  return workerInstance;
}

export async function detectBoxesFromCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  opts: DetectOptions = {}
): Promise<Boxes> {
  const worker = getWorker();
  const id = genId();

  const { longEdgePx = 1280, timing = true } = opts;

  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

  // Dimensions
  const origW = (canvas as HTMLCanvasElement | OffscreenCanvas).width;
  const origH = (canvas as HTMLCanvasElement | OffscreenCanvas).height;
  const longEdge = Math.max(origW, origH) || 1;
  const needsDownscale = longEdge > longEdgePx;
  const scale = needsDownscale ? longEdgePx / longEdge : 1;
  const dsW = Math.max(1, Math.round(origW * scale));
  const dsH = Math.max(1, Math.round(origH * scale));

  // Downscale to a temporary canvas if needed
  let sourceForBitmap: HTMLCanvasElement | OffscreenCanvas = canvas;
  if (needsDownscale) {
    if (typeof OffscreenCanvas !== "undefined") {
      const tmp = new OffscreenCanvas(dsW, dsH);
      const ctx = tmp.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
      if (!ctx) throw new Error("2D context unavailable for OffscreenCanvas");
      ctx.imageSmoothingEnabled = true;
      if ("imageSmoothingQuality" in ctx) {
        (ctx as OffscreenCanvasRenderingContext2D & { imageSmoothingQuality?: "low" | "medium" | "high" }).imageSmoothingQuality = "high";
      }
      ctx.drawImage(canvas as HTMLCanvasElement | OffscreenCanvas, 0, 0, dsW, dsH);
      sourceForBitmap = tmp;
    } else {
      const tmp = document.createElement("canvas");
      tmp.width = dsW;
      tmp.height = dsH;
      const ctx = tmp.getContext("2d");
      if (!ctx) throw new Error("2D context unavailable for Canvas");
      ctx.imageSmoothingEnabled = true;
      if ("imageSmoothingQuality" in (ctx as CanvasRenderingContext2D)) {
        (ctx as CanvasRenderingContext2D & { imageSmoothingQuality?: "low" | "medium" | "high" }).imageSmoothingQuality = "high";
      }
      ctx.drawImage(canvas as HTMLCanvasElement | OffscreenCanvas, 0, 0, dsW, dsH);
      sourceForBitmap = tmp;
    }
  }

  const imageBitmap = await createImageBitmap(sourceForBitmap as HTMLCanvasElement | OffscreenCanvas);
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();

  return new Promise<Boxes>((resolve, reject) => {
    // Handle response: measure infer + scale timings and upscale polygons to original coordinates
    pending.set(id, {
      resolve: (boxes: Boxes) => {
        const t2 = typeof performance !== "undefined" ? performance.now() : Date.now();
        const inv = 1 / (scale || 1);
        const s0 = typeof performance !== "undefined" ? performance.now() : Date.now();
        const scaled = boxes.map((poly) => {
          if (!needsDownscale || scale === 1) return poly.slice();
          const out: number[] = new Array(poly.length);
          for (let i = 0; i < poly.length; i += 2) {
            out[i] = poly[i] * inv;
            out[i + 1] = poly[i + 1] * inv;
          }
          return out;
        });
        const s1 = typeof performance !== "undefined" ? performance.now() : Date.now();

        if (timing) {
          // Pretty, compact timing log
          // prepare = downscale + bitmap, infer = worker roundtrip, scale = polygon scaling, total = end-start
          const prepare = (t1 as number) - (t0 as number);
          const infer = (t2 as number) - (t1 as number);
          const scaleTime = (s1 as number) - (s0 as number);
          const total = (s1 as number) - (t0 as number);
          devLog(
            `[detector] ${origW}x${origH} -> ${dsW}x${dsH} (x${(inv).toFixed(2)}) | prep ${prepare.toFixed(1)}ms, infer ${infer.toFixed(1)}ms, scale ${scaleTime.toFixed(1)}ms, total ${total.toFixed(1)}ms`
          );
        }

        resolve(scaled);
      },
      reject,
    });

    // Transfer the ImageBitmap to the worker to avoid cloning cost and free main-thread memory.
    try {
      worker.postMessage({ id, imageBitmap }, [imageBitmap as unknown as Transferable]);
    } catch (e) {
      // Ensure bitmap is closed on failure and promise is rejected
      try { imageBitmap.close(); } catch {}
      pending.delete(id);
      reject(e);
    }
  });
}

export function disposeDetectorWorker(): void {
  if (workerInstance) {
    try { workerInstance.terminate(); } catch {}
    workerInstance = null;
  }
  // Reject any outstanding requests to avoid hanging promises.
  const err = new Error("Worker disposed");
  for (const [, p] of pending) p.reject(err);
  pending.clear();
}

export {};
