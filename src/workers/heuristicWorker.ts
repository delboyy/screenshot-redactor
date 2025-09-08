// Heuristic text detector worker
// Pipeline:
// 1) Downscale to longEdgePx, remember scale factors
// 2) Grayscale -> Sobel magnitude -> normalize
// 3) Threshold (Otsu; fallback to fixed) to binary mask
// 4) Morphological close (dilate then erode)
// 5) Connected components to rects
// 6) Filter by area/aspect/fill with sensitivity tuning
// 7) Merge overlaps/nearby (IoU or small distance)
// 8) Scale rects back to original and emit 4-pt polygons

export type HeuristicReq = {
  id: string;
  imageBitmap: ImageBitmap;
  longEdgePx?: number;
  sensitivity?: 'low' | 'med' | 'high';
};

type Boxes = number[][]; // polygon as [x1,y1,x2,y2,...]
type WorkerOk = { id: string; ok: true; boxes: Boxes };
type WorkerErr = { id: string; ok: false; error: string };

// Utility: create an OffscreenCanvas
function makeCanvas(w: number, h: number): OffscreenCanvas {
  const c = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  return c;
}

function toGrayscale(img: ImageData): Uint8Array {
  const { data, width, height } = img;
  const out = new Uint8Array(width * height);
  let j = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Rec. 709 luma
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    out[j++] = y & 0xff;
  }
  return out;
}

function sobelMag(gray: Uint8Array, w: number, h: number): Float32Array {
  // 3x3 Sobel operator, return magnitude per pixel
  const mag = new Float32Array(w * h);
  // Skip 1px border to avoid bounds checks
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const tl = gray[p - w - 1], tc = gray[p - w], tr = gray[p - w + 1];
      const ml = gray[p - 1], /*mc*/ mr = gray[p + 1];
      const bl = gray[p + w - 1], bc = gray[p + w], br = gray[p + w + 1];
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      mag[p] = Math.hypot(gx, gy);
    }
  }
  return mag;
}

function normalizeToUint8(f: Float32Array, w: number, h: number): Uint8Array {
  let min = Infinity, max = -Infinity;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const v = f[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const out = new Uint8Array(n);
  const denom = max > min ? (max - min) : 1;
  for (let i = 0; i < n; i++) {
    const v = f[i];
    const nv = (255 * (v - min)) / denom;
    out[i] = nv < 0 ? 0 : nv > 255 ? 255 : nv | 0;
  }
  return out;
}

function otsuThreshold(hist: Uint32Array, total: number): number {
  // Returns threshold in [0,255]
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let varMax = 0;
  let threshold = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > varMax) {
      varMax = between;
      threshold = t;
    }
  }
  return threshold;
}

function thresholdBinary(img: Uint8Array, w: number, h: number, sens: 'low' | 'med' | 'high'): Uint8Array {
  // Use Otsu to find threshold; then adjust by sensitivity bias
  const hist = new Uint32Array(256);
  const n = w * h;
  for (let i = 0; i < n; i++) hist[img[i]]++;
  let thr = otsuThreshold(hist, n);
  // Bias: low sensitivity => higher threshold; high => lower threshold
  const bias = sens === 'low' ? +12 : sens === 'high' ? -12 : 0;
  thr = Math.max(0, Math.min(255, thr + bias));
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = img[i] > thr ? 1 : 0;
  return out;
}

function dilate(src: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const dst = new Uint8Array(w * h);
  const r = Math.max(1, radius | 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      outer: for (let yy = y0; yy <= y1; yy++) {
        const row = yy * w;
        for (let xx = x0; xx <= x1; xx++) {
          if (src[row + xx]) { on = 1; break outer; }
        }
      }
      dst[y * w + x] = on;
    }
  }
  return dst;
}

function erode(src: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const dst = new Uint8Array(w * h);
  const r = Math.max(1, radius | 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 1;
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      outer: for (let yy = y0; yy <= y1; yy++) {
        const row = yy * w;
        for (let xx = x0; xx <= x1; xx++) {
          if (!src[row + xx]) { on = 0; break outer; }
        }
      }
      dst[y * w + x] = on;
    }
  }
  return dst;
}

type Rect = { x: number; y: number; w: number; h: number; area: number; fill: number };

function ccBoundingRects(mask: Uint8Array, w: number, h: number): Rect[] {
  const visited = new Uint8Array(w * h);
  const rects: Rect[] = [];
  const stack: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (mask[p] === 0 || visited[p]) continue;
      let minx = x, miny = y, maxx = x, maxy = y;
      let count = 0;
      stack.length = 0;
      stack.push(p);
      visited[p] = 1;
      while (stack.length) {
        const q = stack.pop()!;
        const qx = q % w, qy = (q / w) | 0;
        count++;
        if (qx < minx) minx = qx; if (qy < miny) miny = qy; if (qx > maxx) maxx = qx; if (qy > maxy) maxy = qy;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = qx + dx, ny = qy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const np = ny * w + nx;
            if (mask[np] && !visited[np]) { visited[np] = 1; stack.push(np); }
          }
        }
      }
      const bw = maxx - minx + 1;
      const bh = maxy - miny + 1;
      rects.push({ x: minx, y: miny, w: bw, h: bh, area: bw * bh, fill: count });
    }
  }
  return rects;
}

function iou(a: Rect, b: Rect): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const denom = a.area + b.area - inter;
  if (denom <= 0) return 0;
  return inter / denom;
}

function edgeDistance(a: Rect, b: Rect): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const dx = Math.max(0, Math.max(b.x - ax2, a.x - bx2));
  const dy = Math.max(0, Math.max(b.y - ay2, a.y - by2));
  if (dx === 0 && dy === 0) return 0;
  return Math.hypot(dx, dy);
}

function mergeRects(rects: Rect[], iouThresh: number, distPx: number): Rect[] {
  if (rects.length <= 1) return rects.slice();
  const n = rects.length;
  const parent = new Array<number>(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const unite = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r1 = rects[i], r2 = rects[j];
      if (iou(r1, r2) >= iouThresh || edgeDistance(r1, r2) <= distPx) unite(i, j);
    }
  }
  const groups = new Map<number, Rect[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const g = groups.get(root) || [];
    g.push(rects[i]);
    groups.set(root, g);
  }
  const merged: Rect[] = [];
  for (const arr of groups.values()) {
    let x1 = arr[0].x, y1 = arr[0].y, x2 = arr[0].x + arr[0].w, y2 = arr[0].y + arr[0].h, fill = 0;
    for (let k = 0; k < arr.length; k++) {
      const r = arr[k];
      if (r.x < x1) x1 = r.x; if (r.y < y1) y1 = r.y;
      if (r.x + r.w > x2) x2 = r.x + r.w; if (r.y + r.h > y2) y2 = r.y + r.h;
      fill += r.fill;
    }
    const w = Math.max(1, x2 - x1), h = Math.max(1, y2 - y1);
    merged.push({ x: x1, y: y1, w, h, area: w * h, fill });
  }
  return merged;
}

function detectHeuristic(imageBitmap: ImageBitmap, opts?: { longEdgePx?: number; sensitivity?: 'low' | 'med' | 'high' }): Boxes {
  const longEdgePx = opts?.longEdgePx ?? 1280;
  const sensitivity = opts?.sensitivity ?? 'med';

  // Compute downscale
  const w0 = imageBitmap.width;
  const h0 = imageBitmap.height;
  const long0 = Math.max(w0, h0) || 1;
  const scale = long0 > longEdgePx ? longEdgePx / long0 : 1;
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const sx = w0 / w;
  const sy = h0 / h;

  // Draw to canvas
  const can = makeCanvas(w, h);
  const ctx = can.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return [];
  ctx.imageSmoothingEnabled = true;
  (ctx as any).imageSmoothingQuality = 'high';
  ctx.drawImage(imageBitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);

  // Grayscale -> Sobel -> normalize
  const gray = toGrayscale(img);
  const mag = sobelMag(gray, w, h);
  const norm = normalizeToUint8(mag, w, h);

  // Threshold to binary mask with sensitivity bias
  const mask0 = thresholdBinary(norm, w, h, sensitivity);

  // Morph close to connect characters
  const r = sensitivity === 'low' ? 3 : sensitivity === 'high' ? 2 : 2;
  const dil = dilate(mask0, w, h, r);
  const mask = erode(dil, w, h, r);

  // Connected components
  let rects = ccBoundingRects(mask, w, h);

  // Filter by heuristics
  const minArea = sensitivity === 'low' ? 80 : sensitivity === 'high' ? 24 : 40; // in downscaled pixels
  const maxAspect = 40; // allow long lines
  const minAspect = 0.15; // avoid ultra-tall single columns
  const minDim = 6;
  const minFillFrac = sensitivity === 'low' ? 0.05 : sensitivity === 'high' ? 0.015 : 0.03;
  rects = rects.filter((r) => {
    if (r.w < minDim || r.h < minDim) return false;
    if (r.area < minArea) return false;
    const ar = r.w / (r.h || 1);
    if (ar < minAspect || ar > maxAspect) {
      if (1 / ar < minAspect || 1 / ar > maxAspect) return false;
    }
    const fillFrac = r.fill / (r.area || 1);
    if (fillFrac < minFillFrac) return false;
    return true;
  });

  // Merge overlaps / nearby
  const iouThresh = 0.15;
  const distPx = sensitivity === 'low' ? 2 : sensitivity === 'high' ? 5 : 3;
  rects = mergeRects(rects, iouThresh, distPx);

  // Scale to original and convert to 4-pt polygons
  const polys: Boxes = rects.map((r) => {
    const x1 = Math.round(r.x * sx);
    const y1 = Math.round(r.y * sy);
    const x2 = Math.round((r.x + r.w) * sx);
    const y2 = Math.round((r.y + r.h) * sy);
    return [x1, y1, x2, y1, x2, y2, x1, y2];
  });
  return polys;
}

self.onmessage = (ev: MessageEvent<HeuristicReq>) => {
  const { id, imageBitmap, longEdgePx = 1280, sensitivity = 'med' } = ev.data || ({} as HeuristicReq);
  try {
    const boxes = detectHeuristic(imageBitmap, { longEdgePx, sensitivity });
    const msg: WorkerOk = { id, ok: true, boxes };
    (self as unknown as Worker).postMessage(msg);
  } catch (e: any) {
    const msg: WorkerErr = { id: id || 'unknown', ok: false, error: String(e?.message || e) };
    (self as unknown as Worker).postMessage(msg);
  } finally {
    try { imageBitmap.close(); } catch {}
  }
};

export {};

