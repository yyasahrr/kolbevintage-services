import { Link } from "../router";
import { useSiteSettings } from "../siteSettings";
import Icon from "./Icon";

function HeroCopy() {
  const { hero } = useSiteSettings();
  return (
    <div className="hero-copy fade-up text-right">
      <p className="hero-eyebrow text-[10.5px] tracking-[0.32em]">{hero.eyebrow}</p>
      <h1 className="mt-4 max-w-2xl text-[32px] font-medium leading-[1.35] sm:text-[42px] lg:text-[50px]">{hero.title}</h1>
      <p className="hero-description mt-4 max-w-xl text-[12.5px] leading-[2] sm:text-[14px]">{hero.description}</p>
      <div className="hero-actions mt-7 flex flex-wrap items-center gap-3">
        <Link to={hero.primaryTo} className="hero-cta hero-cta-primary inline-flex min-h-11 items-center gap-2 rounded-full px-6 py-3 text-[12.5px] font-medium">
          {hero.primaryLabel}<Icon name="arrowLeft" className="h-4 w-4" />
        </Link>
        <Link to={hero.secondaryTo} className="hero-cta hero-cta-secondary inline-flex min-h-11 items-center gap-2 rounded-full px-5 py-3 text-[12px] font-medium">
          <Icon name="star" className="h-4 w-4" />{hero.secondaryLabel}
        </Link>
      </div>
    </div>
  );
}

export default function HomepageHero() {
  const { hero } = useSiteSettings();
  const images = [...hero.images, ...hero.images].slice(0, 4);

  if (hero.template === "split") {
    return <section className="storefront-hero hero-split grid overflow-hidden lg:grid-cols-[0.9fr_1.1fr]">
      <div className="hero-light-copy flex items-center px-6 py-16 sm:px-10 lg:px-14"><HeroCopy /></div>
      <img src={images[0]} alt={hero.title} fetchPriority="high" className="h-[52svh] min-h-[420px] w-full object-cover lg:h-full" />
    </section>;
  }

  if (hero.template === "mosaic") {
    return <section className="storefront-hero hero-mosaic grid overflow-hidden lg:grid-cols-[0.82fr_1.18fr]">
      <div className="hero-light-copy flex items-center px-6 py-16 sm:px-10 lg:px-14"><HeroCopy /></div>
      <div className="grid min-h-[520px] grid-cols-2 grid-rows-2 gap-2 p-2">
        <img src={images[0]} alt="" className="row-span-2 h-full w-full object-cover" />
        <img src={images[1]} alt="" className="h-full w-full object-cover" />
        <img src={images[2]} alt="" className="h-full w-full object-cover" />
      </div>
    </section>;
  }

  if (hero.template === "duo") {
    return <section className="storefront-hero hero-duo relative grid min-h-[610px] overflow-hidden sm:grid-cols-2">
      <img src={images[0]} alt="" className="h-full min-h-[320px] w-full object-cover" />
      <img src={images[1]} alt="" className="h-full min-h-[320px] w-full object-cover" />
      <div className="absolute inset-0 bg-black/45" />
      <div className="absolute inset-0 flex items-center px-6 sm:px-10 lg:px-14"><div className="mx-auto w-full max-w-[1240px] text-white"><HeroCopy /></div></div>
    </section>;
  }

  if (hero.template === "minimal") {
    return <section className="storefront-hero hero-minimal grid min-h-[570px] overflow-hidden lg:grid-cols-[1.1fr_0.9fr]">
      <div className="hero-light-copy flex items-center px-6 py-16 sm:px-10 lg:px-14"><HeroCopy /></div>
      <div className="p-3 sm:p-5"><img src={images[0]} alt={hero.title} className="h-full min-h-[390px] w-full object-cover" /></div>
    </section>;
  }

  return <section className="storefront-hero hero-cover relative min-h-[620px] w-full overflow-hidden bg-neutral-200 sm:min-h-[590px] lg:h-[72svh] lg:max-h-[760px] lg:min-h-[610px]">
    <img src={images[0]} alt={hero.title} fetchPriority="high" decoding="async" className="h-full w-full object-cover object-center" />
    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-black/10" />
    <div className="absolute inset-0 flex items-end px-5 pb-14 pt-16 text-white sm:px-8 lg:items-center lg:px-12 lg:pb-10">
      <div className="mx-auto w-full max-w-[1280px]"><HeroCopy /></div>
    </div>
  </section>;
}
