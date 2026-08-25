export type Product = {
  id: string
  name: string
  sku: string
  image: string
  category: string
  series: number
  stock: number
  price: string
  status: 'فعال' | 'نیازمند اصلاح' | 'در بررسی' | 'پیش‌نویس'
  updated: string
}

export const products: Product[] = [
  { id: 'PR-1048', name: 'پیراهن آکسفورد یقه‌دار', sku: 'KH-OXF-241', image: 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=180&q=80', category: 'پیراهن مردانه', series: 18, stock: 144, price: '۱٬۸۹۰٬۰۰۰', status: 'فعال', updated: '۱۲ دقیقه پیش' },
  { id: 'PR-1039', name: 'شلوار راسته لینن', sku: 'KH-LIN-087', image: 'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=180&q=80', category: 'شلوار زنانه', series: 9, stock: 72, price: '۲٬۲۵۰٬۰۰۰', status: 'فعال', updated: '۲ ساعت پیش' },
  { id: 'PR-1036', name: 'کت کتان دو دکمه', sku: 'KH-BLA-156', image: 'https://images.unsplash.com/photo-1598032895397-b9472444bf93?auto=format&fit=crop&w=180&q=80', category: 'کت مردانه', series: 0, stock: 6, price: '۴٬۷۵۰٬۰۰۰', status: 'نیازمند اصلاح', updated: 'دیروز' },
  { id: 'PR-1031', name: 'لوفر چرم بنددار', sku: 'KH-LOF-402', image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=180&q=80', category: 'کفش مردانه', series: 11, stock: 84, price: '۳٬۶۰۰٬۰۰۰', status: 'در بررسی', updated: 'دیروز' },
  { id: 'PR-1026', name: 'وست پشمی چهارخانه', sku: 'KH-VST-041', image: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=180&q=80', category: 'وست زنانه', series: 0, stock: 0, price: '۱٬۹۵۰٬۰۰۰', status: 'پیش‌نویس', updated: '۱۴ مرداد' },
]

export const orderRows = [
  { id: 'KV-82941', customer: 'بوتیک آرشیو — تهران', product: 'پیراهن آکسفورد یقه‌دار', pack: 'پرفروش · مشکی', quantity: '۵ سری', pieces: '۳۰ تکه', value: '۹٬۴۵۰٬۰۰۰ تومان', date: 'امروز، ۰۹:۴۰', due: 'فردا', status: 'نیازمند تأیید' },
  { id: 'KV-82938', customer: 'VINTAGE ROOM', product: 'شلوار راسته لینن', pack: 'فول‌سری · کرم', quantity: '۳ سری', pieces: '۲۴ تکه', value: '۶٬۷۵۰٬۰۰۰ تومان', date: 'امروز، ۰۸:۱۵', due: '۲۷ مرداد', status: 'جدید' },
  { id: 'KV-82931', customer: 'خانه مد وینتج', product: 'لوفر چرم بنددار', pack: 'فول‌سری · عسلی', quantity: '۲ سری', pieces: '۱۴ تکه', value: '۷٬۲۰۰٬۰۰۰ تومان', date: 'دیروز', due: '۲۶ مرداد', status: 'در حال آماده‌سازی' },
  { id: 'KV-82917', customer: 'بوتیک برگ', product: 'پیراهن آکسفورد یقه‌دار', pack: 'نیم‌سری · سفید', quantity: '۴ سری', pieces: '۱۶ تکه', value: '۷٬۵۶۰٬۰۰۰ تومان', date: 'دیروز', due: '۲۵ مرداد', status: 'آماده ارسال' },
]

export const rfqs = [
  { id: 'RFQ-2048', title: 'پیراهن آکسفورد اختصاصی', customer: 'گروه هتل‌های هلیا', quantity: '۶۰۰ تکه', deadline: '۲۲ شهریور', fabric: 'Oxford Cotton 150gr', status: 'نیازمند قیمت‌گذاری', avatar: 'ه' },
  { id: 'RFQ-2044', title: 'بارانی کوتاه برند اختصاصی', customer: 'بوتیک آلما', quantity: '۳۵۰ تکه', deadline: '۱۰ مهر', fabric: 'Water-repellent Twill', status: 'نیازمند پاسخ', avatar: 'آ' },
  { id: 'RFQ-2039', title: 'تی‌شرت پنبه‌ای با گلدوزی', customer: 'MARNI STUDIO', quantity: '۱٬۲۰۰ تکه', deadline: '۲۸ مهر', fabric: 'Combed Cotton 180gr', status: 'پیشنهاد ارسال شد', avatar: 'م' },
]

export const milestones = [
  { title: 'تأیید سفارش', date: '۱۲ مرداد', state: 'done' },
  { title: 'تأمین پارچه', date: '۱۵ مرداد', state: 'done' },
  { title: 'دریافت پارچه', date: '۱۹ مرداد', state: 'done' },
  { title: 'تولید نمونه', date: '۲۳ مرداد', state: 'current' },
  { title: 'تأیید نمونه', date: '—', state: 'future' },
  { title: 'برش و دوخت', date: '—', state: 'future' },
  { title: 'کنترل کیفیت', date: '—', state: 'future' },
  { title: 'آماده ارسال', date: '—', state: 'future' },
]
