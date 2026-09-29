import { useEffect, useState } from "react";
import { api } from "./api";
import { loadToken } from "./api";

export type CatalogSize = { id: string; label: string; active: boolean; sortOrder: number };
export type SeriesTemplateLine = { sizeId: string; label: string; quantity: number; sortOrder: number; active?: boolean };
export type SeriesTemplate = {
  id: string;
  productTypeId: string;
  code: string;
  name: string;
  description: string;
  active: boolean;
  sortOrder: number;
  lines: SeriesTemplateLine[];
};
export type CatalogProductType = {
  id: string;
  code: string;
  name: string;
  description: string;
  active: boolean;
  sortOrder: number;
  sizes: CatalogSize[];
  templates: SeriesTemplate[];
};

export async function loadCatalogProductTypes() {
  const data = await api<{ productTypes: CatalogProductType[] }>("/store/kolbe/catalog/product-types");
  return data.productTypes ?? [];
}

export function useCatalogProductTypes() {
  const [types, setTypes] = useState<CatalogProductType[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = () => {
    setLoading(true);
    return loadCatalogProductTypes()
      .then((next) => { setTypes(next); setError(""); })
      .catch(() => setError("سایزها از سرور دریافت نشد. فهرست ثابت استفاده نمی‌شود."))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    reload();
    const onFocus = () => { loadCatalogProductTypes().then(setTypes).catch(() => undefined); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  return { types, error, loading, reload };
}

function adminToken() {
  return loadToken("admin");
}

async function adminApi<T>(path: string, body?: unknown, method = "POST") {
  const token = adminToken();
  if (!token) throw new Error("ورود ادمین انجام نشده است.");
  return api<T>(path, { method, token, body });
}

export async function loadAdminProductTypes() {
  const data = await adminApi<{ productTypes: CatalogProductType[] }>("/store/kolbe/admin/product-types", undefined, "GET");
  return data.productTypes ?? [];
}

export async function createProductType(input: { code: string; name: string; description: string; active: boolean; sortOrder: number }) {
  return adminApi<{ productType: CatalogProductType }>("/store/kolbe/admin/product-types", input);
}

export async function updateProductType(id: string, input: Partial<{ code: string; name: string; description: string; active: boolean; sortOrder: number }>) {
  return adminApi(`/store/kolbe/admin/product-types/${id}`, input);
}

export async function reorderProductTypes(ids: string[]) {
  return adminApi("/store/kolbe/admin/product-types/reorder", { ids });
}

export async function addProductTypeSize(typeId: string, label: string, position?: number) {
  return adminApi<{ size: CatalogSize }>(`/store/kolbe/admin/product-types/${typeId}/sizes`, { label, position });
}

export async function updateProductTypeSize(id: string, input: { label?: string; active?: boolean; position?: number }) {
  return adminApi(`/store/kolbe/admin/sizes/${id}`, input);
}

export async function reorderProductTypeSizes(typeId: string, ids: string[]) {
  return adminApi(`/store/kolbe/admin/product-types/${typeId}/sizes/reorder`, { ids });
}

export async function saveSeriesTemplate(input: {
  id?: string;
  productTypeId: string;
  code?: string;
  name: string;
  description?: string;
  active?: boolean;
  lines: Array<{ sizeId: string; quantity: number }>;
}) {
  const path = input.id ? `/store/kolbe/admin/series-templates/${input.id}` : "/store/kolbe/admin/series-templates";
  return adminApi(path, input);
}
