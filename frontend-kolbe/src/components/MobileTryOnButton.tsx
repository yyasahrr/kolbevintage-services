import Icon from "./Icon";
import { Link, useRouter } from "../router";

export default function MobileTryOnButton() {
  const { path } = useRouter();
  if (path === "/try-on") return null;
  const productId = path.startsWith("/product/") ? path.split("/")[2] : "";

  return (
    <Link
      to={`/try-on${productId ? `?top=${productId}` : ""}`}
      className={`mobile-tryon-button fixed left-3 z-[72] flex h-12 items-center gap-2 rounded-full px-4 text-[11.5px] font-medium lg:hidden ${productId ? "bottom-[5.7rem]" : "bottom-3"}`}
      aria-label="پرو مجازی هوشمند"
    >
      <Icon name="star" className="h-4 w-4" />
      <span>پرو هوشمند</span>
    </Link>
  );
}
