/**
 * Canvas-based image preprocessing helpers for OCR
 * All functions mutate and/or return new ImageData/Canvas elements.
 */

export function createProcessingCanvas(
  source: HTMLCanvasElement,
  targetWidth: number
): HTMLCanvasElement {
  const scale = targetWidth / source.width;
  const targetHeight = Math.round(source.height * scale);
  const out = document.createElement("canvas");
  out.width = targetWidth;
  out.height = targetHeight;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, out.width, out.height);
  return out;
}

export function getImageData(c: HTMLCanvasElement): ImageData {
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context not available");
  return ctx.getImageData(0, 0, c.width, c.height);
}

export function putImageData(c: HTMLCanvasElement, data: ImageData) {
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context not available");
  ctx.putImageData(data, 0, 0);
}

export function toGrayscale(data: ImageData): ImageData {
  const arr = data.data;
  for (let i = 0; i < arr.length; i += 4) {
    const r = arr[i], g = arr[i + 1], b = arr[i + 2];
    const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    arr[i] = arr[i + 1] = arr[i + 2] = y;
  }
  return data;
}

export function adjustContrastBrightness(data: ImageData, contrast = 1.2, brightness = 0): ImageData {
  // contrast: 1.0 = no change; brightness: -255..255
  const arr = data.data;
  const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
  for (let i = 0; i < arr.length; i += 4) {
    arr[i] = clamp8(factor * (arr[i] - 128) + 128 + brightness);
    arr[i + 1] = clamp8(factor * (arr[i + 1] - 128) + 128 + brightness);
    arr[i + 2] = clamp8(factor * (arr[i + 2] - 128) + 128 + brightness);
  }
  return data;
}

export function unsharpMask(data: ImageData, radius = 2, amount = 1.0): ImageData {
  // Simple unsharp mask: data = data + amount*(data - blurred)
  const blurred = gaussianBlur(cloneImageData(data), radius);
  const a = data.data;
  const b = blurred.data;
  for (let i = 0; i < a.length; i += 4) {
    a[i] = clamp8(a[i] + amount * (a[i] - b[i]));
    a[i + 1] = clamp8(a[i + 1] + amount * (a[i + 1] - b[i + 1]));
    a[i + 2] = clamp8(a[i + 2] + amount * (a[i + 2] - b[i + 2]));
  }
  return data;
}

export function gaussianBlur(data: ImageData, radius = 2): ImageData {
  if (radius <= 0) return data;
  const { width, height } = data;
  const src = new Uint8ClampedArray(data.data);
  const dst = new Uint8ClampedArray(src.length);
  const kernel = makeGaussianKernel(radius);
  const tmp = new Uint8ClampedArray(src.length);

  // Horizontal
  convolve1D(src, tmp, width, height, kernel, true);
  // Vertical
  convolve1D(tmp, dst, width, height, kernel, false);

  data.data.set(dst);
  return data;
}

export function medianFilter(data: ImageData, radius = 1): ImageData {
  if (radius <= 0) return data;
  const { width, height } = data;
  const src = new Uint8ClampedArray(data.data);
  const dst = new Uint8ClampedArray(src.length);
  const windowSize = (2 * radius + 1) ** 2;
  const rwin = new Array<number>(windowSize);
  const bwin = new Array<number>(windowSize);
  const gwin = new Array<number>(windowSize);
  const awin = new Array<number>(windowSize);
  // Removed unused variable: idx
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let k = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = clamp(x + dx, 0, width - 1);
          const ny = clamp(y + dy, 0, height - 1);
          const i = (ny * width + nx) * 4;
          rwin[k] = src[i];
          gwin[k] = src[i + 1];
          bwin[k] = src[i + 2];
          awin[k] = src[i + 3];
          k++;
        }
      }
      rwin.sort(ncmp);
      gwin.sort(ncmp);
      bwin.sort(ncmp);
      awin.sort(ncmp);
      const mid = Math.floor(windowSize / 2);
      const o = (y * width + x) * 4;
      dst[o] = rwin[mid];
      dst[o + 1] = gwin[mid];
      dst[o + 2] = bwin[mid];
      dst[o + 3] = awin[mid];
      // idx += 4; // Removed unused increment
    }
  }
  data.data.set(dst);
  return data;
}

export function threshold(data: ImageData, t = 128): ImageData {
  const arr = data.data;
  for (let i = 0; i < arr.length; i += 4) {
    const v = arr[i] >= t ? 255 : 0;
    arr[i] = arr[i + 1] = arr[i + 2] = v;
  }
  return data;
}

export function pipelineBasic(c: HTMLCanvasElement): { canvas: HTMLCanvasElement; scale: number } {
  // Ensure processing width between 1200 and 1600
  const targetWidth = clamp(Math.round(c.width), 1200, 1600);
  const proc = createProcessingCanvas(c, targetWidth);
  const scale = proc.width / c.width; // proc to full-res scale factor numerator
  let data = getImageData(proc);
  data = toGrayscale(data);
  data = medianFilter(data, 1);
  data = adjustContrastBrightness(data, 1.4, 10);
  data = unsharpMask(data, 2, 0.8);
  putImageData(proc, data);
  return { canvas: proc, scale };
}

export function pipelineHighContrast(c: HTMLCanvasElement): { canvas: HTMLCanvasElement; scale: number } {
  const targetWidth = clamp(Math.round(c.width), 1200, 1600);
  const proc = createProcessingCanvas(c, targetWidth);
  const scale = proc.width / c.width;
  let data = getImageData(proc);
  data = toGrayscale(data);
  data = adjustContrastBrightness(data, 1.8, 15);
  data = gaussianBlur(data, 1);
  data = threshold(data, 140);
  putImageData(proc, data);
  return { canvas: proc, scale };
}

function makeGaussianKernel(radius: number): number[] {
  const sigma = radius / 2;
  const len = radius * 2 + 1;
  const kernel = new Array(len);
  const twoSigmaSq = 2 * sigma * sigma || 1;
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const x = i - radius;
    const v = Math.exp(-(x * x) / twoSigmaSq);
    kernel[i] = v;
    sum += v;
  }
  // normalize
  for (let i = 0; i < len; i++) kernel[i] /= sum;
  return kernel;
}

function convolve1D(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  kernel: number[],
  horizontal: boolean
) {
  const radius = (kernel.length - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const nx = horizontal ? clamp(x + k, 0, width - 1) : x;
        const ny = horizontal ? y : clamp(y + k, 0, height - 1);
        const i = (ny * width + nx) * 4;
        const w = kernel[k + radius];
        r += src[i] * w;
        g += src[i + 1] * w;
        b += src[i + 2] * w;
        a += src[i + 3] * w;
      }
      const o = (y * width + x) * 4;
      dst[o] = clamp8(r);
      dst[o + 1] = clamp8(g);
      dst[o + 2] = clamp8(b);
      dst[o + 3] = clamp8(a);
    }
  }
}

function cloneImageData(data: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
}

export function pipelineForPii(c: HTMLCanvasElement): { canvas: HTMLCanvasElement; scale: number } {
  // Optimized preprocessing specifically for PII text detection
  const targetWidth = clamp(Math.round(c.width), 1600, 2000); // Higher resolution for better text clarity
  const proc = createProcessingCanvas(c, targetWidth);
  const scale = proc.width / c.width;
  let data = getImageData(proc);
  
  // Step 1: Convert to grayscale
  data = toGrayscale(data);
  
  // Step 2: Apply median filter to reduce noise
  data = medianFilter(data, 1);
  
  // Step 3: Enhance contrast for better text separation
  data = adjustContrastBrightness(data, 1.6, 15);
  
  // Step 4: Apply unsharp mask for edge enhancement
  data = unsharpMask(data, 1.5, 1.2);
  
  // Step 5: Apply bilateral filter-like effect to preserve edges while smoothing
  data = bilateralFilterLike(data, 2);
  
  putImageData(proc, data);
  return { canvas: proc, scale };
}

// Bilateral filter-like effect to preserve edges while reducing noise
function bilateralFilterLike(data: ImageData, radius: number): ImageData {
  if (radius <= 0) return data;
  const { width, height } = data;
  const src = new Uint8ClampedArray(data.data);
  const dst = new Uint8ClampedArray(src.length);
  
  // Simple bilateral-like filtering
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0, weightSum = 0;
      
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = clamp(x + dx, 0, width - 1);
          const ny = clamp(y + dy, 0, height - 1);
          const i = (ny * width + nx) * 4;
          
          // Get current pixel values
          const centerIdx = (y * width + x) * 4;
          const centerR = src[centerIdx];
          const centerG = src[centerIdx + 1];
          const centerB = src[centerIdx + 2];
          
          const neighborR = src[i];
          const neighborG = src[i + 1];
          const neighborB = src[i + 2];
          
          // Calculate intensity difference for weight
          const intensityDiff = Math.abs(centerR - neighborR) + 
                               Math.abs(centerG - neighborG) + 
                               Math.abs(centerB - neighborB);
          
          // Calculate spatial distance
          const spatialDist = Math.sqrt(dx * dx + dy * dy);
          
          // Calculate weight (combination of intensity and spatial)
          const intensityWeight = Math.exp(-intensityDiff / (2 * 30 * 30)); // sigma intensity = 30
          const spatialWeight = Math.exp(-spatialDist / (2 * radius * radius));
          const weight = intensityWeight * spatialWeight;
          
          r += neighborR * weight;
          g += neighborG * weight;
          b += neighborB * weight;
          a += src[i + 3] * weight;
          weightSum += weight;
        }
      }
      
      if (weightSum > 0) {
        const idx = (y * width + x) * 4;
        dst[idx] = clamp8(r / weightSum);
        dst[idx + 1] = clamp8(g / weightSum);
        dst[idx + 2] = clamp8(b / weightSum);
        dst[idx + 3] = clamp8(a / weightSum);
      } else {
        // Fallback to original pixel
        const idx = (y * width + x) * 4;
        dst[idx] = src[idx];
        dst[idx + 1] = src[idx + 1];
        dst[idx + 2] = src[idx + 2];
        dst[idx + 3] = src[idx + 3];
      }
    }
  }
  
  data.data.set(dst);
  return data;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function clamp8(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function ncmp(a: number, b: number) {
  return a - b;
}


