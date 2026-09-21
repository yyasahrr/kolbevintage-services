/**
 * Iranian mobile normalization, SMS part calculation, and email header sanitization.
 */

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

/**
 * Convert Persian and Arabic digits to ASCII standard digits.
 */
export function convertEasternDigitsToAscii(input: string): string {
  let result = input;
  for (let i = 0; i < 10; i++) {
    result = result.replaceAll(PERSIAN_DIGITS[i], String(i));
    result = result.replaceAll(ARABIC_DIGITS[i], String(i));
  }
  return result;
}

/**
 * Normalizes an Iranian mobile phone number into the standard format `09XXXXXXXXX`.
 * Handles prefixes: +98, 0098, 98, or 9XXXXXXXXX.
 */
export function normalizeIranianMobile(phone: string): {
  valid: boolean;
  normalized?: string;
  error?: string;
} {
  if (!phone || typeof phone !== "string") {
    return { valid: false, error: "شماره تلفن وارد نشده است." };
  }

  // Convert eastern numerals and strip non-digit characters (except leading +)
  let cleaned = convertEasternDigitsToAscii(phone.trim());
  const hadPlus = cleaned.startsWith("+");
  cleaned = cleaned.replace(/\D/g, "");

  if (hadPlus && cleaned.startsWith("98")) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith("0098")) {
    cleaned = cleaned.slice(4);
  } else if (cleaned.startsWith("98") && cleaned.length === 12) {
    cleaned = cleaned.slice(2);
  }

  if (cleaned.startsWith("0")) {
    cleaned = cleaned.slice(1);
  }

  // At this point, Iranian mobile numbers should be 10 digits starting with 9 (e.g. 9123456789)
  if (cleaned.length !== 10 || !cleaned.startsWith("9")) {
    return {
      valid: false,
      error: `شماره تلفن همراه ایران نامعتبر است: '${phone}' (باید با 09 شروع شده و ۱۱ رقم باشد)`,
    };
  }

  const normalized = `0${cleaned}`;
  return { valid: true, normalized };
}

/**
 * Calculates SMS character length and multi-part segment count according to GSM-7 and Persian UCS-2 standards.
 */
export function calculateSmsParts(body: string): {
  length: number;
  isPersian: boolean;
  parts: number;
} {
  const isPersian = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(body);
  const length = body.length;

  let parts = 1;
  if (isPersian) {
    // UCS-2: 70 chars for single part; 67 chars per part for multi-part (due to UDH header)
    if (length > 70) {
      parts = Math.ceil(length / 67);
    }
  } else {
    // GSM-7: 160 chars for single part; 153 chars per part for multi-part
    if (length > 160) {
      parts = Math.ceil(length / 153);
    }
  }

  return { length, isPersian, parts: Math.max(parts, 1) };
}

/**
 * Sanitize email headers (subject, to, from) against CRLF header injection.
 */
export function sanitizeEmailHeader(header: string): string {
  if (!header) return "";
  return header
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Validates email address format and rejects CRLF or invalid structure.
 */
export function validateEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  if (email.includes("\r") || email.includes("\n")) return false;
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email.trim());
}
