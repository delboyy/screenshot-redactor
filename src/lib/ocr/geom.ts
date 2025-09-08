export type Rect = { x: number; y: number; width: number; height: number };

// Convert polygon [x1,y1,x2,y2,...] to its axis-aligned bounding rectangle
export function polyToRect(poly: number[]): Rect {
  if (!Array.isArray(poly) || poly.length < 4 || poly.length % 2 !== 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < poly.length; i += 2) {
    const x = Number(poly[i]);
    const y = Number(poly[i + 1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);
  return { x: minX, y: minY, width, height };
}

// Inflate a rectangle by pad pixels in all directions (non-negative dimensions)
export function inflateRect(r: Rect, pad: number): Rect {
  const p = Number.isFinite(pad) ? pad : 0;
  const x = r.x - p;
  const y = r.y - p;
  const width = Math.max(0, r.width + 2 * p);
  const height = Math.max(0, r.height + 2 * p);
  return { x, y, width, height };
}

// Compute Intersection over Union of two rectangles
function iou(a: Rect, b: Rect): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const denom = areaA + areaB - inter;
  if (denom <= 0) return 0;
  return inter / denom;
}

// Shortest edge-to-edge distance between two AABBs
function edgeDistance(a: Rect, b: Rect): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const dx = Math.max(0, Math.max(b.x - ax2, a.x - bx2));
  const dy = Math.max(0, Math.max(b.y - ay2, a.y - by2));
  if (dx === 0 && dy === 0) return 0; // overlap or touch
  return Math.hypot(dx, dy);
}

function union(a: Rect, b: Rect): Rect {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

export function nmsMergeRects(
  rects: Rect[],
  options: { iouThresh: number; distancePx: number }
): Rect[] {
  const iouThresh = Math.max(0, Math.min(1, options.iouThresh));
  const distThresh = Math.max(0, options.distancePx);
  const input = rects.filter(
    (r) => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height)
  );
  if (input.length <= 1) return input.slice();

  // Build adjacency graph based on merging criteria
  const n = input.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r1 = input[i];
      const r2 = input[j];
      const overlap = iou(r1, r2) >= iouThresh;
      const near = edgeDistance(r1, r2) <= distThresh;
      if (overlap || near) unite(i, j);
    }
  }

  // Merge clusters by taking the union bbox
  const groups = new Map<number, Rect[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const arr = groups.get(root) || [];
    arr.push(input[i]);
    groups.set(root, arr);
  }

  const merged: Rect[] = [];
  groups.forEach((items) => {
    let acc = items[0];
    for (let k = 1; k < items.length; k++) acc = union(acc, items[k]);
    merged.push(acc);
  });

  return merged;
}

