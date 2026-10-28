/**
 * Matches owner-supplied photo filenames to catalogue products.
 *
 * The catalogue contains many near-identical titles ("4MP ColorVu dome" vs
 * "2MP ColorVu dome"), so plain fuzzy text search is not safe: a wrong match
 * would show the wrong product. This matcher weights rare tokens (model codes,
 * series names), penalises conflicting megapixel/brand tokens, and reports
 * ambiguous cases instead of guessing.
 */

export type PhotoProduct = { slug: string; name: string };

export type PhotoMatchStatus = "matched" | "ambiguous" | "unmatched";

export type PhotoMatch = {
  status: PhotoMatchStatus;
  best: { slug: string; name: string; score: number } | null;
  alternatives: { slug: string; name: string; score: number }[];
  reason: string;
};

const STOPWORDS = new Set([
  "the", "and", "with", "for", "of", "a", "an", "to", "in", "on",
  "img", "image", "photo", "pic", "picture", "copy", "final", "new",
  "jpeg", "jpg", "png", "webp", "heic",
]);

/** Tokens that describe a whole category rather than a specific SKU. */
const GENERIC = new Set([
  "camera", "cameras", "ip", "network", "wifi", "wireless", "smart",
  "hybrid", "light", "fixed", "security", "cctv", "kit", "kits", "series",
  "digital", "video", "outdoor", "indoor", "hd", "uhd", "poe",
]);

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalizeName(value)
    .split(" ")
    // Series numbers such as the "2" in "Ranger 2" are single characters but
    // are often the only thing distinguishing two products.
    .filter((token) => (token.length > 1 || /^\d$/.test(token)) && !STOPWORDS.has(token));
}

/** Model codes such as ds2cd1347g2hliu, ds7616niq2, dsj142i, dskis313pb. */
function isModelToken(token: string): boolean {
  return /^[a-z]{1,4}\d{2,}[a-z0-9]*$/.test(token) && token.length >= 5;
}

function megapixels(value: string): number | null {
  const normalised = normalizeName(value);
  const match = normalised.match(/\b(\d{1,2})\s?mp\b/);
  if (match) return Number(match[1]);
  const k = normalised.match(/\b(\d)k\b/);
  if (k) return Math.round(Number(k[1]) * 0.8); // 3K ~ 5MP marketing naming
  return null;
}

const BRANDS = ["hikvision", "hikvisio", "imou", "starlink", "dahua", "unv"];

function brandOf(value: string): string | null {
  const normalised = normalizeName(value);
  return BRANDS.find((brand) => normalised.includes(brand)) ?? null;
}

function idfWeights(products: PhotoProduct[]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const product of products) {
    for (const token of new Set(tokens(product.name))) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }
  const total = Math.max(1, products.length);
  const weights = new Map<string, number>();
  for (const [token, count] of frequency) {
    // Rare tokens carry more signal; generic vocabulary is deliberately weak.
    const base = Math.log(1 + total / count) + 1;
    weights.set(token, GENERIC.has(token) ? base * 0.25 : base);
  }
  return weights;
}

function scorePair(
  fileTokens: string[],
  product: PhotoProduct,
  weights: Map<string, number>,
): number {
  const productTokens = tokens(product.name);
  const productSet = new Set(productTokens);
  const uniqueFileTokens = [...new Set(fileTokens)];
  let score = 0;
  let shared = 0;

  for (const token of uniqueFileTokens) {
    const weight = weights.get(token) ?? 1;
    if (productSet.has(token)) {
      shared += 1;
      score += isModelToken(token) ? weight * 2.5 : weight;
    } else {
      // Tokens present in the file name but missing from the product title are
      // evidence against the match (e.g. "2" in "Ranger 2" vs "Ranger Mini").
      score -= weight * 0.35;
    }
  }

  // Reward covering the whole file name, so an exact series match beats a
  // partial one with the same brand and megapixels.
  if (uniqueFileTokens.length > 0) {
    score += 1.5 * (shared / uniqueFileTokens.length);
  }

  const fileBrand = brandOf(fileTokens.join(" "));
  const productBrand = brandOf(product.name);
  if (fileBrand || productBrand) {
    if (fileBrand && productBrand && fileBrand !== productBrand) score -= 3;
    else if (fileBrand && fileBrand === productBrand) score += 1.5;
  }

  const fileMp = megapixels(fileTokens.join(" "));
  const productMp = megapixels(product.name);
  if (fileMp !== null && productMp !== null && fileMp !== productMp) score -= 4;

  return score;
}

export function rankPhotoMatches(fileName: string, products: PhotoProduct[]): {
  slug: string;
  name: string;
  score: number;
}[] {
  const weights = idfWeights(products);
  const fileTokens = tokens(fileName.replace(/\.[a-z0-9]+$/i, ""));
  return products
    .map((product) => ({
      slug: product.slug,
      name: product.name,
      score: Math.round(scorePair(fileTokens, product, weights) * 100) / 100,
    }))
    .sort((a, b) => b.score - a.score);
}

export function matchPhotoToProduct(fileName: string, products: PhotoProduct[]): PhotoMatch {
  const ranked = rankPhotoMatches(fileName, products);
  const best = ranked[0] ?? null;
  const alternatives = ranked.slice(1, 4).filter((candidate) => candidate.score > 0);

  if (!best || best.score < 3) {
    return {
      status: "unmatched",
      best: null,
      alternatives,
      reason: "No product shares enough distinctive tokens with this file name.",
    };
  }

  const second = alternatives[0];
  const margin = second ? best.score - second.score : best.score;
  if (second && margin < 1 && second.score > best.score * 0.85) {
    return {
      status: "ambiguous",
      best,
      alternatives,
      reason: `Two products score within ${margin.toFixed(2)} points; rename the file or choose manually.`,
    };
  }

  return {
    status: "matched",
    best,
    alternatives,
    reason: `Matched on ${Math.round(best.score)} weighting points (margin ${margin.toFixed(2)}).`,
  };
}
