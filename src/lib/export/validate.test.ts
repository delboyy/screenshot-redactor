import { describe, it, expect } from "vitest";
import { regionStats, isUniformRegion, assertIrreversible, type SimpleImageData } from "./validate";

function makeImageData(width: number, height: number, fill: [number, number, number, number]): SimpleImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  return { data, width, height };
}

describe("export validate helpers", () => {
  it("uniform region stats", () => {
    const img = makeImageData(4, 4, [0, 0, 0, 255]);
    const stats = regionStats(img, 0, 0, 4, 4);
    expect(isUniformRegion(img, 0, 0, 4, 4)).toBe(true);
    expect(stats.mean).toBe(0);
  });

  it("assertIrreversible blackout", () => {
    const before = makeImageData(4, 4, [200, 200, 200, 255]);
    const after = makeImageData(4, 4, [0, 0, 0, 255]);
    expect(assertIrreversible(before, after, "blackout")).toBe(true);
  });

  it("assertIrreversible blur reduces variance", () => {
    const before = makeImageData(4, 4, [0, 0, 0, 255]);
    // Inject a bright pixel to increase variance
    before.data[(1 * 4 + 1) * 4 + 0] = 255;
    before.data[(1 * 4 + 1) * 4 + 1] = 255;
    before.data[(1 * 4 + 1) * 4 + 2] = 255;
    const after = makeImageData(4, 4, [40, 40, 40, 255]);
    expect(assertIrreversible(before, after, "blur")).toBe(true);
  });

  it("assertIrreversible pixelate changes pixels", () => {
    const before = makeImageData(4, 4, [10, 10, 10, 255]);
    const after = makeImageData(4, 4, [30, 30, 30, 255]);
    expect(assertIrreversible(before, after, "pixelate")).toBe(true);
  });
});

