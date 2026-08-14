import { footerColumns } from "../data";

function Col({ title, items }: { title: string; items: any[] }) {
  return (
    <div className="mb-7 break-inside-avoid">
      <h4 className="mb-2 text-[12px] font-semibold">{title}</h4>
      <ul className="space-y-[5px]">
        {items.map((it, i) => {
          const label = typeof it === "string" ? it : it.label;
          const badge = typeof it === "string" ? null : it.badge;
          return (
            <li key={i}>
              <a href="#" className="text-[11.5px] text-white/75 hover:text-white hover:underline">
                {label}
                {badge && (
                  <span className="ml-1.5 rounded-[2px] bg-white/15 px-1.5 py-[1px] text-[9px] uppercase">
                    {badge}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const discover = [
  { title: "MR MARVIS", items: ["Stores", "Sustainability", "Blog", "Press", "Careers", "NPS"] },
  {
    title: "Support",
    items: [
      "Size Charts",
      "Care Guide",
      "Returns",
      "FAQ",
      "Shipment",
      "Track Your Order",
      "Orders",
      "Contact",
      "Recycle Your Clothes",
    ],
  },
];

export default function Footer() {
  const groups: any[][] = [
    footerColumns.slice(0, 2),
    footerColumns.slice(2, 4),
    footerColumns.slice(4, 6),
    footerColumns.slice(6, 9),
    footerColumns.slice(9, 11),
    footerColumns.slice(11, 13),
  ];

  return (
    <footer className="bg-[#011c3a] text-white">
      <div className="mx-auto max-w-[1400px] px-6 py-14">
        <h3 className="mb-8 text-[20px] font-medium">Shop by category</h3>
        <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3 lg:grid-cols-6">
          {groups.map((g, i) => (
            <div key={i}>
              {g.map((c) => (
                <Col key={c.title} title={c.title} items={c.items} />
              ))}
              {i === 5 && (
                <>
                  <div className="mb-7">
                    <h4 className="mb-2 text-[12px] font-semibold">Gift Card</h4>
                  </div>
                  <div className="mb-7">
                    <h4 className="mb-2 text-[12px] font-semibold">Guppyfriend Washing Bag</h4>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <hr className="my-10 border-white/15" />

        <h3 className="mb-8 text-[20px] font-medium">Discover further</h3>
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr_1.4fr]">
          {discover.map((d) => (
            <div key={d.title}>
              <h4 className="mb-2 text-[12px] font-semibold">{d.title}</h4>
              <ul className="space-y-[5px]">
                {d.items.map((i) => (
                  <li key={i}>
                    <a href="#" className="text-[11.5px] text-white/75 hover:text-white hover:underline">
                      {i}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="lg:justify-self-end lg:text-right">
            <button className="mb-5 inline-flex items-center gap-2 rounded border border-white/30 px-3 py-1.5 text-[11.5px]">
              🌐 English (EU, €) ▾
            </button>
            <div className="mb-5 flex gap-3 lg:justify-end">
              {["f", "◎", "▶", "♪", "in"].map((s, i) => (
                <a
                  key={i}
                  href="#"
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-white/30 text-[11px] hover:bg-white/10"
                >
                  {s}
                </a>
              ))}
            </div>
            <div className="mb-5 flex items-center gap-2 text-[11.5px] lg:justify-end">
              <span className="text-[#00b67a]">★★★★★</span> Excellent (4.315)
            </div>
            <div className="flex gap-3 lg:justify-end">
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/40 text-[10px]">
                GOTS
              </span>
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/40 text-[13px] font-bold">
                B
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-white/15">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-2 px-6 py-4 text-[10.5px] text-white/60">
          <span>© MR MARVIS 2026</span>
          {[
            "Terms & Conditions",
            "Privacy Policy",
            "Imprint",
            "Cookie Policy",
            "Right of Cancellation",
            "Speak Up: Grievance & Whistleblowing",
            "Accessibility Statement",
          ].map((t) => (
            <a key={t} href="#" className="hover:text-white hover:underline">
              {t}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
