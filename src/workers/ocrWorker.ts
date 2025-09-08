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
    ocr = await Ocr.create({ backend: "wasm", det: true, rec: false });
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
