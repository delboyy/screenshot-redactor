import { describe, it, expect } from "vitest";
import { polyToRect, inflateRect, nmsMergeRects, type Rect } from "./geom";

describe("polyToRect", () => {
  it("handles axis-aligned rectangle polygon", () => {
    const poly = [10, 20, 110, 20, 110, 70, 10, 70];
    const r = polyToRect(poly);
    expect(r).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("handles skewed polygon and returns bounding box", () => {
    // diamond-ish shape
    const poly = [50, 10, 90, 50, 50, 90, 10, 50];
    const r = polyToRect(poly);
    expect(r).toEqual({ x: 10, y: 10, width: 80, height: 80 });
  });
});

describe("inflateRect", () => {
  it("inflates by pad on all sides and keeps non-negative dims", () => {
    const r: Rect = { x: 20, y: 30, width: 40, height: 10 };
    const out = inflateRect(r, 5);
    expect(out).toEqual({ x: 15, y: 25, width: 50, height: 20 });
  });

  it("handles zero-size rects", () => {
    const r: Rect = { x: 0, y: 0, width: 0, height: 0 };
    const out = inflateRect(r, 10);
    expect(out).toEqual({ x: -10, y: -10, width: 20, height: 20 });
  });
});

describe("nmsMergeRects", () => {
  it("merges overlapping rectangles using IoU threshold", () => {
    const rects: Rect[] = [
      { x: 10, y: 10, width: 40, height: 20 },
      { x: 30, y: 15, width: 40, height: 20 }, // overlaps with first
      { x: 200, y: 200, width: 20, height: 20 },
    ];
    const merged = nmsMergeRects(rects, { iouThresh: 0.1, distancePx: 0 });
    expect(merged.length).toBe(2);
    // The first two should be merged into a bbox roughly covering from x=10..70, y=10..35
    const a = merged.find((r) => r.x <= 10 && r.y <= 10);
    const b = merged.find((r) => r.x >= 190);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
  });

  it("merges near neighbors within distance threshold even without overlap", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 25, y: 0, width: 20, height: 20 }, // 5px gap
      { x: 200, y: 0, width: 20, height: 20 },
    ];
    const merged = nmsMergeRects(rects, { iouThresh: 0.5, distancePx: 6 });
    // First two merge, third stays alone
    expect(merged.length).toBe(2);
  });

  it("leaves distant rectangles alone", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 100, y: 100, width: 10, height: 10 },
    ];
    const merged = nmsMergeRects(rects, { iouThresh: 0.3, distancePx: 5 });
    expect(merged.length).toBe(2);
  });
});

