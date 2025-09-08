/// <reference lib="webworker" />

import Ocr, { type OcrCreateOptions } from "@gutenye/ocr-browser";
import * as ort from 'onnxruntime-web';
import { devLog } from "@/lib/dev";

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

type DetectionLike = {
  run(input: ImageBitmap | OffscreenCanvas | HTMLCanvasElement): Promise<Array<{ box: number[][] }>>;
};

let detector: DetectionLike | null = null;
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
      devLog('W0:ort_version', (ort as unknown as { env?: { versions?: { common?: string } } })?.env?.versions?.common || 'unknown');
      devLog('W1:create_start');
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
        type BackendModule = { ImageRaw: new (args: { data: Uint8ClampedArray; width: number; height: number }) => unknown };
        const BackendImageRaw = (backend as BackendModule).ImageRaw;
        const originalOpen = (BackendImageRaw as unknown as { open: (input: unknown) => Promise<unknown> }).open;

        function isImageBitmapLike(x: unknown): x is ImageBitmap {
          return !!x && typeof x === 'object' && 'width' in (x as Record<string, unknown>) && 'height' in (x as Record<string, unknown>) && 'close' in (x as Record<string, unknown>);
        }
        function isCanvasLike(x: unknown): x is HTMLCanvasElement | OffscreenCanvas {
          return !!x && typeof x === 'object' && 'getContext' in (x as Record<string, unknown>);
        }

        (BackendImageRaw as unknown as { open: (input: unknown) => Promise<unknown> }).open = async (input: unknown) => {
          // Accept ImageBitmap or Canvas paths directly in the worker
          if (isImageBitmapLike(input) || isCanvasLike(input)) {
            const w = (input as ImageBitmap | HTMLCanvasElement | OffscreenCanvas).width as number;
            const h = (input as ImageBitmap | HTMLCanvasElement | OffscreenCanvas).height as number;
            const canvas = typeof OffscreenCanvas !== 'undefined'
              ? new OffscreenCanvas(w, h)
              : (() => {
                  const doc = (self as unknown as { document?: { createElement?: (tag: string) => HTMLCanvasElement } }).document;
                  const c = doc?.createElement?.('canvas');
                  if (!c) throw new Error('document not available to create canvas');
                  c.width = w; c.height = h; return c;
                })();
            const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
            if (!ctx) throw new Error('2D context unavailable in worker');
            ctx.drawImage(input as unknown as CanvasImageSource, 0, 0);
            const imageData = ctx.getImageData(0, 0, w, h);
            // Construct a new backend ImageRaw instance from pixel data
            return new BackendImageRaw({ data: imageData.data, width: imageData.width, height: imageData.height });
          }
          // Fallback to original behavior (string URL etc.)
          return await originalOpen.call(BackendImageRaw, input as unknown as Parameters<typeof originalOpen>[0]);
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
        type DetectionModule = { Detection: { create: (opts: { models: { detectionPath: string } }) => Promise<DetectionLike> } };
        const mod = (await import("@gutenye/ocr-common/build/models/Detection.js")) as unknown as DetectionModule;
        detector = await mod.Detection.create({ models: { detectionPath } });
        isReady = true;
        devLog('W2:create_ok');
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
    devLog('W3:detect_start');
    let boxes: number[][];
    try {
      if (!detector) throw new Error('detector not initialized');
      const lineImages = await detector.run(imageBitmap as unknown as ImageBitmap);
      boxes = (lineImages as Array<{ box: number[][] }>).map((li) => {
        const b = li?.box;
        if (!Array.isArray(b)) return [];
        // flatten [[x,y],...] -> [x,y,...]
        const out: number[] = [];
        for (const p of b) { out.push(Number(p[0]) || 0, Number(p[1]) || 0); }
        return out;
      }).filter((p) => p.length >= 8);
    } catch (e) {
      throw new Error(`detect_failed@W3: ${(e as Error).message}`);
    }
    devLog('W4:detect_ok');

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
