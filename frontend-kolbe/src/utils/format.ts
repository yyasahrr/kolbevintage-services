const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

/** تبدیل ارقام لاتین به فارسی */
export function fa(input: string | number): string {
  return String(input).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

/** قیمت تومانی با جداکننده هزارگان و ارقام فارسی */
export function toman(value: number): string {
  return fa(value.toLocaleString("en-US")) + " تومان";
}
