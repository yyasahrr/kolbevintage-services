import { useEffect, useState } from "react";
import { Link } from "../router";
import { api, loadToken } from "../lib/api";
import { toman } from "../utils/format";

type Item = { id: string; name: string; price: number; category?: string; priceSource?: string };

export default function RecommendationSlot({ slot, productId, title }: { slot: string; productId?: string; title: string }) {
  const [data, setData] = useState<{ strategy?: string; products?: Item[] } | null>(null);
  useEffect(() => {
    const query = new URLSearchParams({ slot });
    if (productId) query.set("productId", productId);
    api<{ strategy: string; products: Item[] }>(`/store/kolbe/recommendations?${query}`, { token: loadToken("customer") })
      .then(setData)
      .catch(() => setData({ products: [] }));
  }, [slot, productId]);
  if (!data?.products?.length) return null;
  return (
    <section className="mt-12">
      <h2 className="mb-4 text-[16px] font-medium">{title}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.products.map((product) => (
          <Link
            key={product.id}
            to={`/product/${product.id}`}
            className="border border-neutral-200 p-3"
            onClick={() => {
              void api("/store/kolbe/recommendations/events", {
                method: "POST",
                token: loadToken("customer"),
                body: { name: "recommendation.clicked", slot, strategy: data.strategy, productId: product.id },
              }).catch(() => undefined);
            }}
          >
            <p className="text-[12px] font-medium">{product.name}</p>
            <p className="mt-1 text-[11px] text-neutral-500">{product.category}</p>
            <p className="mt-2 text-[12px] num-fa">{toman(product.price)}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
