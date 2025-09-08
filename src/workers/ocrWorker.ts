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

async function ensureOcr() {
  if (!ocr) {
    // Polyfill minimal Image constructor in worker (some libs presence-check it)
    const g = self as unknown as { Image?: new () => unknown };
    if (typeof g.Image === 'undefined') {
      const NoopImage = class {} as unknown as new () => unknown;
      g.Image = NoopImage;
    }

    // Point ORT to same-origin wasm binaries to ensure they load under COEP
    try {
      ort.env.wasm.wasmPaths = '/onnx/';
    } catch {}
    // WASM default for Safari/WebKit stability. If a different backend is
    // ever passed in (e.g., via debug overrides), catch and retry with WASM.
    // Models hosted same-origin for COEP compatibility.
    const baseOptions = {
      det: true,
      rec: false,
      models: {
        detectionPath: "/ocr-assets/ch_PP-OCRv4_det_infer.onnx",
        recognitionPath: "/ocr-assets/ch_PP-OCRv4_rec_infer.onnx",
        dictionaryPath: "/ocr-assets/ppocr_keys_v1.txt",
      },
    } as const;

    const preferredBackend: string | undefined = undefined; // placeholder for future overrides

    try {
      // Preflight model availability with descriptive errors
      await preflight(baseOptions.models.detectionPath, 'detection model');
      // recognition not used, but preflight helps surface path issues early
      await preflight(baseOptions.models.recognitionPath, 'recognition model');
      await preflight(baseOptions.models.dictionaryPath, 'dictionary');
      const opts: OcrCreateOptions = { backend: preferredBackend || "wasm", ...baseOptions };
      ocr = await Ocr.create(opts);
    } catch (e) {
      if (preferredBackend && preferredBackend !== "wasm") {
        // Retry with WASM for cross-browser stability
        const fallbackOpts: OcrCreateOptions = { backend: "wasm", ...baseOptions };
        ocr = await Ocr.create(fallbackOpts);
      } else {
        throw e;
      }
    }
  }
  return ocr;
}

self.onmessage = async (event: MessageEvent<InMsg>) => {
  const { id, imageBitmap } = event.data || ({} as InMsg);
  try {
    if (!id || !imageBitmap) throw new Error("Invalid message payload");

    const inst = await ensureOcr();
    const { boxes } = await inst.detect(imageBitmap as unknown as ImageBitmap);

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
    const msg: OutErr = { id: fallbackId, ok: false, error: (e as Error).message };
    self.postMessage(msg);
  }
};

export {}; // ensure this is treated as a module
