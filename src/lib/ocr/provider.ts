export interface TextDetectorProvider {
  init(): Promise<void>;
  // Returns polygons (or 4-pt rects) in ORIGINAL image coordinates
  detect(
    imageBitmap: ImageBitmap,
    opts?: { longEdgePx?: number; sensitivity?: 'low' | 'med' | 'high' }
  ): Promise<number[][]>;
}

// A simple heuristic detector: downscale, threshold edges, cluster boxes.
export class HeuristicTextDetector implements TextDetectorProvider {
  private ready = false;
  async init(): Promise<void> {
    this.ready = true;
  }

  async detect(imageBitmap: ImageBitmap, opts?: { longEdgePx?: number; sensitivity?: 'low' | 'med' | 'high' }): Promise<number[][]> {
    if (!this.ready) await this.init();
    const longEdgePx = opts?.longEdgePx ?? 1280;
    const sensitivity = opts?.sensitivity ?? 'med';

    // Compute scale
    const w0 = imageBitmap.width;
    const h0 = imageBitmap.height;
    const long0 = Math.max(w0, h0) || 1;
    const scale = long0 > longEdgePx ? longEdgePx / long0 : 1;
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));

    // Draw to canvas
    const off = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : (() => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
    })();
    const ctx = off.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) return [];
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) {
      (ctx as OffscreenCanvasRenderingContext2D & { imageSmoothingQuality?: 'low' | 'medium' | 'high' }).imageSmoothingQuality = 'high';
    }
    ctx.drawImage(imageBitmap, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;

    // Simple gradient magnitude (Sobel-lite) + threshold
    const thr = sensitivity === 'low' ? 28 : sensitivity === 'high' ? 12 : 20;
    const map = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        const luma = (i: number) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        const iL = idx - 4, iR = idx + 4, iU = idx - w * 4, iD = idx + w * 4;
        const gx = luma(iR) - luma(iL);
        const gy = luma(iD) - luma(iU);
        const g = Math.abs(gx) + Math.abs(gy);
        map[y * w + x] = g > thr ? 1 : 0;
      }
    }

    // Dilate-like pass to connect characters within words
    const radius = 1;
    const tmp = new Uint8Array(map);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let m = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            m = Math.max(m, map[(y + dy) * w + (x + dx)]);
          }
        }
        tmp[y * w + x] = m;
      }
    }

    // Connected components to rectangles
    const visited = new Uint8Array(w * h);
    const rects: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const stack: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (tmp[p] === 0 || visited[p]) continue;
        let x1 = x, y1 = y, x2 = x, y2 = y;
        stack.length = 0; stack.push(p); visited[p] = 1;
        while (stack.length) {
          const q = stack.pop()!;
          const qx = q % w, qy = (q / w) | 0;
          if (qx < x1) x1 = qx; if (qy < y1) y1 = qy; if (qx > x2) x2 = qx; if (qy > y2) y2 = qy;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = qx + dx, ny = qy + dy;
              if (nx <= 0 || ny <= 0 || nx >= w - 1 || ny >= h - 1) continue;
              const np = ny * w + nx;
              if (tmp[np] && !visited[np]) { visited[np] = 1; stack.push(np); }
            }
          }
        }
        // Filter very small blobs
        const bw = x2 - x1 + 1; const bh = y2 - y1 + 1;
        if (bw >= 8 && bh >= 8) rects.push({ x1, y1, x2, y2 });
      }
    }

    // Map to 4-pt rects and scale back to original
    const inv = 1 / (scale || 1);
    const polys: number[][] = rects.map(r => {
      const x1 = Math.round(r.x1 * inv), y1 = Math.round(r.y1 * inv);
      const x2 = Math.round((r.x2 + 1) * inv), y2 = Math.round((r.y2 + 1) * inv);
      return [x1, y1, x2, y1, x2, y2, x1, y2];
    });
    return polys;
  }
}

