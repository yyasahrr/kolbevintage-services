import type { ReactNode } from "react";
import type { MoneyString } from "../money";
import { Money, StatusBadge } from "./data-display";

type ProductImage = { src: string; alt: string };
type ProductCardBase = { id: string; name: string; image: ProductImage; href?: string; actions?: ReactNode; className?: string };

function ProductFrame({ product, eyebrow, price, metadata, badge }: { product: ProductCardBase; eyebrow?: ReactNode; price: ReactNode; metadata?: ReactNode; badge?: ReactNode }) {
  const content = <><figure className="kolbe-product-card__media"><img src={product.image.src} alt={product.image.alt} loading="lazy" />{badge}</figure><div className="kolbe-product-card__body">{eyebrow}<h3>{product.name}</h3>{price}{metadata}{product.actions ? <div className="kolbe-product-card__actions">{product.actions}</div> : null}</div></>;
  return <article className={`kolbe-product-card ${product.className ?? ""}`.trim()}>{product.href ? <a href={product.href}>{content}</a> : content}</article>;
}

export type ProductCardRetailProps = ProductCardBase & { price: MoneyString; salePrice?: MoneyString; promotionLabel?: string };
export function ProductCardRetail(props: ProductCardRetailProps) {
  const price = props.salePrice ? <div className="kolbe-product-card__price"><Money value={props.salePrice} /><del><Money value={props.price} /></del></div> : <div className="kolbe-product-card__price"><Money value={props.price} /></div>;
  return <ProductFrame product={props} eyebrow={props.promotionLabel ? <span className="kolbe-product-card__promotion">{props.promotionLabel}</span> : undefined} price={price} />;
}

export type WholesaleAvailability = { label: string; intent: "success" | "warning" | "danger" | "neutral" };
export type ProductCardWholesaleProps = ProductCardBase & { wholesalePrice: MoneyString; moq: string; moqUnit: string; packageLabel?: string; availability: WholesaleAvailability; sellerType: "KOLBE" | "SUPPLIER"; sellerName?: string };
export function ProductCardWholesale(props: ProductCardWholesaleProps) {
  return <ProductFrame product={props} badge={props.sellerType === "KOLBE" ? <span className="kolbe-product-card__seller">کلبه</span> : undefined} price={<div className="kolbe-product-card__price"><Money value={props.wholesalePrice} /></div>} metadata={<div className="kolbe-product-card__wholesale"><Description label="حداقل سفارش" value={`${props.moq} ${props.moqUnit}`} ltr /><Description label="بسته‌بندی" value={props.packageLabel ?? "اعلام نشده"} /><StatusBadge intent={props.availability.intent}>{props.availability.label}</StatusBadge>{props.sellerType === "SUPPLIER" && props.sellerName ? <Description label="فروشنده" value={props.sellerName} /> : null}</div>} />;
}

function Description({ label, value, ltr }: { label: string; value: ReactNode; ltr?: boolean }) { return <div className="kolbe-product-card__meta"><span>{label}</span><bdi dir={ltr ? "ltr" : undefined} className={ltr ? "kolbe-ltr kolbe-numeric" : undefined}>{value}</bdi></div>; }
