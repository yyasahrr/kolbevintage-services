import type {
  Catalogue,
  Commission,
  Dispute,
  DisputeStatus,
  EscrowStatus,
  EscrowTransaction,
  FulfillmentItem,
  FulfillmentRequest,
  FulfillmentStatus,
  Order,
  OrderItem,
  OrderStatus,
  Payment,
  Product,
  ProductVariant,
  SettlementAdjustment,
  SettlementStatus,
  Shipment,
  ShipmentStatus,
  Supplier,
  SupplierProductMapping,
  SupplierSettlement,
  TimelineEvent,
  VIPCustomer,
  WholesaleDataset,
} from "./types";

export const SLA = {
  acceptHours: 6,
  prepareHours: 48,
  shipHours: 72,
  inspectionHours: 72,
} as const;

const HOUR = 3600_000;
const DAY = 24 * HOUR;

const DATASET = {
  days: 120,
  orders: 140,
  suppliers: 12,
  customers: 26,
  products: 60,
  catalogues: 6,
  disputeRate: 0.07,
} as const;

/** deterministic mulberry32 PRNG so every reload renders the same business state */
function createRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

const SEED = 20260814;

const SUPPLIER_NAMES: ReadonlyArray<[string, string, string]> = [
  ["Atlas Textile", "تهران", "پارچه و بافت"],
  ["Negin Apparel", "اصفهان", "پوشاک زنانه"],
  ["Arman Garment", "تبریز", "پوشاک مردانه"],
  ["Saba Manufacturing", "مشهد", "تولید انبوه"],
  ["Parsa Knitwear", "یزد", "بافتنی"],
  ["Kavir Denim", "کاشان", "جین و دنیم"],
  ["Shiraz Leather", "شیراز", "چرم"],
  ["Alborz Outerwear", "کرج", "لباس بیرونی"],
  ["Caspian Linen", "رشت", "کتان"],
  ["Zagros Wool", "خرم‌آباد", "پشم"],
  ["Nahal Accessories", "قم", "اکسسوری"],
  ["Roya Silk", "کرمان", "ابریشم"],
];

const CUSTOMER_NAMES: ReadonlyArray<[string, string, string]> = [
  ["آرش مرادی", "Modena Concept Store", "میلان"],
  ["سارا کیانی", "Kiani Wholesale Group", "تهران"],
  ["Luca Bianchi", "Bianchi Retail SRL", "میلان"],
  ["مهدی رستمی", "Rostami Trading", "دبی"],
  ["Elena Rossi", "Rossi Boutiques", "رم"],
  ["نگار توکلی", "Negar Fashion House", "تهران"],
  ["Marco Ferrari", "Ferrari Uomo", "فلورانس"],
  ["حسین امینی", "Amini Textile Import", "استانبول"],
  ["Sofia Conti", "Conti Select", "تورین"],
  ["پریسا نجفی", "Najafi Concept", "شیراز"],
  ["Giulia Marino", "Marino Atelier", "ناپل"],
  ["کامران دهقان", "Dehghan Group", "مسقط"],
  ["Andrea Greco", "Greco Distribution", "بولونیا"],
  ["لیلا شریفی", "Sharifi Boutique", "اصفهان"],
  ["Matteo Costa", "Costa Menswear", "ونیز"],
  ["رضا فتحی", "Fathi Wholesale", "تهران"],
  ["Chiara Romano", "Romano Studio", "میلان"],
  ["بهار صادقی", "Sadeghi Style", "تبریز"],
  ["Davide Galli", "Galli Trade", "جنوا"],
  ["امیر قاسمی", "Ghasemi Export", "دوحه"],
  ["Valentina Ricci", "Ricci Fashion", "پالرمو"],
  ["مریم اسدی", "Asadi Retail", "مشهد"],
  ["Federico Rizzo", "Rizzo Collective", "بارسلونا"],
  ["نیما بهرامی", "Bahrami Brothers", "کویت"],
  ["Alessia Fontana", "Fontana Boutique", "ورونا"],
  ["شیما کاظمی", "Kazemi Concept", "تهران"],
];

const CATALOGUES: ReadonlyArray<[string, string, string]> = [
  ["Heritage Autumn", "پاییز ۱۴۰۴", "outerwear"],
  ["Vintage Denim Vault", "چهارفصل", "denim"],
  ["Milano Knit Edit", "زمستان ۱۴۰۴", "knitwear"],
  ["Classic Polo Line", "بهار ۱۴۰۵", "polo"],
  ["Leather Archive", "چهارفصل", "leather"],
  ["Linen Summer Drop", "تابستان ۱۴۰۵", "linen"],
];

const PRODUCT_WORDS = [
  "Boulevard Polo",
  "Archive Trench",
  "Selvedge Jean",
  "Merino Crewneck",
  "Suede Bomber",
  "Linen Overshirt",
  "Corduroy Blazer",
  "Cashmere Scarf",
  "Oxford Shirt",
  "Wool Peacoat",
  "Chino Pleated",
  "Knit Cardigan",
];

const COLOURS = ["Navy", "Teal", "Sand", "Olive", "Bordeaux", "Charcoal", "Ecru"];
const SIZES = ["S", "M", "L", "XL", "XXL"];
const CARRIERS = ["Tipax", "Chapar", "DHL Wholesale", "Post Express", "Mahex"];
const ADMINS = ["نازنین رحیمی", "سپهر یوسفی", "الهام کریمی", "بهزاد نوری"];
const DISPUTE_REASONS = [
  "مغایرت سایز با سفارش",
  "آسیب‌دیدگی بسته‌بندی",
  "کسری تعداد ارسالی",
  "کیفیت پارچه پایین‌تر از نمونه",
  "تأخیر بیش از حد در تحویل",
  "رنگ‌بندی اشتباه",
];

/** tiered commission 8..12% based on supplier volume tier */
function commissionRateFor(supplier: Supplier, orderValue: number): number {
  const base = supplier.commissionTier;
  if (orderValue > 900_000_000) return Math.max(8, base - 1);
  if (orderValue < 200_000_000) return Math.min(12, base + 1);
  return base;
}

export function generateDataset(now = Date.now()): WholesaleDataset {
  // the RNG is created per call so the same anchor always yields the same dataset
  const rng = createRng(SEED);
  const rand = () => rng();
  const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];

  const start = now - DATASET.days * DAY;

  const suppliers: Supplier[] = SUPPLIER_NAMES.slice(0, DATASET.suppliers).map(
    ([name, city, specialty], i) => ({
      id: `sup-${i + 1}`,
      name,
      city,
      specialty,
      onboardedAt: iso(start - randInt(30, 900) * DAY),
      commissionTier: 8 + (i % 5),
      reliability: 0.55 + rand() * 0.42,
    }),
  );

  const customers: VIPCustomer[] = CUSTOMER_NAMES.slice(0, DATASET.customers).map(
    ([name, company, city], i) => ({
      id: `cus-${i + 1}`,
      name,
      company,
      city,
      tier: i % 5 === 0 ? "platinum" : i % 3 === 0 ? "gold" : "silver",
      segment: "active",
      joinedAt: iso(start - randInt(10, 720) * DAY),
      contact: `vip${i + 1}@kolbevintage.com`,
    }),
  );

  const catalogues: Catalogue[] = CATALOGUES.slice(0, DATASET.catalogues).map(
    ([name, season, category], i) => ({
      id: `cat-${i + 1}`,
      name,
      season,
      category,
      views: randInt(1800, 14200),
    }),
  );

  const products: Product[] = [];
  const variants: ProductVariant[] = [];
  const mappings: SupplierProductMapping[] = [];
  for (let i = 0; i < DATASET.products; i++) {
    const catalogue = catalogues[i % catalogues.length];
    const supplier = suppliers[i % suppliers.length];
    const unitPrice = randInt(9, 68) * 100_000;
    const product: Product = {
      id: `prd-${i + 1}`,
      sku: `KV-${1000 + i}`,
      name: `${PRODUCT_WORDS[i % PRODUCT_WORDS.length]} ${String.fromCharCode(65 + (i % 8))}${i + 1}`,
      catalogueId: catalogue.id,
      category: catalogue.category,
      unitPrice,
      supplierId: supplier.id,
    };
    products.push(product);
    mappings.push({
      supplierId: supplier.id,
      productId: product.id,
      leadTimeHours: randInt(24, 96),
      supplierCost: Math.round(unitPrice * (0.62 + rand() * 0.12)),
    });
    for (let v = 0; v < 3; v++) {
      variants.push({
        id: `${product.id}-v${v + 1}`,
        productId: product.id,
        size: SIZES[(i + v) % SIZES.length],
        colour: COLOURS[(i + v) % COLOURS.length],
      });
    }
  }
  const costByProduct = new Map(mappings.map((m) => [m.productId, m.supplierCost]));

  const orders: Order[] = [];
  const payments: Payment[] = [];
  const escrows: EscrowTransaction[] = [];
  const fulfillments: FulfillmentRequest[] = [];
  const shipments: Shipment[] = [];
  const disputes: Dispute[] = [];
  const commissions: Commission[] = [];
  const settlements: SupplierSettlement[] = [];
  const timeline: TimelineEvent[] = [];

  for (let i = 0; i < DATASET.orders; i++) {
    const orderId = `ord-${i + 1}`;
    const code = `KV-${25000 + i}`;
    const customer = customers[randInt(0, customers.length - 1)];
    const catalogue = catalogues[randInt(0, catalogues.length - 1)];
    // skew orders towards recent days
    const ageDays = Math.floor(Math.pow(rand(), 1.25) * DATASET.days);
    const createdAt = now - ageDays * DAY - randInt(0, 23) * HOUR - randInt(0, 59) * 60_000;

    const catalogueProducts = products.filter((p) => p.catalogueId === catalogue.id);
    const lineCount = randInt(2, 6);
    const items: OrderItem[] = [];
    for (let li = 0; li < lineCount; li++) {
      const product = catalogueProducts[randInt(0, catalogueProducts.length - 1)];
      if (items.some((it) => it.productId === product.id)) continue;
      const variant = variants.find((v) => v.productId === product.id)!;
      const quantity = randInt(8, 120);
      items.push({
        id: `${orderId}-it-${li + 1}`,
        orderId,
        productId: product.id,
        variantId: variant.id,
        supplierId: product.supplierId,
        quantity,
        unitPrice: product.unitPrice,
        lineTotal: quantity * product.unitPrice,
      });
    }
    if (items.length === 0) continue;

    const total = items.reduce((s, it) => s + it.lineTotal, 0);
    const itemCount = items.reduce((s, it) => s + it.quantity, 0);

    // --- lifecycle progression driven by age + supplier reliability -------
    const cancelled = rand() < 0.05 && ageDays > 3;
    const hasDispute = !cancelled && rand() < DATASET.disputeRate;

    const paidAt = createdAt + randInt(2, 180) * 60_000;
    const supplierIds = Array.from(new Set(items.map((it) => it.supplierId)));

    const order: Order = {
      id: orderId,
      code,
      customerId: customer.id,
      catalogueId: catalogue.id,
      createdAt: iso(createdAt),
      status: "created",
      items,
      itemCount,
      total,
      refundTotal: 0,
    };

    timeline.push({
      id: `${orderId}-tl-1`,
      orderId,
      at: iso(createdAt),
      actor: "customer",
      label: "ثبت سفارش",
      detail: `${customer.company} سفارش خود را از کاتالوگ ${catalogue.name} ثبت کرد`,
    });

    if (cancelled) {
      order.status = "cancelled";
      order.cancelledAt = iso(createdAt + randInt(1, 40) * HOUR);
      escrows.push({
        id: `esc-${orderId}`,
        orderId,
        status: "refunded",
        amountHeld: 0,
        amountReleased: 0,
        amountRefunded: total,
        heldAt: iso(paidAt),
      });
      timeline.push({
        id: `${orderId}-tl-x`,
        orderId,
        at: order.cancelledAt,
        actor: "kolbe",
        label: "لغو سفارش",
        detail: "سفارش پیش از تأمین لغو و وجه بازگردانده شد",
      });
      orders.push(order);
      continue;
    }

    payments.push({
      id: `pay-${orderId}`,
      orderId,
      amount: total,
      paidAt: iso(paidAt),
      method: pick(["bank_transfer", "corporate_card", "credit_line"] as const),
      reference: `TRX-${randInt(100000, 999999)}`,
    });
    timeline.push({
      id: `${orderId}-tl-2`,
      orderId,
      at: iso(paidAt),
      actor: "finance",
      label: "پرداخت در امانی (Escrow) نگهداری شد",
      detail: "وجه به حساب امانی کلبه وینتیج منتقل شد",
    });

    const fulfilledAt = paidAt + randInt(20, 120) * 60_000;
    timeline.push({
      id: `${orderId}-tl-3`,
      orderId,
      at: iso(fulfilledAt),
      actor: "kolbe",
      label: "ایجاد درخواست‌های تأمین",
      detail: `اقلام سفارش بین ${supplierIds.length} تأمین‌کننده تفکیک شد`,
    });

    const orderFulfillments: FulfillmentRequest[] = [];

    supplierIds.forEach((supplierId, si) => {
      const supplier = suppliers.find((s) => s.id === supplierId)!;
      const supplierItems = items.filter((it) => it.supplierId === supplierId);
      const customerValue = supplierItems.reduce((s, it) => s + it.lineTotal, 0);
      const fulfillmentId = `${orderId}-fr-${si + 1}`;
      const fItems: FulfillmentItem[] = supplierItems.map((it, k) => ({
        id: `${fulfillmentId}-fi-${k + 1}`,
        fulfillmentId,
        orderItemId: it.id,
        productId: it.productId,
        quantity: it.quantity,
        supplierCost: (costByProduct.get(it.productId) ?? Math.round(it.unitPrice * 0.68)) * it.quantity,
      }));
      const supplierCostTotal = fItems.reduce((s, it) => s + it.supplierCost, 0);

      const requestedAt = fulfilledAt + randInt(1, 25) * 60_000;
      const rel = supplier.reliability;

      const fr: FulfillmentRequest = {
        id: fulfillmentId,
        code: `FR-${11000 + fulfillments.length + orderFulfillments.length}`,
        orderId,
        supplierId,
        status: "requested",
        items: fItems,
        customerValue,
        supplierCostTotal,
        requestedAt: iso(requestedAt),
        slaAcceptHours: SLA.acceptHours,
        slaPrepareHours: SLA.prepareHours,
        slaShipHours: SLA.shipHours,
        delayed: false,
      };

      const rejected = rand() > rel + 0.35;
      const acceptHours = rand() < rel ? rand() * SLA.acceptHours : SLA.acceptHours + rand() * 14;
      const acceptedAt = requestedAt + acceptHours * HOUR;

      if (rejected && acceptedAt <= now) {
        fr.status = "rejected";
        fr.rejectedAt = iso(acceptedAt);
        fr.delayed = false;
        orderFulfillments.push(fr);
        return;
      }

      if (acceptedAt <= now) {
        fr.status = "accepted";
        fr.acceptedAt = iso(acceptedAt);
        const prepStart = acceptedAt + randInt(30, 300) * 60_000;
        const prepHours = rand() < rel ? 6 + rand() * (SLA.prepareHours - 6) : SLA.prepareHours + rand() * 40;
        const readyAt = prepStart + prepHours * HOUR;
        if (prepStart <= now) {
          fr.status = "preparing";
          fr.preparingAt = iso(prepStart);
        }
        if (readyAt <= now) {
          fr.status = "ready_to_ship";
          fr.readyAt = iso(readyAt);
          const shipHours = rand() < rel ? 2 + rand() * 20 : 20 + rand() * 60;
          const shippedAt = readyAt + shipHours * HOUR;
          if (shippedAt <= now) {
            fr.status = "shipped";
            fr.shippedAt = iso(shippedAt);
            const transitHours = 18 + rand() * 96;
            const deliveredAt = shippedAt + transitHours * HOUR;
            const etaAt = shippedAt + 72 * HOUR;
            let shipmentStatus: ShipmentStatus = "in_transit";
            if (deliveredAt <= now) {
              fr.status = "delivered";
              fr.deliveredAt = iso(deliveredAt);
              shipmentStatus = "delivered";
            } else if (now - shippedAt > 72 * HOUR) {
              shipmentStatus = "delayed";
            } else if (now - shippedAt > transitHours * HOUR * 0.75) {
              shipmentStatus = "out_for_delivery";
            }
            shipments.push({
              id: `shp-${fulfillmentId}`,
              fulfillmentId,
              orderId,
              supplierId,
              carrier: pick(CARRIERS),
              trackingCode: `TR${randInt(1000000, 9999999)}`,
              status: shipmentStatus,
              shippedAt: iso(shippedAt),
              etaAt: iso(etaAt),
              deliveredAt: deliveredAt <= now ? iso(deliveredAt) : undefined,
            });
          }
        }
      }

      // SLA breach detection against "now"
      const acceptDeadline = requestedAt + SLA.acceptHours * HOUR;
      const prepareDeadline = requestedAt + (SLA.acceptHours + SLA.prepareHours) * HOUR;
      const shipDeadline = requestedAt + (SLA.acceptHours + SLA.prepareHours + SLA.shipHours) * HOUR;
      if (fr.status === "requested" && now > acceptDeadline) fr.delayed = true;
      if ((fr.status === "accepted" || fr.status === "preparing") && now > prepareDeadline) fr.delayed = true;
      if (fr.status === "ready_to_ship" && now > shipDeadline) fr.delayed = true;

      orderFulfillments.push(fr);
    });

    fulfillments.push(...orderFulfillments);

    const active = orderFulfillments.filter((f) => f.status !== "rejected" && f.status !== "cancelled");
    const deliveredAll = active.length > 0 && active.every((f) => f.status === "delivered");
    const anyShipped = active.some((f) => f.status === "shipped" || f.status === "delivered");
    const anyDelivered = active.some((f) => f.status === "delivered");
    const anyAccepted = active.some((f) => f.status !== "requested");

    const lastDelivery = deliveredAll
      ? Math.max(...active.map((f) => new Date(f.deliveredAt!).getTime()))
      : undefined;

    let escrowStatus: EscrowStatus = "held";
    let settlementStatuses: SettlementStatus[] = [];

    if (deliveredAll && lastDelivery !== undefined) {
      order.deliveredAt = iso(lastDelivery);
      const inspectionEnds = lastDelivery + SLA.inspectionHours * HOUR;
      order.inspectionEndsAt = iso(inspectionEnds);
      timeline.push({
        id: `${orderId}-tl-d`,
        orderId,
        at: iso(lastDelivery),
        actor: "supplier",
        label: "تحویل کامل به مشتری",
        detail: "همه بسته‌های سفارش تحویل شد",
      });
      timeline.push({
        id: `${orderId}-tl-i`,
        orderId,
        at: iso(lastDelivery),
        actor: "system",
        label: "شروع بازه بازرسی ۷۲ ساعته",
      });

      if (hasDispute) {
        order.status = "disputed";
        escrowStatus = "frozen";
        const openedAt = lastDelivery + randInt(2, 60) * HOUR;
        const target = active[randInt(0, active.length - 1)];
        const frozen = Math.round(target.customerValue * (0.3 + rand() * 0.7));
        const statusPool: DisputeStatus[] = [
          "open",
          "waiting_customer",
          "waiting_supplier",
          "under_review",
          "resolved",
        ];
        const dStatus = now - openedAt > 10 * DAY ? "resolved" : pick(statusPool.slice(0, 4));
        disputes.push({
          id: `dis-${orderId}`,
          code: `DSP-${3000 + disputes.length}`,
          orderId,
          customerId: customer.id,
          supplierId: target.supplierId,
          fulfillmentId: target.id,
          reason: pick(DISPUTE_REASONS),
          amountFrozen: frozen,
          openedAt: iso(Math.min(openedAt, now)),
          status: dStatus,
          resolution:
            dStatus === "resolved"
              ? pick(["full_supplier_payment", "partial_settlement", "refund", "replacement"] as const)
              : undefined,
          resolvedAt: dStatus === "resolved" ? iso(Math.min(openedAt + randInt(2, 9) * DAY, now)) : undefined,
          assignedAdmin: pick(ADMINS),
        });
        timeline.push({
          id: `${orderId}-tl-dis`,
          orderId,
          at: iso(Math.min(openedAt, now)),
          actor: "customer",
          label: "ثبت اختلاف",
          detail: "وجه امانی تا زمان رفع اختلاف مسدود شد",
        });
        if (dStatus === "resolved") {
          order.status = "completed";
          order.refundTotal = Math.round(frozen * (0.2 + rand() * 0.5));
          escrowStatus = "partially_released";
          settlementStatuses = active.map(() => pick(["paid", "partially_paid", "scheduled"] as const));
          order.completedAt = iso(Math.min(openedAt + randInt(3, 10) * DAY, now));
        }
      } else if (now < inspectionEnds) {
        order.status = "inspection";
        escrowStatus = "held";
      } else {
        order.status = "completed";
        order.completedAt = iso(inspectionEnds);
        const settledLag = now - inspectionEnds;
        if (settledLag > 4 * DAY) {
          escrowStatus = "released";
          settlementStatuses = active.map(() => (rand() < 0.94 ? "paid" : "failed"));
        } else if (settledLag > 1.5 * DAY) {
          escrowStatus = "ready";
          settlementStatuses = active.map(() => pick(["processing", "scheduled", "paid"] as const));
        } else {
          escrowStatus = "ready";
          settlementStatuses = active.map(() => "pending" as SettlementStatus);
        }
        timeline.push({
          id: `${orderId}-tl-c`,
          orderId,
          at: order.completedAt,
          actor: "system",
          label: "پایان بازرسی و تکمیل سفارش",
          detail: "سفارش واجد شرایط تسویه شد",
        });
      }
    } else if (anyDelivered) {
      order.status = "partially_fulfilled";
    } else if (anyShipped) {
      order.status = "shipped";
    } else if (anyAccepted) {
      order.status = "processing";
    } else {
      order.status = "paid";
    }

    escrows.push({
      id: `esc-${orderId}`,
      orderId,
      status: escrowStatus,
      amountHeld:
        escrowStatus === "released"
          ? 0
          : escrowStatus === "partially_released"
            ? Math.round(total * 0.35)
            : total - order.refundTotal,
      amountReleased:
        escrowStatus === "released" ? total : escrowStatus === "partially_released" ? Math.round(total * 0.65) : 0,
      amountRefunded: order.refundTotal,
      heldAt: iso(paidAt),
      readyAt: escrowStatus === "ready" || escrowStatus === "released" ? order.completedAt : undefined,
      releasedAt: escrowStatus === "released" ? order.completedAt : undefined,
      frozenAt: escrowStatus === "frozen" ? order.deliveredAt : undefined,
    });

    if (settlementStatuses.length > 0) {
      active.forEach((fr, k) => {
        const rate = commissionRateFor(suppliers.find((s) => s.id === fr.supplierId)!, fr.customerValue);
        const commissionAmount = Math.round((fr.customerValue * rate) / 100);
        commissions.push({
          id: `com-${fr.id}`,
          orderId,
          fulfillmentId: fr.id,
          supplierId: fr.supplierId,
          rate,
          base: fr.customerValue,
          amount: commissionAmount,
          calculatedAt: order.completedAt ?? iso(now),
        });

        const settlementId = `set-${fr.id}`;
        const adjustments: SettlementAdjustment[] = [];
        if (rand() < 0.18) {
          adjustments.push({
            id: `${settlementId}-adj-1`,
            settlementId,
            type: pick(["damage", "late_penalty", "other"] as const),
            label: pick(["کسر بابت آسیب کالا", "جریمه تأخیر SLA", "تعدیل توافقی"]),
            amount: Math.round(fr.customerValue * (0.01 + rand() * 0.04)),
          });
        }
        const refundShare = Math.round(order.refundTotal / active.length);
        const adjustmentTotal = adjustments.reduce((s, a) => s + a.amount, 0);
        const payable = Math.max(
          0,
          fr.customerValue - commissionAmount - refundShare - adjustmentTotal,
        );
        const completedMs = order.completedAt ? new Date(order.completedAt).getTime() : now;
        const status = settlementStatuses[k] ?? "pending";
        settlements.push({
          id: settlementId,
          code: `ST-${7000 + settlements.length}`,
          orderId,
          fulfillmentId: fr.id,
          supplierId: fr.supplierId,
          status,
          fulfilledAmount: fr.customerValue,
          commissionAmount,
          refundAmount: refundShare,
          adjustments,
          adjustmentTotal,
          payableAmount: payable,
          dueAt: iso(completedMs + 3 * DAY),
          paidAt: status === "paid" ? iso(Math.min(completedMs + randInt(1, 5) * DAY, now)) : undefined,
          createdAt: iso(completedMs),
        });
      });
      timeline.push({
        id: `${orderId}-tl-s`,
        orderId,
        at: order.completedAt ?? iso(now),
        actor: "finance",
        label: "محاسبه کمیسیون و تسویه تأمین‌کنندگان",
      });
    }

    orders.push(order);
  }

  // upcoming settlement due-dates for a few pending ones, so "due today/this week" is populated
  settlements.forEach((s, i) => {
    if (s.status === "pending" || s.status === "scheduled") {
      s.dueAt = iso(now + ((i % 9) - 1) * DAY + randInt(1, 8) * HOUR);
    }
  });

  // customer segmentation derived from real behaviour
  const gmvByCustomer = new Map<string, number>();
  const lastOrderByCustomer = new Map<string, number>();
  const countByCustomer = new Map<string, number>();
  for (const o of orders) {
    gmvByCustomer.set(o.customerId, (gmvByCustomer.get(o.customerId) ?? 0) + o.total);
    countByCustomer.set(o.customerId, (countByCustomer.get(o.customerId) ?? 0) + 1);
    const t = new Date(o.createdAt).getTime();
    if (t > (lastOrderByCustomer.get(o.customerId) ?? 0)) lastOrderByCustomer.set(o.customerId, t);
  }
  for (const c of customers) {
    const gmv = gmvByCustomer.get(c.id) ?? 0;
    const last = lastOrderByCustomer.get(c.id) ?? 0;
    const daysSince = last ? (now - last) / DAY : 999;
    const count = countByCustomer.get(c.id) ?? 0;
    if (count === 0 || daysSince > 90) c.segment = "dormant";
    else if (new Date(c.joinedAt).getTime() > now - 45 * DAY) c.segment = "new";
    else if (gmv > 2_500_000_000) c.segment = "high_value";
    else if (daysSince > 45) c.segment = "at_risk";
    else c.segment = "active";
  }

  timeline.sort((a, b) => a.at.localeCompare(b.at));

  return {
    suppliers,
    customers,
    catalogues,
    products,
    variants,
    mappings,
    orders,
    payments,
    escrows,
    fulfillments,
    shipments,
    disputes,
    commissions,
    settlements,
    timeline,
    generatedAt: iso(now),
  };
}

export const FULFILLMENT_STATUS_ORDER: FulfillmentStatus[] = [
  "requested",
  "accepted",
  "preparing",
  "ready_to_ship",
  "shipped",
  "delivered",
  "rejected",
  "cancelled",
];

export const ORDER_STATUS_ORDER: OrderStatus[] = [
  "created",
  "paid",
  "processing",
  "partially_fulfilled",
  "shipped",
  "delivered",
  "inspection",
  "completed",
  "disputed",
  "cancelled",
];
