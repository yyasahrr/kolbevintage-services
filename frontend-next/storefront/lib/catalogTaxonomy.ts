import { useEffect, useState } from "react";
import { categories as catalogCategories } from "../data/catalog";
import { styles as catalogStyles } from "../siteData";

export type TaxonomyOption = { id: string; label: string };
export type CatalogTaxonomy = { categories: TaxonomyOption[]; styles: TaxonomyOption[]; seasons: TaxonomyOption[]; collections: TaxonomyOption[] };
const KEY = "kv_catalog_taxonomy_v1";
export const defaultCatalogTaxonomy: CatalogTaxonomy = {
  categories: catalogCategories.map((item) => ({ id: item.slug, label: item.label })),
  styles: catalogStyles.map((item) => ({ id: item.slug, label: item.name })),
  seasons: ["چهار فصل", "بهار", "تابستان", "پاییز", "زمستان"].map((label) => ({ id: label, label })),
  collections: ["کالکشن پاییز", "وینتیج روزمره", "منتخب مهمانی"].map((label, index) => ({ id: `collection-${index + 1}`, label })),
};

export function loadCatalogTaxonomy(): CatalogTaxonomy {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultCatalogTaxonomy;
    const value = JSON.parse(raw) as Partial<CatalogTaxonomy>;
    return { ...defaultCatalogTaxonomy, ...value };
  } catch { return defaultCatalogTaxonomy; }
}

export function saveCatalogTaxonomy(value: CatalogTaxonomy) {
  localStorage.setItem(KEY, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("kolbe:taxonomy", { detail: value }));
}

export function useCatalogTaxonomy() {
  const [value, setValue] = useState<CatalogTaxonomy>(loadCatalogTaxonomy);
  useEffect(() => {
    const refresh = (event: Event) => setValue((event as CustomEvent<CatalogTaxonomy>).detail || loadCatalogTaxonomy());
    window.addEventListener("kolbe:taxonomy", refresh);
    return () => window.removeEventListener("kolbe:taxonomy", refresh);
  }, []);
  return value;
}
