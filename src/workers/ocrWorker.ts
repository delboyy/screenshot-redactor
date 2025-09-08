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

let ocr: Awaited<ReturnType<typeof Ocr.create>> | null = null;
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
      // Detector-only; recognition disabled to avoid extra assets.
      const baseOptions = {
        det: true,
        rec: false,
        models: {
          detectionPath: "/ocr-assets/ch_PP-OCRv4_det_infer.onnx",
        },
      } as const;
      const preferredBackend: string | undefined = "wasm"; // Always prefer WASM backend

      try {
        // Preflight model availability with descriptive errors (detector only)
        await preflight(baseOptions.models.detectionPath, 'detection model');
        const opts = ({ backend: preferredBackend || "wasm", ...baseOptions } as unknown as OcrCreateOptions);
        ocr = await Ocr.create(opts);
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
    const inst = ocr!;
    try { console.debug?.('W3:detect_start'); } catch {}
    let boxes: number[][];
    try {
      ({ boxes } = await inst.detect(imageBitmap as unknown as ImageBitmap));
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
