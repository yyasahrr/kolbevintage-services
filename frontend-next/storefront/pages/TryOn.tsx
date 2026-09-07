import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import { products, type Product } from "../data/catalog";
import { ApiError, api } from "../lib/api";
import { Link, useRouter } from "../router";

type GarmentCategory = "upper_body" | "lower_body";
type GenerationStatus = "idle" | "uploading" | "processing" | "success" | "error";
type SelectedGarments = Partial<Record<GarmentCategory, Product>>;

type PreparedFile = {
  fileId: string;
  upload: { method: string; url: string; headers: Record<string, string> };
};

const garmentGroups: Array<{ key: GarmentCategory; title: string; hint: string }> = [
  { key: "upper_body", title: "بالاتنه", hint: "کت، پیراهن یا بافت" },
  { key: "lower_body", title: "شلوار", hint: "شلوارهای کلبه" },
];

const errorMessages: Record<string, string> = {
  PERFECT_CORP_NOT_CONFIGURED: "سرویس پرو مجازی هنوز فعال نشده است. کلید Perfect Corp باید روی سرور تنظیم شود.",
  InvalidAccessToken: "کلید Perfect Corp معتبر نیست یا منقضی شده است.",
  INVALID_FILE_SIZE: "حجم هر تصویر باید کمتر از ۱۰ مگابایت باشد.",
  INVALID_FILE_TYPE: "فقط تصویر JPG یا PNG قابل استفاده است.",
  PERFECT_CORP_UNAVAILABLE: "ارتباط با سرویس پرو مجازی برقرار نشد. دوباره تلاش کنید.",
  error_pose: "حالت بدن در تصویر قابل تشخیص نیست. یک عکس روبه‌رو و واضح انتخاب کنید.",
  error_invalid_src: "تصویر شما برای پرو مناسب نیست. صورت و بالاتنه باید کاملاً دیده شوند.",
  error_invalid_ref: "تصویر محصول برای پرو مجازی مناسب نیست.",
  error_apply_region_mismatch: "این لباس با بخش قابل مشاهده در تصویر شما هم‌خوانی ندارد.",
  error_nsfw_content_detected: "تصویر به دلیل محدودیت‌های ایمنی پردازش نشد.",
};

function optionsFor(category: GarmentCategory) {
  return category === "lower_body"
    ? products.filter((product) => product.category === "trouser")
    : products.filter((product) => ["blazer", "shirt", "knit"].includes(product.category));
}

function categoryFor(product: Product): GarmentCategory {
  return product.category === "trouser" ? "lower_body" : "upper_body";
}

function messageFor(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return "";
  if (error instanceof ApiError) return errorMessages[error.code] ?? "ساخت تصویر کامل نشد. لطفاً با تصویر دیگری دوباره تلاش کنید.";
  if (error instanceof Error && error.message === "REFERENCE_IMAGE_FAILED") return "تصویر محصول در دسترس نیست. محصول دیگری انتخاب کنید.";
  return "ساخت تصویر کامل نشد. لطفاً دوباره تلاش کنید.";
}

function contentTypeFor(blob: Blob) {
  return blob.type === "image/png" ? "image/png" : "image/jpeg";
}

function extensionFor(contentType: string) {
  return contentType === "image/png" ? "png" : "jpg";
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

async function uploadToSignedUrl(prepared: PreparedFile, file: Blob, signal: AbortSignal) {
  const headers = Object.fromEntries(
    Object.entries(prepared.upload.headers).filter(([name]) => name.toLowerCase() !== "content-length"),
  );
  const response = await fetch(prepared.upload.url, {
    method: prepared.upload.method,
    headers,
    body: file,
    signal,
  });
  if (!response.ok) throw new Error("SIGNED_UPLOAD_FAILED");
}

async function pollTask(taskId: string, signal: AbortSignal) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await wait(attempt === 0 ? 1200 : 2000, signal);
    const result = await api<{ status: string; resultUrl: string | null; error: string | null }>(
      `/store/kolbe/try-on/tasks/${encodeURIComponent(taskId)}`,
      { signal },
    );
    if (result.status === "success" && result.resultUrl) return result.resultUrl;
    if (["error", "failed", "failure"].includes(result.status)) {
      throw new ApiError(result.error ?? "TRY_ON_FAILED");
    }
  }
  throw new ApiError("TRY_ON_TIMEOUT");
}

export default function TryOn() {
  const { query } = useRouter();
  const requestedProduct = products.find((product) => product.id === query.get("top"));
  const initialProduct = requestedProduct && requestedProduct.category !== "accessory"
    ? requestedProduct
    : optionsFor("upper_body")[0];
  const [activeCategory, setActiveCategory] = useState<GarmentCategory>(() => categoryFor(initialProduct));
  const [selected, setSelected] = useState<SelectedGarments>({ [categoryFor(initialProduct)]: initialProduct });
  const [portraitFile, setPortraitFile] = useState<File | null>(null);
  const [portraitUrl, setPortraitUrl] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [processingStep, setProcessingStep] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const visibleProducts = useMemo(() => optionsFor(activeCategory).slice(0, 8), [activeCategory]);
  const selectedProducts = useMemo(() => garmentGroups.flatMap((group) => selected[group.key] ? [selected[group.key]!] : []), [selected]);
  const isWorking = status === "uploading" || status === "processing";

  useEffect(() => () => {
    abortRef.current?.abort();
    if (portraitUrl) URL.revokeObjectURL(portraitUrl);
  }, [portraitUrl]);

  function chooseProduct(product: Product) {
    const category = categoryFor(product);
    setSelected((current) => current[category]?.id === product.id
      ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== category)) as SelectedGarments
      : { ...current, [category]: product });
    setResultUrl("");
    setError("");
    setStatus("idle");
  }

  function chooseCategory(category: GarmentCategory) {
    if (isWorking) return;
    setActiveCategory(category);
  }

  function choosePortrait(file: File | undefined) {
    if (!file) return;
    if (!(["image/jpeg", "image/png"] as string[]).includes(file.type) || file.size > 10 * 1024 * 1024) {
      setError(file.size > 10 * 1024 * 1024 ? errorMessages.INVALID_FILE_SIZE : errorMessages.INVALID_FILE_TYPE);
      setStatus("error");
      return;
    }
    abortRef.current?.abort();
    if (portraitUrl) URL.revokeObjectURL(portraitUrl);
    setPortraitFile(file);
    setPortraitUrl(URL.createObjectURL(file));
    setResultUrl("");
    setError("");
    setStatus("idle");
  }

  async function generate() {
    if (!portraitFile || !selectedProducts.length || isWorking) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setResultUrl("");
    setProcessingStep(0);
    setStatus("uploading");

    try {
      const referenceResponses = await Promise.all(
        selectedProducts.map((product) => fetch(product.images[0], { signal: controller.signal })),
      );
      if (referenceResponses.some((response) => !response.ok)) throw new Error("REFERENCE_IMAGE_FAILED");
      const referenceBlobs = await Promise.all(referenceResponses.map((response) => response.blob()));
      const sourceType = contentTypeFor(portraitFile);
      const uploadFiles = [portraitFile, ...referenceBlobs];
      const prepared = await api<{ files: PreparedFile[] }>("/store/kolbe/try-on/files", {
        method: "POST",
        signal: controller.signal,
        body: {
          files: [
            { fileName: `customer.${extensionFor(sourceType)}`, fileSize: portraitFile.size, contentType: sourceType },
            ...selectedProducts.map((product, index) => {
              const blob = referenceBlobs[index];
              const contentType = contentTypeFor(blob);
              return { fileName: `${product.id}.${extensionFor(contentType)}`, fileSize: blob.size, contentType };
            }),
          ],
        },
      });
      if (prepared.files.length !== uploadFiles.length) throw new Error("INVALID_UPLOAD_RESPONSE");
      await Promise.all(prepared.files.map((file, index) => uploadToSignedUrl(file, uploadFiles[index], controller.signal)));

      setStatus("processing");
      let chainedResultUrl = "";
      for (let index = 0; index < selectedProducts.length; index += 1) {
        const product = selectedProducts[index];
        setProcessingStep(index + 1);
        const task = await api<{ taskId: string }>("/store/kolbe/try-on/tasks", {
          method: "POST",
          signal: controller.signal,
          body: {
            ...(index === 0 ? { srcFileId: prepared.files[0].fileId } : { srcFileUrl: chainedResultUrl }),
            refFileId: prepared.files[index + 1].fileId,
            garmentCategory: categoryFor(product),
          },
        });
        chainedResultUrl = await pollTask(task.taskId, controller.signal);
      }
      setResultUrl(chainedResultUrl);
      setStatus("success");
    } catch (caught) {
      const nextMessage = messageFor(caught);
      if (!nextMessage) return;
      setError(nextMessage);
      setStatus("error");
    }
  }

  async function downloadResult() {
    if (!resultUrl || isDownloading) return;
    setIsDownloading(true);
    setError("");
    try {
      const response = await fetch("/store/kolbe/try-on/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: resultUrl }),
      });
      if (!response.ok) throw new Error("DOWNLOAD_FAILED");
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `kolbe-virtual-try-on-${Date.now()}.jpg`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError("دانلود تصویر انجام نشد. دوباره تلاش کنید.");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <main className="tryon-page px-3 pb-8 pt-5 sm:px-5 lg:px-8 lg:pt-8">
      <section className="tryon-intro mx-auto grid max-w-[1240px] gap-5 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="tryon-copy liquid-panel flex flex-col justify-between p-6 sm:p-8">
          <div>
            <span className="ai-chip inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] tracking-[0.12em]">
              <Icon name="star" className="h-3.5 w-3.5" /> POWERED BY PERFECT CORP
            </span>
            <h1 className="mt-5 text-[30px] font-medium leading-[1.45] sm:text-[40px]">لباس را قبل از خرید روی خودت ببین</h1>
            <p className="mt-3 max-w-xl text-[13px] leading-[2] text-neutral-500">
              یک عکس روبه‌رو اضافه کن و بالاتنه، شلوار یا هر دو را برای ساخت استایل کامل انتخاب کن.
            </p>
          </div>
          <div className="mt-7 grid grid-cols-3 gap-2 text-center text-[10.5px]">
            {["انتخاب لباس", "آپلود تصویر", "دریافت نتیجه"].map((item, index) => (
              <div key={item} className="tryon-step rounded-2xl px-2 py-3"><span className="mb-1 block text-[15px]">{index + 1}</span>{item}</div>
            ))}
          </div>
          <p className="mt-4 text-[10px] leading-5 text-neutral-400">تصاویر فقط برای ساخت نتیجه به سرویس Perfect Corp ارسال می‌شوند. عکس واضح، تک‌نفره و روبه‌رو بهترین نتیجه را می‌دهد.</p>
        </div>

        <div className="tryon-preview liquid-panel min-h-[460px] p-3 sm:p-4" aria-live="polite">
          <div className="tryon-preview-canvas relative flex min-h-[430px] items-center justify-center overflow-hidden rounded-[1.5rem]">
            {resultUrl || portraitUrl ? (
              <img src={resultUrl || portraitUrl} alt={resultUrl ? "نتیجه پرو مجازی لباس" : "تصویر انتخاب‌شده برای پرو مجازی"} className="absolute inset-0 h-full w-full object-contain" />
            ) : (
              <div className="max-w-xs px-6 text-center">
                <Icon name="user" className="mx-auto h-14 w-14 opacity-35" />
                <p className="mt-3 text-[12px] leading-6 text-neutral-500">یک تصویر واضح با صورت و بدن روبه‌دوربین انتخاب کن</p>
              </div>
            )}

            {portraitUrl ? (
              <div className="tryon-selected-item absolute bottom-3 left-3 right-3 flex items-center gap-2 rounded-2xl p-2.5 sm:left-auto sm:w-72">
                <div className="flex -space-x-2 space-x-reverse">
                  {selectedProducts.map((product) => <img key={product.id} src={product.images[0]} alt="" className="h-12 w-10 rounded-xl border border-white/70 object-cover" />)}
                </div>
                <span className="min-w-0 text-[11px]"><b className="block truncate font-medium">{selectedProducts.map((product) => product.name).join(" + ") || "هنوز لباسی انتخاب نشده"}</b><span className="mt-1 block opacity-60">{resultUrl ? "نتیجه آماده است" : `${selectedProducts.length} انتخاب`}</span></span>
              </div>
            ) : null}

            {isWorking ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#102b3d]/70 px-6 text-center text-white backdrop-blur-sm">
                <span className="h-9 w-9 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <b className="mt-4 text-[13px] font-medium">{status === "uploading" ? "در حال آماده‌سازی تصاویر…" : `در حال ساخت مرحله ${processingStep} از ${selectedProducts.length}…`}</b>
                <span className="mt-2 text-[10.5px] text-white/70">برای هر لباس یک مرحلهٔ جدا پردازش می‌شود.</span>
              </div>
            ) : null}

            {status === "success" ? <div className="tryon-ready absolute right-4 top-4 rounded-full px-4 py-2 text-[11px]">نتیجه آماده است</div> : null}
          </div>
        </div>
      </section>

      <section className="tryon-builder liquid-panel mx-auto mt-5 max-w-[1240px] p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 className="text-[19px] font-medium">استایل موردنظرت را انتخاب کن</h2><p className="mt-1 text-[11.5px] text-neutral-500">از هر دسته حداکثر یک مورد؛ برای حذف، روی انتخاب فعال دوباره بزن.</p></div>
          <label className="storefront-secondary-action flex min-h-11 cursor-pointer items-center justify-center rounded-full px-5 text-[12px] focus-within:ring-2 focus-within:ring-[#4b788d]">
            {portraitFile ? "تغییر تصویر من" : "آپلود تصویر من"}
            <input type="file" accept="image/jpeg,image/png" className="sr-only" disabled={isWorking} onChange={(event) => choosePortrait(event.target.files?.[0])} />
          </label>
        </div>

        <div className="mt-5 flex gap-2 border-b border-neutral-200 pb-3" role="tablist" aria-label="دسته‌بندی لباس">
          {garmentGroups.map((group) => (
            <button key={group.key} type="button" role="tab" aria-selected={activeCategory === group.key} disabled={isWorking} onClick={() => chooseCategory(group.key)} className={`rounded-full px-4 py-2 text-[11.5px] transition disabled:cursor-not-allowed disabled:opacity-50 ${activeCategory === group.key ? "bg-[#244e62] text-white" : "bg-black/5 text-neutral-600 hover:bg-black/10"}`}>
              {group.title}
            </button>
          ))}
          <span className="mr-auto hidden self-center text-[10.5px] text-neutral-400 sm:block">{garmentGroups.find((group) => group.key === activeCategory)?.hint}</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {visibleProducts.map((product) => (
            <button key={product.id} type="button" disabled={isWorking} onClick={() => chooseProduct(product)} aria-pressed={selected[activeCategory]?.id === product.id} className={`tryon-option flex items-center gap-2 rounded-2xl p-2 text-right transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4b788d] disabled:cursor-not-allowed disabled:opacity-50 ${selected[activeCategory]?.id === product.id ? "is-selected" : ""}`}>
              <img src={product.images[0]} alt="" className="h-16 w-12 shrink-0 rounded-xl object-cover" />
              <span className="min-w-0 text-[11px]"><b className="block truncate font-medium">{product.name}</b><span className="mt-1 block truncate text-neutral-400">{product.categoryLabel}</span></span>
            </button>
          ))}
        </div>

        {error ? (
          <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[11.5px] leading-6 text-red-800">{error}</div>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 border-t border-neutral-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10.5px] leading-6 text-neutral-500">{selectedProducts.length ? `${selectedProducts.length} لباس انتخاب شده؛ حدود ${selectedProducts.length * 2} واحد API مصرف می‌شود.` : "حداقل یک لباس انتخاب کن."}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {resultUrl ? <button type="button" onClick={downloadResult} disabled={isDownloading} className="storefront-secondary-action flex min-h-12 items-center justify-center rounded-full px-6 text-[12px] disabled:opacity-50">{isDownloading ? "در حال دانلود…" : "دانلود تصویر"}</button> : null}
            <button type="button" onClick={generate} disabled={!portraitFile || !selectedProducts.length || isWorking} className="ai-tryon-button flex min-h-12 items-center justify-center gap-2 rounded-full px-7 text-[12.5px] font-medium disabled:cursor-not-allowed disabled:opacity-45">
              <Icon name="star" className="h-4 w-4" /> {isWorking ? "در حال ساخت…" : resultUrl ? "ساخت دوباره" : "ساخت پرو هوشمند"}
            </button>
          </div>
        </div>
      </section>

      <div className="mx-auto mt-4 max-w-[1240px] text-center"><Link to="/shop" className="text-[11.5px] underline underline-offset-4">بازگشت به فروشگاه</Link></div>
    </main>
  );
}
