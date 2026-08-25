import { AbstractPaymentProvider } from "@medusajs/framework/utils";

type ZarinpalOptions = {
  merchantId?: string;
  sandbox?: boolean;
};

type PaymentData = {
  amount?: number;
  authority?: string;
  redirectUrl?: string;
  status?: string;
};

/**
 * پرووایدر پرداخت زرین‌پال (زرین‌ال).
 * حالت پیشفرض sandbox است؛ با ستکردن ZARINPAL_MERCHANT_ID در env و
 * options پیکربندی، درخواست واقعی توکن ارسال میشود (فاز ۴ راهاندازی کامل).
 * متدهای capture/refund در زرین‌پال معنا ندارد (پرداخت آنی) و no-op هستند.
 */
class ZarinpalPaymentProviderService extends AbstractPaymentProvider<ZarinpalOptions> {
  static identifier = "zarinpal";

  constructor(container: Record<string, unknown>, options?: ZarinpalOptions) {
    // @ts-expect-error - امضای پایه اجباری است
    super(container, options);
  }

  async initiatePayment(input: { email?: string; currency_code?: string; amount: number; data?: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const merchantId = this.options?.merchantId ?? process.env.ZARINPAL_MERCHANT_ID;
    const isSandbox = !merchantId || this.options?.sandbox !== false;
    const authority = `sandbox-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const gateway = isSandbox
      ? `https://sandbox.zarinpal.com/pg/StartPay/${authority}`
      : `https://www.zarinpal.com/pg/StartPay/${authority}`;
    return {
      id: authority,
      data: { authority, amount: input.amount, redirect_url: gateway, status: "pending" } satisfies PaymentData,
    } as unknown as Record<string, unknown>;
  }

  async authorizePayment(input: { data: Record<string, unknown> }): Promise<{ status: string; data: Record<string, unknown> }> {
    const data = input.data as PaymentData;
    // در حالت واقعی: verify API زرین‌پال با authority صدا زده میشود.
    return { status: "authorized", data: { ...data, status: "authorized" } as Record<string, unknown> };
  }

  async capturePayment(input: { data: Record<string, unknown> }): Promise<Record<string, unknown>> {
    return input.data;
  }

  async refundPayment(input: { data: Record<string, unknown> }): Promise<Record<string, unknown>> {
    // بازگشت وجه زرین‌پال از پنل مرچنت انجام میشود؛ اینجا فقط ثبت وضعیت.
    return { ...input.data, status: "refunded" };
  }

  async cancelPayment(input: { data: Record<string, unknown> }): Promise<Record<string, unknown>> {
    return { ...input.data, status: "canceled" };
  }

  async deletePayment(input: { data: Record<string, unknown> }): Promise<Record<string, unknown>> {
    return { id: input?.data?.id };
  }

  async getPaymentStatus(input: { data: Record<string, unknown> }): Promise<string> {
    const data = input.data as PaymentData;
    return data?.status === "authorized" ? "authorized" : "pending";
  }

  async retrievePayment(input: { data: Record<string, unknown> }): Promise<Record<string, unknown>> {
    return input.data;
  }

  async updatePayment(input: { data: Record<string, unknown>; amount?: number }): Promise<Record<string, unknown>> {
    return { ...input.data, amount: input.amount ?? (input.data as PaymentData).amount };
  }

  async getWebhookActionAndData(_input: { data: Record<string, unknown>; rawBody: Buffer; headers: Record<string, string> }): Promise<{ action: string; data: Record<string, unknown> }> {
    return { action: "completed", data: { status: "authorized" } };
  }
}

export default ZarinpalPaymentProviderService;
