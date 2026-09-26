/**
 * آداپتورهای دامنهٔ تأمین‌کننده (فاز ۶.۲).
 *
 * این فایل **تنها لایهٔ مجازِ فراخوانیِ API برای پورتال تأمین‌کننده** است.
 * هیچ `fetch`ای اینجا نیست: همه‌چیز از `ApiClient` مشترکِ `@shared/http`
 * می‌گذرد، پس خطا، نشست، لغو، تایم‌اوت و پایهٔ نشانی دقیقاً یک پیاده‌سازی دارند.
 *
 * قواعدِ سخت:
 *  - هیچ فراخوانی شکست را به «آرایهٔ خالی» یا «مقدار صفر» تبدیل نمی‌کند؛
 *    خروجی همیشه `ApiResult` است و مصرف‌کننده موظف به رندرِ وضعیتِ درست است.
 *  - شناسهٔ تأمین‌کننده هرگز از مرورگر نمی‌آید: مسیرهایی که به `:supplierId`
 *    نیاز دارند، آن را از **نشست سرور** می‌گیرند (ورودیِ تابع فقط برای ادمین است).
 *  - عملیاتِ تغییردهنده هدر `Idempotency-Key` می‌فرستند تا دوبار-ارسال،
 *    وضعیتِ تکراری نسازد.
 */

import type {
  ApiClient, ApiResult } from "../http/types";
import {
  normalizeChildOrder,
  normalizeHistoryEntry,
  normalizeList,
  normalizeProductionJob,
  normalizeRecall,
  normalizeSupplierProduct,
  normalizeSupplierRfq,
  normalizeSupportCase,
  normalizeTeamMember,
  normalizeTeamRole,
  normalizeWithdrawal,
} from "./normalize";
import type {
  AgreementStatus,
  AnalyticsQueryInput,
  AnalyticsResult,
  BankDestination,
  CapacityPeriod,
  ChildOrder,
  ComplianceDocument,
  ComplianceHold,
  ComplianceProfile,
  CreateCaseInput,
  DocumentAccessGrant,
  FinancialAccountSummary,
  FinancialHistoryEntry,
  IdempotencyKey,
  InventoryRecord,
  ListQuery,
  OrderActionInput,
  OrderTransition,
  ProformaInvoice,
  ProductionCapability,
  ProductionChangeRequest,
  ProductionClosure,
  ProductionDefect,
  ProductionEvent,
  ProductionInspection,
  ProductionJob,
  ProductionLot,
  ProductionMilestone,
  ProductionRework,
  ProductionSample,
  QuoteInput,
  RecallRecord,
  ReleaseReadiness,
  SettlementEligibility,
  Shipment,
  ShipmentException,
  ShipmentTrackingInput,
  SupplierApplicationInput,
  SupplierCasePriority,
  SupplierLoginInput,
  SupplierProduct,
  SupplierRfq,
  SupplierSubmissionResult,
  SupportCase,
  TeamMemberAddInput,
  TeamMemberUpdateInput,
  SupportCaseDetail,
  WithdrawalRequest,
  SupplierStagedProductInput,
  SupplierSubmissionReview,
  SupplierCategoryNode,
  SupplierBrand,
  SupplierUploadedMedia,
  SupplierStagedSubmissionResult,
} from "./contracts";

/* ── کلیدِ یکتای عملیات ─────────────────────────────────────────────────────
 * این کلید یک «نانسِ ضدِ تکرار» است، نه یک شناسهٔ تجاری. برخلاف کد رهگیری یا
 * شمارهٔ مرجع، ارزشِ آن فقط جلوگیری از اجرای دوبارهِ همان عملیاتِ کاربر است و
 * هرگز به‌عنوان شناسهٔ کسب‌وکار نمایش داده نمی‌شود.
 */
function randomIdempotencyKey(): IdempotencyKey {
  const cryptoRef: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") return cryptoRef.randomUUID();
  // مسیرِ پشتیبان فقط برای محیط‌های بدون Web Crypto (تست‌های قدیمی).
  const bytes = new Uint8Array(16);
  if (cryptoRef && typeof cryptoRef.getRandomValues === "function") cryptoRef.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newIdempotencyKey(): IdempotencyKey {
  return randomIdempotencyKey();
}

function idem(key: IdempotencyKey): Record<string, string> {
  return { "Idempotency-Key": key };
}

function queryOf(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    params[key] = value;
  }
  return params;
}

/**
 * نگاشتِ دادهٔ موفقِ یک نتیجه، بدون دست‌زدن به مسیرِ خطا.
 *
 * این تنها جایی است که «شکلِ خامِ سرور» به «قراردادِ تایپ‌شدهٔ پورتال» تبدیل
 * می‌شود؛ مسیرِ شکست دست‌نخورده می‌ماند، پس هیچ خطایی به دادهٔ خالی بدل نمی‌شود.
 */
function mapOk<T, R>(result: ApiResult<T>, map: (data: T) => R): ApiResult<R> {
  if (!result.ok) return result;
  return { ok: true, data: map(result.data), meta: result.meta };
}

export type SupplierApi = ReturnType<typeof createSupplierApi>;

/** سه فیلدی که UI برای انتخابِ آگاهانهٔ محصولِ مقصد لازم دارد. */
export type CanonicalProductCandidate = { id: string; name: string; sku: string | null };

export function createSupplierApi(client: ApiClient) {
  const get = <T>(path: string, query?: Record<string, unknown>) =>
    client.requestResult<T>(path, { method: "GET", query: queryOf(query) as never });
  const post = <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    client.requestResult<T>(path, { method: "POST", body, headers });
  const put = <T>(path: string, body?: unknown) => client.requestResult<T>(path, { method: "PUT", body });
  const patch = <T>(path: string, body?: unknown) => client.requestResult<T>(path, { method: "PATCH", body });
  const del = <T>(path: string) => client.requestResult<T>(path, { method: "DELETE" });

  return {
    /* ── ۱. احراز هویت، نشست و درخواست عضویت ─────────────────────────────── */
    auth: {
      /** ورودِ تأمین‌کننده — پاسخ مرجعِ هویت نیست؛ بعد از آن `/auth/me` خوانده می‌شود. */
      login: (input: SupplierLoginInput) =>
        post<{ user?: Record<string, unknown>; supplier?: Record<string, unknown> }>("/auth/supplier/login", {
          email: input.email.trim(),
          password: input.password,
        }),
      logout: () => post<{ ok?: boolean }>("/auth/logout"),
      /** تنها مرجعِ هویتِ تأمین‌کننده. */
      me: () => get<Record<string, unknown>>("/auth/me"),
      health: () => get<Record<string, unknown>>("/health/live"),
      apply: (input: SupplierApplicationInput) =>
        post<{ id: string }>("/suppliers/applications", {
          companyName: input.companyName,
          representativeName: input.representativeName,
          phone: input.phone,
          category: input.category,
          monthlyCapacity: input.monthlyCapacity,
        }),
    },

    /* ── ۲. داشبورد و تحلیل ──────────────────────────────────────────────── */
    analytics: {
      overview: (query?: AnalyticsQueryInput) => get<AnalyticsResult>("/supplier/analytics/overview", query),
      orders: (query?: AnalyticsQueryInput) => get<AnalyticsResult>("/supplier/analytics/orders", query),
      inventory: (query?: AnalyticsQueryInput) => get<AnalyticsResult>("/supplier/analytics/inventory", query),
      settlement: (query?: AnalyticsQueryInput) => get<AnalyticsResult>("/supplier/analytics/settlement", query),
    },

    /* ── ۳. محصولات و ارسال به کاتالوگ ───────────────────────────────────── */
    products: {
      /** قراردادِ انتقالیِ ثبت‌شده (`compat`) — تنها seams موجود برای فهرستِ محصول. */
      list: (query?: ListQuery) =>
        get<Record<string, unknown>>("/compat/supplier/products", {
          limit: query?.limit,
          offset: query?.offset,
        }).then(result =>
          mapOk(result, data => ({ products: normalizeList((data as { products?: unknown }).products, normalizeSupplierProduct) })),
        ),
      /**
       * ثبتِ پیشنهاد محصول از مسیرِ **کانونیکِ غنی**.
       *
       * این مسیرِ صحیح است: کلِ گراف (واریانت‌ها با صفات/رسانه/موجودی، رسانهٔ
       * محصول و واریانت، بخشِ تجاری با واحدِ MOQ، بسته‌ها و پله‌های قیمت) را
       * یک‌جا مرحله‌بندی می‌کند و ادمین همان را تأیید می‌کند.
       * `POST /catalog/compat/supplier-submissions` تنها برای سازگاریِ backward
       * نگه داشته شده و یک واریانت/یک رسانه/`moq:1` می‌سازد.
       */
      submitStaged: (input: SupplierStagedProductInput) =>
        post<SupplierStagedSubmissionResult>("/catalog/supplier-submissions", input),

      /**
       * مسیرِ انتقالیِ ثبت‌شده (compat).
       *
       * @deprecated از `submitStaged` استفاده کنید. این مسیر گراف را به یک
       * واریانت و `moq: 1` تقلیل می‌دهد و قصدِ تأمین‌کننده را از دست می‌دهد.
       */
      submit: (input: Record<string, unknown>) =>
        post<{ product: SupplierSubmissionResult }>("/catalog/compat/supplier-submissions", input),
    },

    /* ── ۳الف. دسته‌بندی/برند کانونیک و بارگذاریِ رسانه ──────────────────── */
    taxonomy: {
      /**
       * دسته‌بندیِ کانونیکِ سرور (درختی) **همراه با `attributesSchema`**.
       *
       * ویرایشگر، ورودیِ ویژگی‌های محصول را از همین طرح می‌سازد؛ هیچ فهرستِ
       * سخت‌کدشده‌ای در UI استفاده نمی‌شود.
       */
      categories: () => get<SupplierCategoryNode[]>("/catalog/categories"),
      /** برندهای تأییدشده و فعال. */
      brands: () => get<SupplierBrand[]>("/catalog/brands"),
    },

    media: {
      /**
       * بارگذاریِ واقعیِ فایل از راهِ seamِ سمتِ سرور.
       *
       * مرورگر فایل را می‌فرستد و `url` می‌گیرد؛ هیچ کلید/رمزِ ذخیره‌سازی به
       * مرورگر نمی‌رسد. همان `url` در گرافِ مرحله‌بندی‌شده قرار می‌گیرد.
       */
      upload: (file: File) => {
        const form = new FormData();
        form.append("file", file, file.name);
        return client.requestResult<SupplierUploadedMedia>("/media/upload", { method: "POST", body: form });
      },
    },

    /* ── ۳ب. بازبینیِ ادمین بر پیشنهادها ─────────────────────────────────── */
    reviews: {
      /**
       * فهرستِ پیشنهادها برای بازبینی. ادمین باید پیش از تأیید بتواند ببیند.
       * `GET /catalog/supplier-submissions` — فقط ادمین با `retail:catalog:manage`.
       */
      list: (query?: { supplierId?: string; status?: string }) =>
        get<SupplierSubmissionReview[]>("/catalog/supplier-submissions", {
          supplierId: query?.supplierId,
          status: query?.status,
        }),
      /** کلِ گرافِ یک پیشنهاد — همان چیزی که ادمین تأیید می‌کند. */
      get: (id: string) =>
        get<SupplierSubmissionReview>(`/catalog/supplier-submissions/${encodeURIComponent(id)}`),

      /**
       * تأیید به‌عنوانِ **محصولِ تازه**: یک محصولِ کانونیکالِ کامل ساخته می‌شود.
       * `POST /catalog/supplier-submissions/:id/approve-new`
       */
      approveAsNew: (id: string, note?: string) =>
        post<SupplierSubmissionReview>(`/catalog/supplier-submissions/${encodeURIComponent(id)}/approve-new`, { note }),

      /**
       * تأیید به‌عنوانِ **محصولِ موجود**: کلِ گرافِ تجاریِ تأمین‌کننده به یک
       * محصولِ کانونیکالِ ازقبل‌موجود متصل می‌شود؛ محصولِ تکراری ساخته نمی‌شود.
       * `productId` را ادمین صریحاً انتخاب می‌کند — هیچ حدسِ خودکاری نیست.
       * `POST /catalog/supplier-submissions/:id/approve-existing`
       */
      approveAsExisting: (id: string, productId: string, note?: string) =>
        post<SupplierSubmissionReview>(`/catalog/supplier-submissions/${encodeURIComponent(id)}/approve-existing`, { productId, note }),

      /**
       * ردِ پیشنهاد. تنها «یادداشت» آزاد است؛ سرور وضعیتِ جداگانه‌ای به نامِ
       * «درخواستِ اصلاح» ندارد، پس این همان بازخوردِ اصلاح است — نه یک action
       * ساختگیِ چهارم. `POST /catalog/supplier-submissions/:id/reject`
       */
      reject: (id: string, note: string) =>
        post<SupplierSubmissionReview>(`/catalog/supplier-submissions/${encodeURIComponent(id)}/reject`, { note }),
    },

    /* ── ۳ب. جست‌وجوی محصولِ کانونیکال (برای اتصالِ پیشنهاد به محصولِ موجود) ── */
    catalogSearch: {
      /**
       * `GET /catalog/products?q=…` — همان مسیری که کنترلرِ واقعی دارد.
       * برای انتخابِ آگاهانهٔ محصولِ مقصد؛ هیچ تطبیقِ فازی در مرورگر نیست.
       *
       * ⚠️ کنترلر یک **پاکتِ صفحه‌بندی** برمی‌گرداند (`{results, nextCursor}`)،
       * نه یک آرایهٔ خام. پیش‌تر این متد نتیجه را `Array<Record<string, unknown>>`
       * اعلام می‌کرد، پس مصرف‌کننده روی یک object متدِ `.map` صدا می‌زد و
       * `TypeError` می‌گرفت؛ چون خطا داخلِ یک `useCallback` ناهمگام گم می‌شد،
       * دکمهٔ «جست‌وجو» برای همیشه در «در حالِ جست‌وجو…» می‌ماند و هیچ خطایی هم
       * نشان داده نمی‌شد. یعنی مسیرِ «اتصال به محصولِ موجود» عملاً کار نمی‌کرد.
       * حالا پاکت باز می‌شود و فقط سه فیلدی که UI نیاز دارد بیرون می‌آید.
       */
      products: async (q: string, limit = 20): Promise<ApiResult<CanonicalProductCandidate[]>> => {
        const result = await get<{ results?: unknown }>("/catalog/products", {
          q,
          channel: "wholesale",
          limit: String(limit),
        });
        if (!result.ok) return result;
        const rows = Array.isArray(result.data?.results) ? result.data.results : [];
        return {
          ...result,
          data: rows
            .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
            .map((row) => ({
              id: String(row.id ?? ""),
              name: String(row.name ?? ""),
              sku: row.sku == null ? null : String(row.sku),
            }))
            .filter((row) => row.id.length > 0),
        };
      },

      /**
       * `POST /catalog/products/:id/status` — گذارِ وضعیتِ محصولِ کانونیکال.
       *
       * چرا این لازم است؟ تأییدِ ادمین محصول را `approved` می‌کند، ولی مرورِ
       * کانالِ عمده‌فروشی فقط `p.status = 'published'` را نشان می‌دهد. بدونِ این
       * کنش، محصولِ تأییدشده هرگز در کاتالوگ عمده دیده نمی‌شد — یعنی یک
       * قابلیتِ واقعیِ بک‌اند که از UI حذف شده بود. وضعیت از سرور خوانده می‌شود
       * و هیچ تطبیق یا حدسی در مرورگر انجام نمی‌شود.
       */
      transition: (productId: string, status: "draft" | "pending_review" | "approved" | "published" | "suspended" | "archived") =>
        post<Record<string, unknown>>(`/catalog/products/${encodeURIComponent(productId)}/status`, { status }),
    },

    /* ── ۴. RFQ و پیشنهاد قیمت ───────────────────────────────────────────── */
    rfqs: {
      list: (query?: ListQuery) =>
        get<Record<string, unknown>>("/compat/supplier/rfqs", { limit: query?.limit, offset: query?.offset }).then(result =>
          mapOk(result, data => ({ rfqs: normalizeList((data as { rfqs?: unknown }).rfqs, normalizeSupplierRfq) })),
        ),
      quote: (rfqId: string, input: QuoteInput) =>
        post<Record<string, unknown>>(`/offers/compat/rfqs/${encodeURIComponent(rfqId)}/quote`, input),
    },

    /* ── ۵. سفارش‌ها، چرخه‌عمر و ارسال ─────────────────────────────────────── */
    orders: {
      list: () =>
        get<Record<string, unknown>>("/supplier/orders").then(result =>
          mapOk(result, data => {
            const raw = (data as { children?: unknown }).children ?? (data as { orders?: unknown }).orders;
            return { children: normalizeList(raw, normalizeChildOrder) };
          }),
        ),
      get: (id: string) =>
        get<Record<string, unknown>>(`/supplier/orders/${encodeURIComponent(id)}`).then(result =>
          mapOk(result, data => ({ child: normalizeChildOrder((data as { child?: unknown }).child) })),
        ),
      action: (transition: OrderTransition, input: OrderActionInput & { id: string }) => {
        const body: Record<string, unknown> = {};
        if (input.expectedVersion !== undefined) body.expectedVersion = input.expectedVersion;
        if (input.reason) body.reason = input.reason;
        // کدِ رهگیری فقط وقتی فرستاده می‌شود که اپراتور آن را وارد کرده باشد.
        if (transition === "dispatch") {
          if (input.trackingCode) body.trackingCode = input.trackingCode;
          if (input.carrier) body.carrier = input.carrier;
        }
        return post<{ child: ChildOrder; replayed?: boolean }>(
          `/supplier/orders/${encodeURIComponent(input.id)}/${transition}`,
          body,
          idem(input.idempotencyKey),
        );
      },
      exceptions: (id: string) => get<{ exceptions: ShipmentException[] }>(`/supplier/orders/${encodeURIComponent(id)}/exceptions`),
      reportException: (id: string, body: Record<string, unknown>, key: IdempotencyKey) =>
        post<Record<string, unknown>>(`/supplier/orders/${encodeURIComponent(id)}/report-exception`, body, idem(key)),
    },

    shipments: {
      byChild: (childOrderId: string) => get<{ shipment: Shipment | null }>(`/supplier/shipments/child/${encodeURIComponent(childOrderId)}`),
      get: (id: string) => get<{ shipment: Shipment }>(`/supplier/shipments/${encodeURIComponent(id)}`),
      quote: (body: Record<string, unknown>) => post<Record<string, unknown>>("/supplier/shipments/quote", body),
      create: (body: Record<string, unknown>, key: IdempotencyKey) =>
        post<{ shipment: Shipment }>("/supplier/shipments", body, idem(key)),
      handoff: (id: string, body: Record<string, unknown>, key: IdempotencyKey) =>
        post<{ shipment: Shipment }>(`/supplier/shipments/${encodeURIComponent(id)}/handoff`, body, idem(key)),
      cancel: (id: string, body: Record<string, unknown>, key: IdempotencyKey) =>
        post<{ shipment: Shipment }>(`/supplier/shipments/${encodeURIComponent(id)}/cancel`, body, idem(key)),
      tracking: (id: string, input: ShipmentTrackingInput, key: IdempotencyKey) =>
        post<{ shipment: Shipment }>(`/supplier/shipments/${encodeURIComponent(id)}/tracking`, input, idem(key)),
    },

    /* ── ۶. موجودی ───────────────────────────────────────────────────────── */
    inventory: {
      mine: () => get<{ inventories?: InventoryRecord[]; items?: InventoryRecord[] }>("/inventory/my"),
    },

    /* ── ۷. مالی، تسویه و برداشت ─────────────────────────────────────────── */
    finance: {
      summary: () => get<FinancialAccountSummary>("/supplier/financial-account/summary"),
      history: (query?: ListQuery) =>
        get<Record<string, unknown>>("/supplier/financial-account/history", {
          limit: query?.limit,
          offset: query?.offset,
        }).then(result =>
          mapOk(result, data => ({ items: normalizeList((data as { items?: unknown }).items, normalizeHistoryEntry) })),
        ),
      withdrawals: (query?: ListQuery & { status?: string }) =>
        get<Record<string, unknown>>("/supplier/financial-account/withdrawals", {
          limit: query?.limit,
          offset: query?.offset,
          status: query?.status,
        }).then(result =>
          mapOk(result, data => ({
            withdrawals: normalizeList((data as { withdrawals?: unknown }).withdrawals, normalizeWithdrawal),
          })),
        ),
      withdrawal: (id: string) =>
        get<Record<string, unknown>>(`/supplier/financial-account/withdrawals/${encodeURIComponent(id)}`).then(result =>
          mapOk(result, data => ({ withdrawal: normalizeWithdrawal((data as { withdrawal?: unknown }).withdrawal) })),
        ),
      requestWithdrawal: (amount: string, key: IdempotencyKey) =>
        post<{ withdrawal: WithdrawalRequest }>(
          "/supplier/financial-account/withdrawals",
          { amount },
          { ...idem(key), "content-type": "application/json" },
        ),
      proformas: (query?: ListQuery) => get<{ proformas: ProformaInvoice[] }>("/supplier/finance/proformas", query),
      proforma: (id: string) => get<{ proforma: ProformaInvoice }>(`/supplier/finance/proformas/${encodeURIComponent(id)}`),
    },

    /* ── ۸. انطباق و اسناد ───────────────────────────────────────────────── */
    compliance: {
      /** بستهٔ سیاست‌های الزامی برای تأمین‌کننده (بدون شناسه). */
      agreementBundle: () => get<AgreementStatus>("/supplier/compliance/agreement"),
      profile: (supplierId: string) => get<{ profile: ComplianceProfile }>(`/supplier/compliance/${encodeURIComponent(supplierId)}/profile`),
      upsertProfile: (supplierId: string, body: Record<string, unknown>) =>
        put<{ profile: ComplianceProfile }>(`/supplier/compliance/${encodeURIComponent(supplierId)}/profile`, body),
      submitProfile: (supplierId: string) =>
        post<{ profile: ComplianceProfile }>(`/supplier/compliance/${encodeURIComponent(supplierId)}/profile/submit`),
      documents: (supplierId: string) =>
        get<{ documents: ComplianceDocument[] }>(`/supplier/compliance/${encodeURIComponent(supplierId)}/documents`),
      uploadDocument: (supplierId: string, body: { documentType: string; mimeType: string; contentBase64: string; originalFilename?: string }) =>
        post<{ document: ComplianceDocument }>(`/supplier/compliance/${encodeURIComponent(supplierId)}/documents`, body),
      /** دسترسیِ دارای مجوز/امضا — کلیدِ شیءٔ خصوصی هرگز به مرورگر داده نمی‌شود. */
      documentAccess: (documentId: string) =>
        post<DocumentAccessGrant>(`/supplier/compliance/documents/${encodeURIComponent(documentId)}/access`),
      contractStatus: (supplierId: string) => get<AgreementStatus>(`/supplier/compliance/${encodeURIComponent(supplierId)}/agreement`),
      acceptAgreement: (supplierId: string, policyDocumentId: string) =>
        post<Record<string, unknown>>(`/supplier/compliance/${encodeURIComponent(supplierId)}/agreement/accept`, { policyDocumentId }),
      holds: (supplierId: string) => get<{ holds: ComplianceHold[] }>(`/supplier/compliance/${encodeURIComponent(supplierId)}/holds`),
      bank: (supplierId: string) => get<{ current: BankDestination | null }>(`/supplier/compliance/${encodeURIComponent(supplierId)}/bank`),
      submitBank: (supplierId: string, body: { destinationKind: string; value: string; holderName?: string }) =>
        post<Record<string, unknown>>(`/supplier/compliance/${encodeURIComponent(supplierId)}/bank`, body),
      eligibility: (supplierId: string) =>
        get<SettlementEligibility>(`/supplier/compliance/${encodeURIComponent(supplierId)}/settlement-eligibility`),
    },

    /* ── ۹. پشتیبانی ─────────────────────────────────────────────────────── */
    support: {
      list: (query?: ListQuery) =>
        get<Record<string, unknown>>("/supplier/support/cases", {
          limit: query?.limit,
          offset: query?.offset,
        }).then(result =>
          mapOk(result, data => {
            const payload = data as { cases?: unknown; total?: unknown };
            return { cases: normalizeList(payload.cases, normalizeSupportCase), total: payload.total };
          }),
        ),
      create: (input: CreateCaseInput) => post<SupportCase>("/supplier/support/cases", input),
      get: (id: string) => get<SupportCaseDetail>(`/supplier/support/cases/${encodeURIComponent(id)}`),
      message: (id: string, body: string, visibility: "PUBLIC" | "INTERNAL" = "PUBLIC") =>
        post<Record<string, unknown>>(`/supplier/support/cases/${encodeURIComponent(id)}/messages`, { body, visibility }),
    },

    /* ── ۱۰. تولید و کنترل کیفیت (محدود به capability) ───────────────────── */
    production: {
      jobs: (query?: ListQuery) =>
        get<Record<string, unknown>>("/supplier/production/jobs", {
          page: query?.page,
          limit: query?.limit,
          status: query?.status,
        }).then(result =>
          mapOk(result, data => {
            const payload = data as { jobs?: unknown; pagination?: Record<string, unknown> };
            return { jobs: normalizeList(payload.jobs, normalizeProductionJob), pagination: payload.pagination };
          }),
        ),
      createJob: (body: { purchaseOrderId?: string; requiresSampleApproval?: boolean; requiresQualityRelease?: boolean }, key: IdempotencyKey) =>
        post<{ job: ProductionJob }>("/supplier/production/jobs", body, idem(key)),
      job: (id: string) => get<{ job: ProductionJob; milestones?: ProductionMilestone[] }>(`/supplier/production/jobs/${encodeURIComponent(id)}`),
      plan: (id: string, body: Record<string, unknown>, key: IdempotencyKey) =>
        post<{ job: ProductionJob }>(`/supplier/production/jobs/${encodeURIComponent(id)}/plan`, body, idem(key)),
      transition: (id: string, to: "start" | "block" | "complete" | "cancel", body: Record<string, unknown>, key: IdempotencyKey) =>
        post<{ job: ProductionJob }>(`/supplier/production/jobs/${encodeURIComponent(id)}/${to}`, body, idem(key)),
      actualUnits: (id: string, actualUnits: number, key: IdempotencyKey, expectedVersion?: number) =>
        post<{ job: ProductionJob }>(`/supplier/production/jobs/${encodeURIComponent(id)}/actual-units`, { actualUnits, expectedVersion }, idem(key)),
      milestones: () => get<{ definitions: Array<Record<string, unknown>> }>("/supplier/production/milestones"),
      transitionMilestone: (jobId: string, milestoneId: string, to: "start" | "complete" | "skip", key: IdempotencyKey, reason?: string) =>
        post<Record<string, unknown>>(
          `/supplier/production/jobs/${encodeURIComponent(jobId)}/milestones/${encodeURIComponent(milestoneId)}/${to}`,
          reason ? { reason } : {},
          idem(key),
        ),
      capabilities: () => get<{ capabilities: ProductionCapability[] }>("/supplier/production/capabilities"),
      capacityPeriods: (query?: ListQuery) =>
        get<{ periods: CapacityPeriod[]; pagination?: Record<string, unknown> }>("/supplier/production/capacity-periods", {
          page: query?.page,
          limit: query?.limit,
        }),
      createCapacityPeriod: (body: Record<string, unknown>) => post<{ period: CapacityPeriod }>("/supplier/production/capacity-periods", body),
      createClosure: (periodId: string, body: Record<string, unknown>) =>
        post<{ closure: ProductionClosure }>(`/supplier/production/capacity-periods/${encodeURIComponent(periodId)}/closures`, body),
      cancelClosure: (id: string, key: IdempotencyKey, reason?: string) =>
        post<Record<string, unknown>>(`/supplier/production/closures/${encodeURIComponent(id)}/cancel`, reason ? { reason } : {}, idem(key)),
      samples: (jobId: string) => get<{ samples: ProductionSample[] }>(`/supplier/production/jobs/${encodeURIComponent(jobId)}/samples`),
      createSample: (jobId: string, body: Record<string, unknown>, key: IdempotencyKey) =>
        post<{ sample: ProductionSample }>(`/supplier/production/jobs/${encodeURIComponent(jobId)}/samples`, body, idem(key)),
      sampleRevision: (jobId: string, sampleId: string, body: Record<string, unknown>, key: IdempotencyKey) =>
        post<Record<string, unknown>>(
          `/supplier/production/jobs/${encodeURIComponent(jobId)}/samples/${encodeURIComponent(sampleId)}/revisions`,
          body,
          idem(key),
        ),
      registerArtifact: (jobId: string, body: Record<string, unknown>, key: IdempotencyKey) =>
        post<Record<string, unknown>>(`/supplier/production/jobs/${encodeURIComponent(jobId)}/artifacts`, body, idem(key)),
      changeRequests: (jobId: string, body: Record<string, unknown>, key: IdempotencyKey) =>
        post<{ changeRequest?: ProductionChangeRequest }>(`/supplier/production/jobs/${encodeURIComponent(jobId)}/change-requests`, body, idem(key)),
      createLot: (jobId: string, body: Record<string, unknown>, key: IdempotencyKey) =>
        post<{ lot: ProductionLot }>(`/supplier/production/jobs/${encodeURIComponent(jobId)}/lots`, body, idem(key)),
      lotOutput: (jobId: string, lotId: string, body: Record<string, unknown>, key: IdempotencyKey) =>
        post<{ lot: ProductionLot }>(`/supplier/production/jobs/${encodeURIComponent(jobId)}/lots/${encodeURIComponent(lotId)}/output`, body, idem(key)),
      transitionLot: (jobId: string, lotId: string, to: "start" | "complete", key: IdempotencyKey) =>
        post<{ lot: ProductionLot }>(`/supplier/production/jobs/${encodeURIComponent(jobId)}/lots/${encodeURIComponent(lotId)}/${to}`, {}, idem(key)),
      lotTrace: (jobId: string, lotId: string, body: Record<string, unknown>, key: IdempotencyKey) =>
        post<Record<string, unknown>>(
          `/supplier/production/jobs/${encodeURIComponent(jobId)}/lots/${encodeURIComponent(lotId)}/traces`,
          body,
          idem(key),
        ),
      createInspection: (jobId: string, body: Record<string, unknown>, key: IdempotencyKey) =>
        post<{ inspection: ProductionInspection }>(`/supplier/production/jobs/${encodeURIComponent(jobId)}/inspections`, body, idem(key)),
      submitInspection: (jobId: string, inspectionId: string, body: Record<string, unknown>, key: IdempotencyKey) =>
        post<{ inspection: ProductionInspection }>(
          `/supplier/production/jobs/${encodeURIComponent(jobId)}/inspections/${encodeURIComponent(inspectionId)}/submit`,
          body,
          idem(key),
        ),
      recordDefect: (jobId: string, body: Record<string, unknown>, key: IdempotencyKey) =>
        post<{ defect: ProductionDefect }>(`/supplier/production/jobs/${encodeURIComponent(jobId)}/defects`, body, idem(key)),
      transitionDefect: (
        jobId: string,
        defectId: string,
        to: "acknowledge" | "rework" | "accept" | "waive" | "close",
        key: IdempotencyKey,
        dispositionNote?: string,
      ) =>
        post<{ defect: ProductionDefect }>(
          `/supplier/production/jobs/${encodeURIComponent(jobId)}/defects/${encodeURIComponent(defectId)}/${to}`,
          dispositionNote ? { dispositionNote } : {},
          idem(key),
        ),
      createRework: (jobId: string, body: Record<string, unknown>, key: IdempotencyKey) =>
        post<{ rework: ProductionRework }>(`/supplier/production/jobs/${encodeURIComponent(jobId)}/rework`, body, idem(key)),
      transitionRework: (jobId: string, reworkId: string, to: "start" | "complete" | "fail" | "cancel", key: IdempotencyKey) =>
        post<{ rework: ProductionRework }>(
          `/supplier/production/jobs/${encodeURIComponent(jobId)}/rework/${encodeURIComponent(reworkId)}/${to}`,
          {},
          idem(key),
        ),
      events: (jobId: string, query?: ListQuery) =>
        get<{ events: ProductionEvent[]; pagination?: Record<string, unknown> }>(
          `/supplier/production/jobs/${encodeURIComponent(jobId)}/events`,
          { page: query?.page, limit: query?.limit },
        ),
      releaseReadiness: (jobId: string, lotId: string) =>
        get<ReleaseReadiness>(`/supplier/production/jobs/${encodeURIComponent(jobId)}/lots/${encodeURIComponent(lotId)}/release-readiness`),
      requestQualityRelease: (jobId: string, body: Record<string, unknown>, key: IdempotencyKey) =>
        post<Record<string, unknown>>(`/supplier/production/jobs/${encodeURIComponent(jobId)}/quality-releases`, body, idem(key)),
      shippingHandoff: (qualityReleaseId: string) =>
        get<{ shippingHandoff: unknown }>(`/supplier/production/quality-releases/${encodeURIComponent(qualityReleaseId)}/shipping-handoff`),
      recalls: (query?: ListQuery) =>
        get<Record<string, unknown>>("/supplier/production/recalls", {
          page: query?.page,
          limit: query?.limit,
        }).then(result =>
          mapOk(result, data => {
            const payload = data as { recalls?: unknown; pagination?: Record<string, unknown> };
            return { recalls: normalizeList(payload.recalls, normalizeRecall), pagination: payload.pagination };
          }),
        ),
      createRecall: (body: Record<string, unknown>, key: IdempotencyKey) =>
        post<{ recall: RecallRecord }>("/supplier/production/recalls", body, idem(key)),
      submitRecall: (id: string, key: IdempotencyKey) =>
        post<{ recall: RecallRecord }>(`/supplier/production/recalls/${encodeURIComponent(id)}/submit`, {}, idem(key)),
    },

    /* ── ۱۲. تیم و دسترسی‌ها (بند C فاز ۶.۲) ─────────────────────────────────
     *
     * نکتهٔ امنیتی: `supplierId` در هیچ‌کدام از این فراخوانی‌ها فرستاده
     * نمی‌شود. سرور آن را از `Claims.sub → supplier_member` می‌گیرد؛ فرستادنش
     * از مرورگر یعنی دادنِ مرجعِ tenant به کلاینت، که دقیقاً همان چیزی است که
     * قاعدهٔ A6 ممنوع کرده است.
     */
    team: {
      /** اعضای تیمِ همان تأمین‌کننده‌ای که نشست به آن تعلق دارد. */
      list: () =>
        get<{ members?: unknown; self?: unknown }>("/supplier/team").then(result =>
          mapOk(result, data => ({
            members: normalizeList(data.members, normalizeTeamMember),
            self: data.self ? normalizeTeamMember(data.self as never) : null,
          })),
        ),
      /** نقش‌های مجاز + دسترسی‌های هر نقش — سیاست از سرور می‌آید. */
      roles: () =>
        get<{ roles?: unknown }>("/supplier/team/roles").then(result =>
          mapOk(result, data => ({ roles: normalizeList(data.roles, normalizeTeamRole) })),
        ),
      /**
       * افزودنِ یک حسابِ کاربریِ **موجود** به تیم.
       *
       * «دعوت‌نامهٔ ایمیلی» در این دامنه وجود ندارد (اسکیما نه جدولِ invitation
       * دارد نه ستونِ ایمیل/وضعیتِ دعوت)؛ پس چیزی به نامِ invite جعل نمی‌شود.
       */
      addMember: (input: TeamMemberAddInput, key: IdempotencyKey) =>
        post<{ member?: unknown }>("/supplier/team/members", {
          email: input.email.trim().toLowerCase(),
          role: input.role,
          title: input.title?.trim() || undefined,
        }, idem(key)).then(result =>
          mapOk(result, data => ({ member: data.member ? normalizeTeamMember(data.member) : null })),
        ),
      /** تغییرِ نقش/عنوان — فقط `owner` سمتِ سرور مجاز است. */
      updateMember: (memberId: string, input: TeamMemberUpdateInput) =>
        patch<{ member?: unknown }>(`/supplier/team/members/${encodeURIComponent(memberId)}`, {
          role: input.role,
          title: input.title?.trim() || undefined,
        }).then(result =>
          mapOk(result, data => ({ member: data.member ? normalizeTeamMember(data.member) : null })),
        ),
      /** حذفِ عضویت (اسکیما ستونِ وضعیت ندارد، پس «غیرفعال‌سازی» همان حذف است). */
      removeMember: (memberId: string) =>
        del<{ removedId?: string }>(`/supplier/team/members/${encodeURIComponent(memberId)}`),
    },
  };
}

export type SupplierApiResult<T> = ApiResult<T>;
export { randomIdempotencyKey };
