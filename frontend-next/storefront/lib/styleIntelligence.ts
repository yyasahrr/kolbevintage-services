import type { Product } from "../data/catalog";

export type StyleSuggestion = { product: Product; score: number; reasons: string[] };

const complements: Record<string, string[]> = {
  red: ["white", "cream", "black", "navy", "beige"],
  white: ["red", "navy", "black", "brown", "green"],
  navy: ["white", "cream", "beige", "brown", "red"],
  green: ["cream", "brown", "white", "beige"],
  brown: ["cream", "white", "navy", "green"],
  black: ["white", "red", "cream", "beige"],
  beige: ["navy", "brown", "green", "red", "white"],
  cream: ["navy", "brown", "green", "red", "black"],
};

const categoryPairs: Record<string, string[]> = {
  blazer: ["shirt", "trouser", "accessory", "shoe"],
  shirt: ["trouser", "blazer", "knit", "accessory"],
  knit: ["shirt", "trouser", "accessory", "coat"],
  trouser: ["shirt", "knit", "blazer", "accessory"],
  coat: ["knit", "shirt", "trouser", "accessory"],
  accessory: ["shirt", "trouser", "blazer", "knit", "coat"],
  shoe: ["trouser", "shirt", "blazer"],
};

function colourFamily(hex: string) {
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return "neutral";
  const red = parseInt(value.slice(0, 2), 16) / 255;
  const green = parseInt(value.slice(2, 4), 16) / 255;
  const blue = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue); const min = Math.min(red, green, blue);
  if (max < .18) return "black";
  if (min > .82) return "white";
  if (max - min < .1) return max > .65 ? "cream" : "neutral";
  let hue = max === red ? ((green - blue) / (max - min)) % 6 : max === green ? (blue - red) / (max - min) + 2 : (red - green) / (max - min) + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 18 || hue >= 345) return "red";
  if (hue < 55) return max > .72 && min > .45 ? "beige" : "brown";
  if (hue < 165) return "green";
  if (hue < 255) return "navy";
  return "neutral";
}

export function scoreStylePair(anchor: Product, candidate: Product, behaviorWeight = 0): StyleSuggestion {
  let score = 0;
  const reasons: string[] = [];
  if (categoryPairs[anchor.category]?.includes(candidate.category)) { score += 38; reasons.push("دسته مکمل پوشش"); }
  if (candidate.style === anchor.style) { score += 22; reasons.push("زبان استایل مشترک"); }
  if (candidate.season === anchor.season || candidate.season.includes("چهارفصل")) { score += 12; reasons.push("هماهنگ با فصل"); }
  const anchorColours = new Set(anchor.colours.map((colour) => colourFamily(colour.hex)));
  const candidateColours = new Set(candidate.colours.map((colour) => colourFamily(colour.hex)));
  const colourMatch = [...anchorColours].some((colour) => [...candidateColours].some((next) => complements[colour]?.includes(next)));
  if (colourMatch) { score += 24; reasons.push("هارمونی رنگ مکمل"); }
  if (anchor.complementaryIds.includes(candidate.id)) { score += 30; reasons.push("مکمل تأییدشده قبلی"); }
  if (behaviorWeight > 0) { score += Math.min(18, behaviorWeight); reasons.push("رفتار خرید مشابه"); }
  return { product: candidate, score: Math.min(100, score), reasons };
}

export function recommendStyleProducts(anchor: Product, allProducts: Product[], behavior: Record<string, number> = {}, limit = 6) {
  return allProducts
    .filter((candidate) => candidate.id !== anchor.id)
    .map((candidate) => scoreStylePair(anchor, candidate, behavior[candidate.id] ?? 0))
    .filter((item) => item.score >= 30)
    .sort((a, b) => b.score - a.score || b.product.sold - a.product.sold)
    .slice(0, limit);
}
