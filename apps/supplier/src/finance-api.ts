import { supabase } from './supabase'

export type SupplierWalletEntry = {
  id: string
  entry_type: 'sale' | 'commission' | 'refund' | 'commission_reversal' | 'adjustment' | 'payout'
  direction: 'credit' | 'debit'
  amount: number
  available_at: string | null
  created_at: string
  description: string | null
  order_code: string | null
}

export type SupplierWithdrawal = {
  id: string
  amount: number
  status: 'requested' | 'processing' | 'paid' | 'failed' | 'rejected' | 'cancelled'
  bank_reference: string | null
  failure_reason: string | null
  requested_at: string
  processed_at: string | null
  paid_at: string | null
}

export type SupplierPayoutAccount = {
  id: string
  sheba: string
  account_holder: string
  bank_name: string | null
  status: 'pending' | 'verified' | 'rejected'
  is_default: boolean
}

export type SupplierWallet = {
  supplier_id: string
  ledger_available_balance: number
  pending_balance: number
  reserved_for_withdrawal: number
  withdrawable_balance: number
  terms_configured: boolean
  commission_bps: number
  settlement_hold_days: number
  min_withdrawal_amount: number
  payouts_enabled: boolean
  payout_accounts: SupplierPayoutAccount[]
  recent_entries: SupplierWalletEntry[]
  recent_withdrawals: SupplierWithdrawal[]
}

function requireClient() {
  if (!supabase) throw new Error('اتصال Supabase تنظیم نشده است.')
  return supabase
}

function financeError(message: string) {
  if (message.includes('SUPPLIER_FINANCE_TERMS_REQUIRED')) return 'شرایط مالی همکاری هنوز توسط کلبه تنظیم نشده است.'
  if (message.includes('PAYOUTS_DISABLED')) return 'برداشت وجه برای حساب شما هنوز فعال نشده است.'
  if (message.includes('VERIFIED_PAYOUT_ACCOUNT_REQUIRED')) return 'برای برداشت وجه باید ابتدا یک شماره شبای تأییدشده داشته باشید.'
  if (message.includes('BELOW_MIN_WITHDRAWAL')) return 'مبلغ برداشت از حداقل مبلغ مجاز کمتر است.'
  if (message.includes('INSUFFICIENT_WITHDRAWABLE_BALANCE')) return 'موجودی قابل برداشت برای این درخواست کافی نیست.'
  if (message.includes('INVALID_WITHDRAWAL_AMOUNT')) return 'مبلغ برداشت معتبر نیست.'
  if (message.includes('INVALID_SHEBA')) return 'شماره شبا معتبر نیست.'
  if (message.includes('ACCOUNT_HOLDER_REQUIRED')) return 'نام صاحب حساب الزامی است.'
  return 'عملیات مالی انجام نشد. دوباره تلاش کنید.'
}

export async function loadSupplierWallet(): Promise<SupplierWallet> {
  const client = requireClient()
  const { data, error } = await client.rpc('get_my_supplier_wallet')
  if (error) throw new Error(financeError(error.message))
  return data as SupplierWallet
}

export async function addSupplierPayoutAccount(input: {
  sheba: string
  accountHolder: string
  bankName?: string
  makeDefault?: boolean
}) {
  const client = requireClient()
  const { data, error } = await client.rpc('add_my_supplier_payout_account', {
    p_sheba: input.sheba.trim(),
    p_account_holder: input.accountHolder.trim(),
    p_bank_name: input.bankName?.trim() || null,
    p_make_default: input.makeDefault ?? true,
  })
  if (error) throw new Error(financeError(error.message))
  return data as string
}

export async function requestSupplierWithdrawal(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('مبلغ برداشت معتبر نیست.')
  const client = requireClient()
  const { data, error } = await client.rpc('request_supplier_withdrawal', { p_amount: amount })
  if (error) throw new Error(financeError(error.message))
  return data as string
}
