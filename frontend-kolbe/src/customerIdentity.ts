export type CustomerIdentity = {
  id: string;
  name: string;
  phone: string;
  email?: string;
};

const CUSTOMER_KEY = "kv_customer_identity";

export function loadCustomer(): CustomerIdentity | null {
  try {
    const raw = localStorage.getItem(CUSTOMER_KEY);
    return raw ? JSON.parse(raw) as CustomerIdentity : null;
  } catch {
    return null;
  }
}

export function saveCustomer(customer: CustomerIdentity) {
  localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
}

export function clearCustomer() {
  localStorage.removeItem(CUSTOMER_KEY);
}

export function createCustomer(name: string, phone: string, email = ""): CustomerIdentity {
  return { id: `KVC-${phone.replace(/\D/g, "").slice(-10)}`, name: name.trim(), phone: phone.trim(), email: email.trim() || undefined };
}
