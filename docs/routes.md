# نقشه کامل آدرس‌های وب‌سایت Kolbe Vintage

مسیریابی مبتنی بر hash است. آدرس پایه در حالت توسعه: `http://localhost:5173`

---

## ۱. فروشگاه — عمومی

| آدرس | صفحه | زبان |
|---|---|---|
| `/` یا `#/` | فروشگاه Kolbe Vintage (صفحه محصول The Heritage Polo) | English · LTR |

صفحه اول پیش‌فرض. شامل هدر، گالری، پنل محصول، چرخ رنگ، راهنمای سایز،
محصولات مرتبط، نظرات، بنر، بخش فروشگاه فیزیکی، خبرنامه و فوتر.

سه لینک در نوار بالای هدر: `Become a supplier` · `Supplier portal` · `Wholesale admin`

---

## ۲. تأمین‌کننده — عمومی و شریک

| آدرس | صفحه | زبان |
|---|---|---|
| `#/supplier-apply` | فرم درخواست همکاری + صفحه موفقیت با کد پیگیری | فارسی · RTL |
| `#/partner` | پورتال تأمین‌کننده (حساب پیش‌فرض) | فارسی · RTL |
| `#/partner?supplier=sup-3` | پورتال یک تأمین‌کننده مشخص | فارسی · RTL |

پورتال کاملاً مستقل است: بدون سایدبار ادمین، بدون فیلترهای سراسری و بدون هیچ
داده‌ای از مشتریان VIP.

---

## ۳. پنل عملیات — داخلی (`#/admin`)

### عملیات
| آدرس | صفحه |
|---|---|
| `#/admin` | داشبورد — KPI، هشدارها، قیف، نمودارها، جدول سفارش‌ها |
| `#/admin/orders` | سفارش‌های مشتریان VIP |
| `#/admin/fulfillment` | درخواست‌های تأمین و مرسولات |
| `#/admin/suppliers` | عملکرد تأمین‌کنندگان |
| `#/admin/applications` | صف بررسی درخواست‌های همکاری |
| `#/admin/vip-customers` | تحلیل مشتریان VIP |

### کاتالوگ و محصولات
| آدرس | صفحه |
|---|---|
| `#/admin/products` | مدیریت محصولات (افزودن/ویرایش/حذف) |
| `#/admin/catalogues` | مدیریت کاتالوگ‌ها (پیش‌نویس/انتشار/بایگانی) |
| `#/admin/catalogue-analytics` | تحلیل فروش کاتالوگ‌ها و محصولات |

### مالی
| آدرس | صفحه |
|---|---|
| `#/admin/escrow` | وجوه امانی و صف بازرسی ۷۲ ساعته |
| `#/admin/settlements` | تسویه تأمین‌کنندگان و کمیسیون |
| `#/admin/disputes` | اختلافات و وجوه مسدود |

### تحلیل و تنظیمات
| آدرس | صفحه |
|---|---|
| `#/admin/analytics` | تحلیل عمیق کسب‌وکار |
| `#/admin/reports` | ۵ گزارش قابل خروجی CSV |
| `#/admin/settings` | قواعد SLA، کمیسیون، پوسته، بازنشانی داده |

---

## پارامترهای URL (روی همه صفحات ادمین)

هر فیلتری که اعمال کنید در آدرس ذخیره می‌شود و قابل اشتراک‌گذاری است.

| پارامتر | مقادیر | مثال |
|---|---|---|
| `preset` | `today` `7d` `30d` `90d` `this_month` `last_month` `this_quarter` `custom` | `?preset=90d` |
| `from` / `to` | `YYYY-MM-DD` (فقط با `preset=custom`) | `?preset=custom&from=2026-05-01&to=2026-06-01` |
| `supplier` | شناسه تأمین‌کننده | `?supplier=sup-3` |
| `customer` | شناسه مشتری | `?customer=cus-7` |
| `order_status` | `created` `paid` `processing` `partially_fulfilled` `shipped` `delivered` `inspection` `completed` `disputed` `cancelled` | `?order_status=disputed` |
| `ff_status` | `requested` `accepted` `preparing` `ready_to_ship` `shipped` `delivered` `rejected` `cancelled` | `?ff_status=requested` |
| `settlement_status` | `pending` `scheduled` `processing` `paid` `failed` `partially_paid` | `?settlement_status=failed` |
| `catalogue` | شناسه کاتالوگ | `?catalogue=cat-2` |
| `category` | دسته محصول | `?category=denim` |
| `order` | شناسه سفارش — کشوی جزئیات را باز می‌کند | `?order=ord-12` |

### نمونه‌های کاربردی

```
#/admin/fulfillment?preset=30d&ff_status=requested     درخواست‌های بی‌پاسخ ۳۰ روز اخیر
#/admin/settlements?settlement_status=failed           تسویه‌های ناموفق
#/admin/disputes?preset=90d                            اختلافات سه ماه اخیر
#/admin/orders?preset=90d&supplier=sup-3               سفارش‌های یک تأمین‌کننده
#/admin/orders?order=ord-12&preset=90d                 باز کردن مستقیم یک سفارش
```

---

## میان‌برهای صفحه‌کلید

| کلید | عملکرد |
|---|---|
| `Ctrl/⌘ + K` | پالت فرمان — جستجوی صفحه، سفارش، تأمین‌کننده |
| `Esc` | بستن کشو، دیالوگ یا پالت |
