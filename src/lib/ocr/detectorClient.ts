// Client-side detector bridge to the heuristic worker.
// Creates a singleton Worker and manages request/response correlation.

type Boxes = number[][]; // polygon as [x1,y1,x2,y2,...]
import { devLog } from "@/lib/dev";

export type DetectOptions = {
  longEdgePx?: number; // Worker downscales internally to this long edge
  sensitivity?: 'low' | 'med' | 'high';
  timing?: boolean; // Log timings in development
};

type WorkerOk = { id: string; ok: true; boxes: Boxes };
type WorkerErr = { id: string; ok: false; error: string };

type Pending = {
  resolve: (boxes: Boxes) => void;
  reject: (err: unknown) => void;
};

let worker: Worker | null = null;
const pending = new Map<string, Pending>();

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getWorker(): Worker {
  if (worker) return worker;
  // Use module worker pointing to heuristic worker
  worker = new Worker(new URL("../../workers/heuristicWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent<WorkerOk | WorkerErr>) => {
    const msg = ev.data;
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    if ((msg as WorkerOk).ok) slot.resolve((msg as WorkerOk).boxes);
    else slot.reject(new Error((msg as WorkerErr).error));
  };
  worker.onerror = (ev) => {
    // Broadcast error to all pending callers
    const err = new Error((ev as ErrorEvent)?.message || "Worker error");
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  };
  return worker;
}

export async function detectBoxesFromCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  opts: DetectOptions = {}
): Promise<Boxes> {
  const id = genId();
  const { longEdgePx = 1280, sensitivity = 'med', timing = true } = opts;

  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

  // Robust ImageBitmap creation without HTMLImageElement.decode() or WebCodecs
  async function toBlobFromCanvas(c: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
    if ("convertToBlob" in (c as OffscreenCanvas)) {
      return await (c as OffscreenCanvas).convertToBlob({ type: "image/png", quality: 0.92 });
    }
    const html = c as HTMLCanvasElement;
    if (typeof html.toBlob === "function") {
      const blob = await new Promise<Blob>((resolve, reject) => {
        try {
          html.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))), "image/png", 0.92);
        } catch (e) {
          reject(e);
        }
      });
      if (!blob) throw new Error("toBlob failed");
      return blob;
    }
    const dataUrl = (c as HTMLCanvasElement).toDataURL("image/png", 0.92);
    const res = await fetch(dataUrl);
    return await res.blob();
  }

  async function createBitmapSafe(c: HTMLCanvasElement | OffscreenCanvas): Promise<ImageBitmap> {
    try {
      return await createImageBitmap(c as HTMLCanvasElement | OffscreenCanvas);
    } catch {}
    try {
      const blob = await toBlobFromCanvas(c);
      return await createImageBitmap(blob);
    } catch {}
    const dataUrl = (c as HTMLCanvasElement).toDataURL("image/png", 0.92);
    await new Promise<void>((resolve, reject) => {
      try {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image load failed"));
        img.src = dataUrl;
      } catch (e) {
        reject(e);
      }
    });
    const temp = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas((canvas as any).width as number, (canvas as any).height as number) : (() => {
      const t = document.createElement("canvas");
      t.width = (canvas as any).width as number;
      t.height = (canvas as any).height as number;
      return t;
    })();
    const tctx = temp.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!tctx) throw new Error("2D context unavailable for temp canvas");
    tctx.drawImage(c as HTMLCanvasElement | OffscreenCanvas, 0, 0);
    return await createImageBitmap(temp as HTMLCanvasElement | OffscreenCanvas);
  }

  const imageBitmap = await createBitmapSafe(canvas as HTMLCanvasElement | OffscreenCanvas);
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();

  const w = getWorker();
  devLog('S3:post_to_worker');
  const p = new Promise<Boxes>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  // Transfer ownership of ImageBitmap to the worker for efficient postMessage
  w.postMessage({ id, imageBitmap, longEdgePx, sensitivity }, [imageBitmap as unknown as Transferable]);

  const boxes = await p;
  const t2 = typeof performance !== "undefined" ? performance.now() : Date.now();

  if (timing) {
    const prepare = (t1 as number) - (t0 as number);
    const infer = (t2 as number) - (t1 as number);
    const total = (t2 as number) - (t0 as number);
    const cw = (canvas as any).width || 0;
    const ch = (canvas as any).height || 0;
    devLog(`[detector] ${cw}x${ch} | prep ${prepare.toFixed(1)}ms, worker ${infer.toFixed(1)}ms, total ${total.toFixed(1)}ms`);
  }
  return boxes;
}

export function disposeDetectorWorker(): void {
  try { worker?.terminate(); } catch {}
  worker = null;
  pending.clear();
}

export {};
