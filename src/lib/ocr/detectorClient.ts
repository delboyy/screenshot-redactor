// Client-side OCR detector bridge to the module worker.
// Creates a singleton Worker and manages request/response correlation.

type Boxes = number[][]; // polygon as [x1,y1,x2,y2,...]

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
  };

  workerInstance.onmessageerror = (ev) => {
    const err = new Error("Worker message deserialization error");
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  };

  return workerInstance;
}

export async function detectBoxesFromCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas
): Promise<Boxes> {
  const worker = getWorker();
  const id = genId();
  const imageBitmap = await createImageBitmap(canvas as any);

  return new Promise<Boxes>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Transfer the ImageBitmap to the worker to avoid cloning cost and free main-thread memory.
    worker.postMessage({ id, imageBitmap }, [imageBitmap as unknown as Transferable]);
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

