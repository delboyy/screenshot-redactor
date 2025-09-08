/// <reference lib="webworker" />

import Ocr from "@gutenye/ocr-browser";

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

async function ensureOcr() {
  if (!ocr) {
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

    const preferredBackend = (undefined as unknown) as string | undefined; // placeholder for future overrides

    try {
      ocr = await Ocr.create({ backend: preferredBackend || "wasm", ...baseOptions } as any);
    } catch (e) {
      if (preferredBackend && preferredBackend !== "wasm") {
        // Retry with WASM for cross-browser stability
        ocr = await Ocr.create({ backend: "wasm", ...baseOptions } as any);
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
