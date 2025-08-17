export type BBox = { x0: number; y0: number; x1: number; y1: number };

export type Detection = {
  id: string;
  type: string;
  text: string;
  confidence: number;
  bbox: BBox; // full-resolution pixels
};

export function drawDetectionsOverlay(
  overlayEl: HTMLDivElement,
  canvasEl: HTMLCanvasElement,
  detections: Detection[]
) {
  overlayEl.innerHTML = "";
  const canvasRect = canvasEl.getBoundingClientRect();
  const scaleX = canvasRect.width / canvasEl.width;
  const scaleY = canvasRect.height / canvasEl.height;

  for (const det of detections) {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.left = `${det.bbox.x0 * scaleX}px`;
    el.style.top = `${det.bbox.y0 * scaleY}px`;
    el.style.width = `${(det.bbox.x1 - det.bbox.x0) * scaleX}px`;
    el.style.height = `${(det.bbox.y1 - det.bbox.y0) * scaleY}px`;
    el.style.border = "2px solid #2563EB";
    el.style.background = "rgba(37,99,235,0.12)";
    el.style.borderRadius = "4px";
    el.title = `${det.type}: ${det.text}`;
    overlayEl.appendChild(el);
  }
}


