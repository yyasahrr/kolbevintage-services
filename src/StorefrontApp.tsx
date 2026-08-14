import { useState } from "react";
import Header from "./components/Header";
import Gallery from "./components/Gallery";
import ProductPanel, { ProductDetails } from "./components/ProductPanel";
import Related from "./components/Related";
import Reviews from "./components/Reviews";
import Footer from "./components/Footer";

function Banner() {
  return (
    <section className="relative">
      <img
        src="/images/banner.jpg"
        alt="Men enjoying summer in Kolbe Vintage"
        className="h-[280px] w-full object-cover lg:h-[420px]"
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black/10 px-6 text-center">
        <h2 className="max-w-xl text-[22px] font-medium text-white drop-shadow lg:text-[32px]">
          You may also like The Originals
        </h2>
        <a
          href="#"
          className="rounded-[3px] bg-white px-7 py-2.5 text-[13px] font-medium text-[#011c3a] transition hover:bg-neutral-100"
        >
          Shop now
        </a>
      </div>
    </section>
  );
}

function StoreSection() {
  return (
    <section className="bg-[#f6f6f4]">
      <div className="mx-auto grid max-w-[1600px] items-stretch gap-0 lg:grid-cols-[1fr_2fr]">
        <div className="flex flex-col justify-center px-6 py-12 lg:px-16">
          <h3 className="text-[20px] font-medium">Visit us in store</h3>
          <p className="mt-3 max-w-xs text-[12.5px] leading-relaxed text-neutral-600">
            Try on different styles and receive personal advice from our style advisors.
          </p>
          <a href="#" className="mt-5 inline-flex items-center gap-2 text-[12.5px] underline">
            Find store →
          </a>
        </div>
        <img
          src="/images/store.jpg"
          alt="Kolbe Vintage store"
          className="h-[260px] w-full object-cover lg:h-[340px]"
        />
      </div>
    </section>
  );
}

function HelpAndNewsletter() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <section className="mx-auto grid max-w-[1200px] gap-12 px-6 py-16 lg:grid-cols-2 lg:gap-24">
      <div>
        <h3 className="text-[19px] font-medium">Need help?</h3>
        <p className="mt-3 text-[12px] text-neutral-500">Today's customer service hours</p>
        <p className="text-[12px] text-neutral-700">10:30 - 18:30</p>
        <p className="text-[12px] text-neutral-500">08:00 - 17:00 CEST</p>
        <a href="tel:+31207059222" className="mt-2 inline-block text-[12.5px] underline">
          +31 20 7059222
        </a>

        <div className="mt-7 flex gap-8">
          {[
            { label: "Returns", d: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5" },
            { label: "FAQ", d: "M12 17h.01M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1.1-1.3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" },
            { label: "Email", d: "M3 6h18v12H3zM3 6l9 7 9-7" },
            { label: "Messenger", d: "M12 3C6.9 3 3 6.8 3 11.5c0 2.6 1.2 4.9 3.2 6.4V22l3-1.6c.9.2 1.8.4 2.8.4 5.1 0 9-3.8 9-8.5S17.1 3 12 3Z" },
            { label: "Chat", d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10Z" },
          ].map((i) => (
            <button key={i.label} className="flex flex-col items-center gap-2 text-[11px] text-neutral-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#011c3a" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d={i.d} />
              </svg>
              {i.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-[19px] font-medium">Join the world of Kolbe Vintage</h3>
        <p className="mt-3 text-[12.5px] text-neutral-600">
          Be the first to know about new products, events and special offers.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSent(true);
          }}
          className="mt-5 flex max-w-md items-center border-b border-neutral-400 pb-2"
        >
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email address"
            className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-neutral-400"
          />
          <button
            type="submit"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#011c3a] text-white"
            aria-label="Subscribe"
          >
            →
          </button>
        </form>
        {sent && <p className="mt-2 text-[11.5px] text-neutral-600">Thanks — welcome aboard!</p>}
      </div>
    </section>
  );
}

export default function StorefrontApp() {
  const [colour, setColour] = useState("Navy Harbour");

  return (
    <div className="min-h-screen bg-white">
      <Header />

      <main>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_460px]">
          <Gallery />
          <aside className="self-start lg:sticky lg:top-[104px]">
            <ProductPanel colour={colour} onColourChange={setColour} />
          </aside>
        </div>

        <ProductDetails colour={colour} />
        <Related />
        <Banner />
        <Reviews />
        <StoreSection />
        <HelpAndNewsletter />
      </main>

      <Footer />

      <button className="fixed bottom-0 left-0 z-40 rounded-tr-md bg-[#011c3a] px-4 py-2 text-[11px] text-white shadow-lg">
        Get 10% off
      </button>
    </div>
  );
}
