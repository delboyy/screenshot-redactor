export type SimpleImageData = { data: Uint8ClampedArray; width: number; height: number };

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

// Compute grayscale luma for a pixel
function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function regionStats(img: SimpleImageData, x: number, y: number, w: number, h: number) {
  const { data, width, height } = img;
  // Clamp to integer, in-bounds coordinates
  const x1 = Math.max(0, Math.min(width, Math.floor(x)));
  const y1 = Math.max(0, Math.min(height, Math.floor(y)));
  const x2 = Math.max(x1, Math.min(width, Math.floor(x + w)));
  const y2 = Math.max(y1, Math.min(height, Math.floor(y + h)));
  if (x1 >= x2 || y1 >= y2) {
    // Empty or inverted region → zeroed stats
    return { min: 0, max: 0, mean: 0, variance: 0, count: 0 };
  }

  let min = 255, max = 0, sum = 0, sum2 = 0, count = 0;
  for (let yy = y1; yy < y2; yy++) {
    const base = yy * width * 4;
    for (let xx = x1; xx < x2; xx++) {
      const idx = base + xx * 4;
      const Y = luma(data[idx], data[idx + 1], data[idx + 2]);
      if (Y < min) min = Y;
      if (Y > max) max = Y;
      sum += Y;
      sum2 += Y * Y;
      count++;
    }
  }

  const mean = sum / count;
  const variance = (sum2 / count) - (mean * mean);
  return { min, max, mean, variance, count };
}

export function isUniformRegion(img: SimpleImageData, x: number, y: number, w: number, h: number, tolerance = 1): boolean {
  const { min, max } = regionStats(img, x, y, w, h);
  return max - min <= tolerance;
}

// Assert that the redaction is irreversible, based on tool type
export function assertIrreversible(before: SimpleImageData, after: SimpleImageData, tool: "blackout" | "blur" | "pixelate"): boolean {
  const w = Math.min(before.width, after.width);
  const h = Math.min(before.height, after.height);
  if (w === 0 || h === 0) return true;
  switch (tool) {
    case "blackout": {
      // region should be near-uniform and very dark
      const uni = isUniformRegion(after, 0, 0, w, h, 2);
      const stats = regionStats(after, 0, 0, w, h);
      return uni && stats.mean < 5; // near black
    }
    case "blur": {
      // blur should significantly reduce variance vs before
      const vb = regionStats(before, 0, 0, w, h).variance;
      const va = regionStats(after, 0, 0, w, h).variance;
      return va < vb * 0.6; // 40% variance drop
    }
    case "pixelate": {
      // pixelate should alter many pixels; check mean absolute difference on luma
      const { data: db, width: wb } = before;
      const { data: da, width: wa } = after;
      let diff = 0, cnt = 0;
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          const ib = (yy * wb + xx) * 4;
          const ia = (yy * wa + xx) * 4;
          const lb = luma(db[ib], db[ib + 1], db[ib + 2]);
          const la = luma(da[ia], da[ia + 1], da[ia + 2]);
          diff += Math.abs(lb - la);
          cnt++;
        }
      }
      const mad = cnt ? diff / cnt : 0;
      return mad > 5; // significant change
    }
  }
}

