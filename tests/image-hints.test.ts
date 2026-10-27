import { describe, expect, it } from "vitest";
import { imageFormat, imageHints, imageName, type ImageFacts, type ImageFormat, type ImageSize } from "@/lib/client/hints/images/checks";

// The facts come from the rendered analysis frame and the sizes from HEAD
// requests (both checked in Chrome); these tests cover the rules on top.
const KB = 1024;
const img = (url: string, natural: [number, number], display: [number, number] | null = natural, failed = false): ImageFacts => ({
  url,
  natural: { width: natural[0], height: natural[1] },
  display: display && { width: display[0], height: display[1] },
  failed,
});
const sized = (entries: [string, number, ImageFormat][]) =>
  new Map<string, ImageSize>(entries.map(([url, bytes, format]) => [url, { bytes, format }]));
const ids = (hints: { id: string }[]) => hints.map((h) => h.id);

describe("image hints: sizes", () => {
  it("warns when the measured images total over 1.5 MB, counting each file once", () => {
    const images = [img("https://i.test/a.jpg", [4000, 4000]), img("https://i.test/a.jpg", [4000, 4000]), img("https://i.test/b.jpg", [4000, 4000])];
    const hints = imageHints(images, sized([["https://i.test/a.jpg", 800 * KB, "jpeg"], ["https://i.test/b.jpg", 800 * KB, "jpeg"]]));
    expect(hints.find((h) => h.id === "images-total")).toMatchObject({ severity: "warning", title: "Images total 1.56 MB" });
    const under = imageHints(images.slice(0, 2), sized([["https://i.test/a.jpg", 800 * KB, "jpeg"]]));
    expect(ids(under)).not.toContain("images-total");
  });

  it("says the total is a lower bound when some images couldn't be measured", () => {
    const images = [img("https://i.test/a.jpg", [4000, 4000]), img("https://i.test/b.jpg", [4000, 4000]), img("https://i.test/c.jpg", [10, 10])];
    const sizes = sized([["https://i.test/a.jpg", 800 * KB, "jpeg"], ["https://i.test/b.jpg", 800 * KB, "jpeg"]]);
    sizes.set("https://i.test/c.jpg", null);
    expect(imageHints(images, sizes).find((h) => h.id === "images-total")?.title).toBe("Images total at least 1.56 MB");
  });

  it("warns about each image over 100 KB, largest first", () => {
    const images = [img("https://i.test/a.jpg", [2000, 2000]), img("https://i.test/b.jpg", [2000, 2000]), img("https://i.test/c.jpg", [2000, 2000])];
    const hint = imageHints(images, sized([["https://i.test/a.jpg", 150 * KB, "jpeg"], ["https://i.test/b.jpg", 100 * KB, "jpeg"], ["https://i.test/c.jpg", 300 * KB, "jpeg"]])).find(
      (h) => h.id === "images-large",
    );
    expect(hint?.title).toBe("2 images are over 100.0 KB");
    expect(hint?.detail).toContain("i.test/c.jpg (300.0 KB), i.test/a.jpg (150.0 KB)");
  });
});

describe("image hints: bytes per pixel", () => {
  const bpp = (format: "jpeg" | "png" | "gif" | "other", bytes: number) =>
    ids(imageHints([img("https://i.test/x", [100, 100])], sized([["https://i.test/x", bytes, format]]))).includes("images-bytes-per-pixel");

  it("uses a limit per format: JPEG 0.15, PNG 0.3, GIF 1, anything else 0.1", () => {
    // 100×100 = 10,000 pixels.
    expect(bpp("jpeg", 1500)).toBe(false);
    expect(bpp("jpeg", 1501)).toBe(true);
    expect(bpp("png", 3000)).toBe(false);
    expect(bpp("png", 3001)).toBe(true);
    expect(bpp("gif", 10_000)).toBe(false);
    expect(bpp("gif", 10_001)).toBe(true);
    expect(bpp("other", 1000)).toBe(false);
    expect(bpp("other", 1001)).toBe(true);
  });

  it("skips SVGs and images that didn't load", () => {
    expect(ids(imageHints([img("https://i.test/x.svg", [10, 10])], sized([["https://i.test/x.svg", 50 * KB, "svg"]])))).toEqual([]);
    expect(ids(imageHints([img("https://i.test/x", [0, 0], null)], sized([["https://i.test/x", 5 * KB, "jpeg"]])))).toEqual([]);
  });
});

describe("image hints: dimensions", () => {
  const dims = (natural: [number, number], display: [number, number] | null) =>
    ids(imageHints([img("https://i.test/x.jpg", natural, display)], sized([["https://i.test/x.jpg", 1, "jpeg"]])));

  it("flags files more than 2× the size they're shown at", () => {
    expect(dims([1200, 800], [600, 400])).toEqual([]);
    expect(dims([1201, 801], [600, 400])).toEqual(["images-oversized"]);
  });

  it("flags images shown larger than their file", () => {
    expect(dims([600, 400], [600, 400])).toEqual([]);
    expect(dims([600, 400], [600.4, 400])).toEqual([]);
    expect(dims([300, 200], [600, 400])).toEqual(["images-upscaled"]);
  });

  it("skips images that aren't shown or didn't load, and SVGs", () => {
    expect(dims([4000, 4000], null)).toEqual([]);
    expect(dims([0, 0], [600, 400])).toEqual([]);
    expect(ids(imageHints([img("https://i.test/x.svg", [100, 100], [600, 600])], new Map([["https://i.test/x.svg", null]])))).toEqual([
      "images-sizes-unavailable",
    ]);
  });
});

describe("image hints: sizes not available", () => {
  it("is a note with no review line when an image couldn't be measured", () => {
    const hint = imageHints([img("https://i.test/a.jpg", [100, 100])], new Map([["https://i.test/a.jpg", null]]))[0];
    expect(hint).toMatchObject({ id: "images-sizes-unavailable", severity: "info", title: "Image sizes not available" });
    expect(hint.reviewNote).toBeUndefined();
    expect(hint.detail).toContain("i.test/a.jpg");
  });
});

describe("image format", () => {
  it("reads the Content-Type, else the URL's extension", () => {
    expect(imageFormat("image/jpeg", "https://i.test/x.png")).toBe("jpeg");
    expect(imageFormat("image/png; charset=binary", "https://i.test/x")).toBe("png");
    expect(imageFormat("image/webp", "https://i.test/x.jpg")).toBe("other");
    expect(imageFormat(null, "https://i.test/a/photo.JPG?w=600")).toBe("jpeg");
    expect(imageFormat("application/octet-stream", "https://i.test/x.gif")).toBe("gif");
    expect(imageFormat(null, "https://i.test/x.svg")).toBe("svg");
    expect(imageFormat(null, "https://i.test/x")).toBe("other");
  });
});

describe("image names in hints", () => {
  it("drops the scheme, and keeps the host and file name of long URLs", () => {
    expect(imageName("https://i.test/a.jpg?w=600")).toBe("i.test/a.jpg?w=600");
    expect(imageName(`https://upload.example.org/${"deep/".repeat(12)}hero-image.jpg`)).toBe("upload.example.org/…/hero-image.jpg");
  });
});

describe("image hints: didn't load", () => {
  it("warns about https images that failed, each URL once", () => {
    const images = [img("https://i.test/gone.jpg", [0, 0], [600, 400], true), img("https://i.test/gone.jpg", [0, 0], null, true)];
    const hint = imageHints(images, new Map([["https://i.test/gone.jpg", null]])).find((h) => h.id === "images-failed");
    expect(hint).toMatchObject({ severity: "warning", title: "An image didn't load" });
    expect(hint?.detail).toContain("i.test/gone.jpg.");
    // Not also listed as "sizes not available".
    expect(ids(imageHints(images, new Map()))).toEqual(["images-failed"]);
  });

  it("leaves http images to the warning from the HTML", () => {
    const hints = imageHints([img("http://i.test/a.jpg", [0, 0], [600, 400], true)], new Map([["http://i.test/a.jpg", null]]));
    expect(ids(hints)).not.toContain("images-failed");
  });
});
