/**
 * نمای عمومی اسکیما.
 *
 * قاعدهٔ A2/A3: ماژول‌های `apps/api` فقط جداولی را می‌خوانند/می‌نویسند که در
 * `modules/registry.ts` مالک آن‌ها هستند. import مستقیم یک جدول بی‌مالک در
 * یک ماژول، در آزمون `module-boundaries.test.ts` شکست می‌خورد.
 */
export * as tables from "./tables";
export * from "./state-values";
export {
  accountUser,
  auditLog,
  brand,
  category,
  commandIdempotency,
  inventoryLedger,
  inventoryReservation,
  loginAttempt,
  offerMedia,
  orderEvent,
  orderStatusHistory,
  product,
  productMedia,
  productRating,
  productVariant,
  productVariantInventory,
  productVariantMedia,
  purchaseOrder,
  purchaseOrderItem,
  quote,
  retailOrder,
  retailOrderItem,
  rfq,
  seller,
  sellerOffer,
  siteSetting,
  supplier,
  supplierApplication,
  supplierMember,
  supplierPermissionConfig,
  supplierProductSubmission,
  supplierRating,
  supportTicket,
  systemLog,
  transactionRating,
  userSession,
  vipPlan,
  vipSubscription,
  wholesaleAccount,
  wholesaleOrder,
  wholesaleOrderItem,
  wholesaleOrderRequest,
  wholesalePackage,
  wholesalePackageItem,
  wholesalePricingTier,
  wholesaleRequest,
  wholesaleRequestRevision,
  fulfillmentException,
} from "./tables";
