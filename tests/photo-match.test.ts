import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchPhotoToProduct, normalizeName } from "@/lib/catalogue/photo-match";

const payload = JSON.parse(
  readFileSync(path.join(process.cwd(), "data/import/uthman-iy-catalogue-2026-10-26.json"), "utf8"),
) as { products: { name: string; slug: string }[] };

const products = payload.products.map(({ name, slug }) => ({ name, slug }));

function match(file: string) {
  return matchPhotoToProduct(file, products);
}

describe("photo filename matching", () => {
  it("normalises separators, brands and file extensions", () => {
    expect(normalizeName("HIKVISION_DS-2CD1347G2H-LIU 4MP.JPG")).toBe(
      "hikvision ds 2cd1347g2h liu 4mp jpg",
    );
  });

  it("matches an exact model code", () => {
    const result = match("HIKVISION DS-2CD1347G2H-LIU 4MP dome.jpg");
    expect(result.status).toBe("matched");
    expect(result.best?.slug).toBe("hikvision-ds-2cd1347g2h-liu-color-vu-with-smart-hybrid-4mp-dome");
  });

  it("matches a short marketing name", () => {
    const result = match("IMOU Ranger 2 3MP.jpg");
    expect(result.status).toBe("matched");
    expect(result.best?.name).toContain("IMOU Ranger 2 3MP");
  });

  it("matches a simple product name", () => {
    const result = match("Starlink Kit V4.png");
    expect(result.status).toBe("matched");
    expect(result.best?.name).toBe("Starlink Kit V4");
  });

  it("prefers the matching megapixel variant over the wrong one", () => {
    const result = match("HIKVISION 8MP Dual Light Motion 2.0 Fixed Bullet Network Camera.jpg");
    expect(result.status).toBe("matched");
    expect(result.best?.name).toContain("8MP");
    expect(result.best?.name).toContain("Bullet");
  });

  it("refuses to guess between two identically named products", () => {
    const result = match("HIKVISION 6MP ColorVu 3.0 Fixed Turret Acuseek Network Camera.jpg");
    expect(result.status).toBe("ambiguous");
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it("reports unmatched camera-roll and screenshot files", () => {
    expect(match("IMG_2034.jpg").status).toBe("unmatched");
    expect(match("Screenshot 2026-10-26 at 10.12.44.png").status).toBe("unmatched");
  });
});
