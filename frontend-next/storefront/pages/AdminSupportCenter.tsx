import { useEffect, useRef, useState } from "react";

type MessageAttachment = { id: string; type: "image" | "file"; name: string; url: string; size: number };
type SupportMessage = { id: string; author: "customer" | "agent"; text: string; at: string; attachments?: MessageAttachment[] };
type Conversation = { id: string; customer: string; subject: string; channel: "chat" | "sms" | "instagram"; priority: "عادی" | "فوری"; status: "باز" | "منتظر مشتری" | "بسته"; unread: number; messages: SupportMessage[] };

const STORAGE_KEY = "kv_support_conversations_v1";
const WS_KEY = "kv_support_websocket_url";
const initial: Conversation[] = [
  { id: "SUP-1842", customer: "امیرحسین رضایی", subject: "پیگیری زمان ارسال سفارش", channel: "chat", priority: "فوری", status: "باز", unread: 2, messages: [{ id: "m1", author: "customer", text: "سلام، سفارش من امروز تحویل پست می‌شود؟", at: "۱۰:۳۲" }, { id: "m2", author: "customer", text: "کد سفارش KV-482910 است.", at: "۱۰:۳۳" }] },
  { id: "SUP-1839", customer: "سارا احمدی", subject: "راهنمای انتخاب سایز", channel: "instagram", priority: "عادی", status: "منتظر مشتری", unread: 0, messages: [{ id: "m3", author: "agent", text: "لطفاً اندازه دور سینه را ارسال کنید تا دقیق بررسی کنیم.", at: "۰۹:۴۵" }] },
  { id: "SUP-1835", customer: "نیما صادقی", subject: "تغییر نشانی تحویل", channel: "sms", priority: "عادی", status: "بسته", unread: 0, messages: [{ id: "m4", author: "agent", text: "نشانی سفارش با موفقیت اصلاح شد.", at: "دیروز" }] },
];

function readConversations() { try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) as Conversation[] : initial; } catch { return initial; } }
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a] focus-visible:ring-offset-2";

export default function AdminSupportCenter() {
  const [items, setItems] = useState<Conversation[]>(readConversations);
  const [selectedId, setSelectedId] = useState(items[0]?.id || "");
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [socketUrl, setSocketUrl] = useState(() => localStorage.getItem(WS_KEY) || "");
  const [socketState, setSocketState] = useState<"local" | "connecting" | "live" | "error">("local");
  const socketRef = useRef<WebSocket | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const selected = items.find((item) => item.id === selectedId) || items[0];
  const visible = filter === "all" ? items : items.filter((item) => item.status !== "بسته");

  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel("kolbe-support-live");
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<Conversation[]>) => setItems(event.data);
    return () => channel.close();
  }, []);

  useEffect(() => {
    socketRef.current?.close();
    socketRef.current = null;
    if (!socketUrl.trim()) { setSocketState("local"); return; }
    setSocketState("connecting");
    let socket: WebSocket;
    try { socket = new WebSocket(socketUrl); } catch { setSocketState("error"); return; }
    socketRef.current = socket;
    socket.onopen = () => setSocketState("live");
    socket.onerror = () => setSocketState("error");
    socket.onclose = () => setSocketState((current) => current === "error" ? current : "local");
    socket.onmessage = (event) => {
      try { const payload = JSON.parse(String(event.data)) as { conversationId: string; message: SupportMessage }; setItems((current) => current.map((conversation) => conversation.id === payload.conversationId ? { ...conversation, unread: conversation.unread + 1, messages: [...conversation.messages, payload.message] } : conversation)); } catch { /* ignore malformed provider payloads */ }
    };
    return () => socket.close();
  }, [socketUrl]);

  const persist = (next: Conversation[]) => { setItems(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); channelRef.current?.postMessage(next); };
  const send = () => {
    const text = draft.trim(); if ((!text && !attachments.length) || !selected) return;
    const message: SupportMessage = { id: `msg-${Date.now()}`, author: "agent", text, attachments, at: new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" }).format(new Date()) };
    const next = items.map((conversation) => conversation.id === selected.id ? { ...conversation, unread: 0, status: "منتظر مشتری" as const, messages: [...conversation.messages, message] } : conversation);
    persist(next); setDraft(""); setAttachments([]);
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "support_message", conversationId: selected.id, message }));
  };
  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setUploadError("");
    [...files].forEach((file) => {
      if (file.size > 3_000_000) { setUploadError("هر فایل باید کمتر از ۳ مگابایت باشد."); return; }
      const reader = new FileReader();
      reader.onload = () => setAttachments((current) => [...current, { id: crypto.randomUUID(), type: file.type.startsWith("image/") ? "image" : "file", name: file.name, url: String(reader.result), size: file.size }]);
      reader.onerror = () => setUploadError("خواندن فایل ناموفق بود.");
      reader.readAsDataURL(file);
    });
  };
  const updateStatus = (status: Conversation["status"]) => selected && persist(items.map((conversation) => conversation.id === selected.id ? { ...conversation, status, unread: 0 } : conversation));
  const saveSocket = () => { localStorage.setItem(WS_KEY, socketUrl.trim()); setSocketUrl(socketUrl.trim()); };
  const stateLabel = socketState === "live" ? "WebSocket متصل" : socketState === "connecting" ? "در حال اتصال" : socketState === "error" ? "خطای اتصال؛ کانال محلی فعال است" : "کانال زنده محلی";

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[9px] tracking-[.22em] text-neutral-400">CUSTOMER CARE INBOX</p><h1 className="mt-2 text-[19px] font-semibold">پشتیبانی و گفت‌وگوی زنده</h1><p className="mt-1 text-[10px] leading-5 text-neutral-500">چت، پیامک و شبکه اجتماعی در یک صندوق؛ آماده اتصال به سرویس WebSocket.</p></div><div className="flex items-center gap-2 border border-neutral-200 bg-white px-3 py-2 text-[9.5px]"><span className={`h-2 w-2 rounded-full ${socketState === "live" ? "bg-emerald-600" : socketState === "error" ? "bg-red-600" : "bg-amber-500"}`} /><span>{stateLabel}</span></div></header>
    <details className="border border-neutral-200 bg-white p-4"><summary className={`cursor-pointer text-[10.5px] font-medium ${focus}`}>تنظیم درگاه WebSocket</summary><div className="mt-4 flex flex-col gap-2 sm:flex-row"><input aria-label="نشانی WebSocket پشتیبانی" dir="ltr" value={socketUrl} onChange={(event) => setSocketUrl(event.target.value)} placeholder="wss://support.example.com/socket" className={`h-10 min-w-0 flex-1 border border-neutral-300 px-3 text-[10.5px] ${focus}`} /><button onClick={saveSocket} className={`h-10 bg-[#011c3a] px-4 text-[10px] text-white ${focus}`}>ذخیره و اتصال</button></div><p className="mt-2 text-[9px] leading-5 text-neutral-400">بدون آدرس، تب‌های باز مرورگر با BroadcastChannel هم‌زمان می‌شوند. برای اپراتورهای چنددستگاهی آدرس امن wss سرویس پشتیبانی را وارد کنید.</p></details>
    <div className="grid min-h-[620px] overflow-hidden rounded-xl border border-neutral-200 bg-white lg:grid-cols-[330px_1fr]">
      <aside className="border-b border-neutral-200 lg:border-b-0 lg:border-l"><div className="flex items-center justify-between border-b p-3"><div className="flex gap-1">{([['open','باز'],['all','همه']] as const).map(([id,label]) => <button key={id} onClick={() => setFilter(id)} className={`h-8 px-3 text-[9.5px] ${filter === id ? "bg-[#011c3a] text-white" : "border border-neutral-300"}`}>{label}</button>)}</div><span className="text-[9px] text-neutral-400">{visible.length.toLocaleString('fa-IR')} گفتگو</span></div><div className="max-h-[330px] divide-y overflow-y-auto lg:max-h-[560px]">{visible.map((conversation) => <button key={conversation.id} onClick={() => { setSelectedId(conversation.id); if (conversation.unread) persist(items.map((item) => item.id === conversation.id ? { ...item, unread: 0 } : item)); }} className={`block w-full p-4 text-right transition hover:bg-neutral-50 ${focus} ${selected?.id === conversation.id ? "bg-[#f4f5f6]" : ""}`}><div className="flex items-start justify-between gap-2"><strong className="truncate text-[11px] font-medium">{conversation.customer}</strong>{conversation.unread ? <span className="grid h-5 min-w-5 place-items-center bg-[#011c3a] px-1 text-[8px] text-white">{conversation.unread.toLocaleString('fa-IR')}</span> : null}</div><p className="mt-1 truncate text-[9.5px] text-neutral-600">{conversation.subject}</p><p className="mt-2 text-[8.5px] text-neutral-400">{conversation.channel.toUpperCase()} · {conversation.status} {conversation.priority === "فوری" ? "· فوری" : ""}</p></button>)}</div>
      </aside>
      {selected ? <section className="flex min-w-0 flex-col"><header className="flex flex-wrap items-start justify-between gap-3 border-b bg-white/90 p-4 backdrop-blur"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-[11px] bg-[#e8e8ed] text-[11px] font-semibold">{selected.customer.slice(0,1)}</span><div><h2 className="text-[12px] font-medium">{selected.customer}</h2><p className="mt-1 text-[9px] text-neutral-400">{selected.id} · {selected.subject}</p></div></div><select aria-label="وضعیت گفتگو" value={selected.status} onChange={(event) => updateStatus(event.target.value as Conversation["status"])} className={`h-9 rounded-lg border border-neutral-300 bg-white px-2 text-[9.5px] ${focus}`}><option>باز</option><option>منتظر مشتری</option><option>بسته</option></select></header><div className="flex-1 space-y-3 overflow-y-auto bg-[#f2f2f7] p-4 lg:p-6">{selected.messages.map((message) => <div key={message.id} className={`max-w-[82%] rounded-[18px] px-3.5 py-2.5 text-[10.5px] leading-6 ${message.author === "agent" ? "mr-auto rounded-bl-[6px] bg-[#0a84ff] text-white" : "ml-auto rounded-br-[6px] bg-white text-neutral-800"}`}>{message.attachments?.map((attachment) => attachment.type === "image" ? <a key={attachment.id} href={attachment.url} download={attachment.name} className="mb-2 block overflow-hidden rounded-[12px]"><img src={attachment.url} alt={attachment.name} className="max-h-56 w-full object-cover" /></a> : <a key={attachment.id} href={attachment.url} download={attachment.name} className="mb-2 flex items-center gap-2 rounded-xl bg-black/10 px-3 py-2 underline">{attachment.name}</a>)}{message.text && <p>{message.text}</p>}<time className={`mt-1 block text-[8px] ${message.author === "agent" ? "text-white/60" : "text-neutral-400"}`}>{message.at}{message.author === "agent" ? " · تحویل شد" : ""}</time></div>)}</div><footer className="border-t bg-white p-3"><div className="mb-2 flex gap-2 overflow-x-auto">{["در حال بررسی سفارش شما هستم.","کد رهگیری تا پایان امروز ارسال می‌شود.","لطفاً تصویر محصول را ارسال کنید."].map((reply) => <button key={reply} onClick={() => setDraft(reply)} className="shrink-0 rounded-full border border-neutral-300 px-2.5 py-1.5 text-[8.5px] hover:border-[#0a84ff]">{reply}</button>)}</div>{attachments.length > 0 && <div className="mb-2 flex gap-2 overflow-x-auto">{attachments.map((attachment) => <div key={attachment.id} className="relative h-16 min-w-16 overflow-hidden rounded-xl border bg-[#f2f2f7]">{attachment.type === "image" ? <img src={attachment.url} alt={attachment.name} className="h-full w-full object-cover" /> : <span className="grid h-full max-w-28 place-items-center px-2 text-[8px]">{attachment.name}</span>}<button type="button" aria-label={`حذف ${attachment.name}`} onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/65 text-[9px] text-white">×</button></div>)}</div>}{uploadError && <p role="alert" className="mb-2 text-[9px] text-red-700">{uploadError}</p>}<div className="flex items-end gap-2"><label className={`grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full bg-[#e8e8ed] text-lg transition hover:bg-[#d8d8dd] ${focus}`} aria-label="افزودن تصویر یا فایل">＋<input type="file" className="sr-only" accept="image/*,.pdf,.doc,.docx" multiple onChange={(event) => addFiles(event.target.files)} /></label><textarea aria-label="متن پاسخ" rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} className={`min-w-0 flex-1 resize-none rounded-[18px] border border-neutral-300 bg-[#f7f7fa] px-4 py-3 text-[10.5px] ${focus}`} placeholder="پیام…" /><button disabled={!draft.trim() && !attachments.length} onClick={send} className={`h-10 w-20 rounded-full bg-[#0a84ff] text-[10px] text-white disabled:bg-neutral-300 ${focus}`}>ارسال</button></div></footer></section> : <div className="grid place-items-center text-[10px] text-neutral-400">گفتگویی انتخاب نشده است.</div>}
    </div>
  </div>;
}
