export type SupportTicket = {
  id: string;
  customerId: string;
  subject: string;
  category: string;
  message: string;
  status: "باز" | "پاسخ داده شده" | "بسته";
  priority: "عادی" | "فوری";
  createdAt: string;
};

const KEY = "kv_wholesale_tickets";

export function loadTickets(): SupportTicket[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as SupportTicket[]; } catch { return []; }
}

export function saveTickets(tickets: SupportTicket[]) {
  localStorage.setItem(KEY, JSON.stringify(tickets));
}
