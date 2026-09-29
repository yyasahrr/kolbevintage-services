import { useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "../router";
import Icon from "./Icon";
import { useSiteSettings } from "../siteSettings";

function FooterGroup({ title, children, accordion }: { title: string; children: ReactNode; accordion: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="footer-group border-b border-current/10 py-1 sm:border-0 sm:py-0">
      <button type="button" onClick={() => accordion && setOpen((value) => !value)} aria-expanded={accordion ? open : true} className="flex min-h-11 w-full items-center justify-between text-right text-[11.5px] font-semibold sm:pointer-events-none sm:min-h-0">
        {title}
        {accordion ? <Icon name="chevronDown" className={`h-3.5 w-3.5 transition-transform sm:hidden ${open ? "rotate-180" : ""}`} /> : null}
      </button>
      <div className={`${accordion && !open ? "hidden" : "block"} pb-3 sm:block sm:pb-0 sm:pt-3`}>{children}</div>
    </section>
  );
}

export default function SiteFooter() {
  const { footer, builder, header } = useSiteSettings();
  const appearance = footer.appearance;
  const socials = builder.footer.socials;
  const columns = appearance.layout === "compact" ? footer.columns.slice(0, 2) : footer.columns;
  const footerStyle = { "--footer-background": appearance.backgroundColor, "--footer-text": appearance.textColor } as CSSProperties;

  return (
    <footer data-template={appearance.template} className={`site-footer site-footer--custom mx-2 mb-2 overflow-hidden sm:mx-3 sm:mb-3 ${appearance.template === "minimal" ? "rounded-none" : appearance.template === "centered" ? "rounded-[2rem]" : "rounded-[1.25rem]"}`} style={footerStyle}>
      <div className="mx-auto max-w-[1120px] px-5 lg:px-8">
        {appearance.showBrand ? (
          <div className="flex items-center justify-between gap-4 border-b border-current/10 py-5 sm:justify-center sm:py-7">
            <div className="sm:text-center">
              <span className="block text-[17px] font-semibold tracking-[0.12em] sm:text-[20px]">{header.brand}</span>
              <span className="mt-1 block text-[7.5px] tracking-[0.34em] opacity-45">{header.latinBrand}</span>
            </div>
            {socials.length ? <div className="flex gap-1.5 sm:hidden">{socials.slice(0, 3).map((social, index) => <a key={`${social.url}-${index}`} href={social.url} target="_blank" rel="noreferrer" aria-label={social.label} className="grid h-8 w-8 place-items-center rounded-full border border-current/20 opacity-70"><Icon name={social.icon} className="h-3.5 w-3.5" /></a>)}</div> : null}
          </div>
        ) : null}

        <div className={`grid gap-x-8 py-3 sm:py-7 ${appearance.template === "centered" ? "text-center" : ""} ${appearance.layout === "compact" ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-5"}`}>
          {columns.map((column, columnIndex) => (
            <FooterGroup key={`${column.title}-${columnIndex}`} title={column.title} accordion={appearance.mobileAccordion}>
              <ul className="space-y-2">{column.items.map((label, itemIndex) => <li key={`${label}-${itemIndex}`}><Link to={footer.columnUrls[columnIndex]?.[itemIndex] || "/shop"} className="text-[11px] opacity-55 transition hover:opacity-100">{label}</Link></li>)}</ul>
            </FooterGroup>
          ))}

          {appearance.showContact ? (
            <FooterGroup title="اطلاعات تماس" accordion={appearance.mobileAccordion}>
              <ul className="space-y-2 text-[10.5px] opacity-60">
                <li className="flex items-start gap-2"><Icon name="pin" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{footer.address}</li>
                <li className="flex items-center gap-2"><Icon name="phone" className="h-3.5 w-3.5 shrink-0" /><span className="num-fa">{footer.phone}</span></li>
                <li className="flex items-center gap-2"><Icon name="clock" className="h-3.5 w-3.5 shrink-0" />{footer.hours}</li>
                <li className="flex items-center gap-2"><Icon name="mail" className="h-3.5 w-3.5 shrink-0" />{footer.email}</li>
              </ul>
              {socials.length ? <div className="mt-3 hidden gap-2 sm:flex">{socials.map((social, index) => <a key={`${social.url}-${index}`} href={social.url} target="_blank" rel="noreferrer" aria-label={social.label} className="grid h-8 w-8 place-items-center rounded-full border border-current/20 opacity-60 transition hover:opacity-100"><Icon name={social.icon} className="h-3.5 w-3.5" /></a>)}</div> : null}
            </FooterGroup>
          ) : null}

          {appearance.showLicenses ? (
            <FooterGroup title="مجوزها" accordion={appearance.mobileAccordion}>
              <div className="flex flex-wrap gap-2">{["نماد اعتماد", "ساماندهی", "اتحادیه"].map((label) => <div key={label} className="flex h-14 w-14 flex-col items-center justify-center rounded-md border border-current/15 bg-white/20"><Icon name="shield" className="h-4 w-4 opacity-45" /><span className="mt-1 text-[7px] opacity-55">{label}</span></div>)}</div>
            </FooterGroup>
          ) : null}
        </div>
      </div>
      <div className="border-t border-current/10 px-5 py-3 text-[9.5px] opacity-55"><div className="mx-auto flex max-w-[1120px] flex-col items-center justify-between gap-2 sm:flex-row"><span className="num-fa opacity-70">{footer.copyright}</span><nav aria-label="پیوندهای حقوقی" className="flex flex-wrap justify-center gap-x-4 gap-y-1"><Link to="/terms" className="hover:opacity-100">شرایط استفاده</Link><Link to="/privacy" className="hover:opacity-100">حریم خصوصی</Link><Link to="/returns" className="hover:opacity-100">مرجوعی</Link><Link to="/shipping" className="hover:opacity-100">ارسال</Link><Link to="/wholesale-terms" className="hover:opacity-100">قوانین عمده</Link></nav></div></div>
    </footer>
  );
}
