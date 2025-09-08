/// <reference lib="webworker" />

import Ocr, { type OcrCreateOptions } from "@gutenye/ocr-browser";
import * as ort from 'onnxruntime-web';

declare const self: DedicatedWorkerGlobalScope;

type InMsg = {
  id: string;
  imageBitmap: ImageBitmap;
};

type OutOk = {
  id: string;
  ok: true;
  boxes: number[][]; // polygon: [x1,y1,x2,y2,...]
};

type OutErr = {
  id: string;
  ok: false;
  error: string;
};

let ocr: Awaited<ReturnType<typeof Ocr.create>> | null = null; // legacy reference; not used after detector-only switch
let detector: any | null = null;
let initPromise: Promise<void> | null = null;
let isReady = false;

async function preflight(url: string, label: string) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) {
      throw new Error(`${label} not reachable: ${url} (${res.status})`);
    }
  } catch (e) {
    throw new Error(`Model fetch failed for ${label}: ${url} :: ${(e as Error).message}`);
  }
}

async function ensureReady(): Promise<void> {
  if (isReady && ocr) return;
  if (!initPromise) {
    initPromise = (async () => {
      // Log ORT version if available (debug only)
      try { console.debug?.('W0:ort_version', (ort as unknown as { env?: { versions?: { common?: string } } })?.env?.versions?.common || 'unknown'); } catch {}
      try { console.debug?.('W1:create_start'); } catch {}
      // Polyfill minimal Image constructor in worker (some libs presence-check it)
      const g = self as unknown as { Image?: new () => unknown };
      if (typeof g.Image === 'undefined') {
        const NoopImage = class {} as unknown as new () => unknown;
        g.Image = NoopImage;
      }

      // Serve ORT runtime assets from same-origin /ort/ so COEP works later (SAB/SIMD builds)
      try { ort.env.wasm.wasmPaths = '/ort/'; } catch {}

      // Backend stability across environments
      // Preview (no COI): enforce single-threaded WASM to avoid threaded assets
      // Production (COI on): allow small, safe multi-threading for speed
      try {
        const coiEnabled = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_COI === '1';
        if (coiEnabled) {
          const hc = (typeof navigator !== 'undefined' && (navigator as unknown as { hardwareConcurrency?: number }).hardwareConcurrency) || 2;
          ort.env.wasm.numThreads = Math.min(4, hc || 2);
        } else {
          ort.env.wasm.numThreads = 1;
          ort.env.wasm.proxy = false;
        }
      } catch {}

      // WASM default for Safari/WebKit stability. Models hosted same-origin for COEP compatibility.
      // Detector-only; recognition disabled to avoid extra assets. We instantiate Detection directly
      // to avoid Recognition being created implicitly by Ocr.create().
      const detectionPath = "/ocr-assets/ch_PP-OCRv4_det_infer.onnx";

      // Patch ImageRaw.open so Detection.run() can accept ImageBitmap/Canvas without decode()
      try {
        const backend = await import("@gutenye/ocr-common/build/backend/backend.js");
        const BackendImageRaw = (backend as any).ImageRaw;
        const originalOpen = (BackendImageRaw as { open: (input: unknown) => Promise<unknown> }).open;
        (BackendImageRaw as { open: (input: unknown) => Promise<unknown> }).open = async (input: unknown) => {
          // Accept ImageBitmap or Canvas paths directly in the worker
          const looksLikeBitmap = !!input && typeof input === 'object' && 'width' in (input as any) && 'height' in (input as any) && 'close' in (input as any);
          const looksLikeCanvas = !!input && typeof input === 'object' && 'getContext' in (input as any);
          if (looksLikeBitmap || looksLikeCanvas) {
            const w = (input as any).width as number;
            const h = (input as any).height as number;
            const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : (() => { const c = (self as any).document?.createElement?.('canvas'); c.width = w; c.height = h; return c; })();
            const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
            if (!ctx) throw new Error('2D context unavailable in worker');
            ctx.drawImage(input as any, 0, 0);
            const imageData = ctx.getImageData(0, 0, w, h);
            // Construct a new backend ImageRaw instance from pixel data
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return new (BackendImageRaw as any)({ data: imageData.data, width: imageData.width, height: imageData.height });
          }
          // Fallback to original behavior (string URL etc.)
          return await originalOpen.call(BackendImageRaw, input as any);
        };
      } catch {}

      // Minimal document polyfill for canvas creation inside ImageRaw in workers
      const gdoc = (self as unknown as { document?: { createElement?: (tag: string) => any } });
      if (!gdoc.document) {
        gdoc.document = {
          createElement: (tag: string) => {
            if (tag === 'canvas' && typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(1, 1);
            throw new Error('Unsupported element in worker: ' + tag);
          },
        };
      }

      try {
        // Preflight model availability with descriptive errors (detector only)
        await preflight(detectionPath, 'detection model');
        const mod = await import("@gutenye/ocr-common/build/models/Detection.js");
        const DetectionCtor = (mod as any).Detection;
        detector = await DetectionCtor.create({ models: { detectionPath } });
        isReady = true;
        try { console.debug?.('W2:create_ok'); } catch {}
      } catch (e) {
        isReady = false;
        throw new Error(`create_failed@W1: ${(e as Error).message}`);
      }
    })().catch((e) => {
      initPromise = null; // allow retry on next call
      isReady = false;
      throw e;
    });
  }
  await initPromise;
  if (!isReady || !ocr) {
    throw new Error('create_failed@W1: not ready after init');
  }
}

self.onmessage = async (event: MessageEvent<InMsg>) => {
  const { id, imageBitmap } = event.data || ({} as InMsg);
  try {
    if (!id || !imageBitmap) throw new Error("Invalid message payload");

    await ensureReady();
    try { console.debug?.('W3:detect_start'); } catch {}
    let boxes: number[][];
    try {
      if (!detector) throw new Error('detector not initialized');
      const lineImages = await detector.run(imageBitmap as unknown as ImageBitmap);
      boxes = (lineImages as any[]).map((li) => {
        const b = li?.box as number[][];
        if (!Array.isArray(b)) return [];
        // flatten [[x,y],...] -> [x,y,...]
        const out: number[] = [];
        for (const p of b) { out.push(Number(p[0]) || 0, Number(p[1]) || 0); }
        return out;
      }).filter((p: number[]) => p.length >= 8);
    } catch (e) {
      throw new Error(`detect_failed@W3: ${(e as Error).message}`);
    }
    try { console.debug?.('W4:detect_ok'); } catch {}

    try {
      imageBitmap.close();
    } catch {}

    const msg: OutOk = { id, ok: true, boxes };
    self.postMessage(msg);
  } catch (e) {
    try {
      imageBitmap.close();
    } catch {}
    const fallbackId = (event?.data as InMsg | undefined)?.id ?? "";
    const err = e as Error;
    const stack = err?.stack ? ` | ${err.stack}` : '';
    const msg: OutErr = { id: fallbackId, ok: false, error: `${err.message}${stack}` };
    self.postMessage(msg);
  }
};

export {}; // ensure this is treated as a module
