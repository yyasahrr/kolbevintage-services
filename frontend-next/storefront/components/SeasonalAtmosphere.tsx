import { resolveTheme, type SiteTheme } from "../designSystem";
import { useSiteSettings } from "../siteSettings";

type Scene = {
  key: string;
  latin: string;
  title: string;
  note: string;
  symbols: string[];
};

const scenes: Record<string, Scene> = {
  valentine: {
    key: "valentine",
    latin: "LOVE LETTERS FROM KOLBE",
    title: "فصل دوست‌داشتن",
    note: "انتخاب‌های رمانتیک برای ولنتاین",
    symbols: ["♥", "♡", "kiss", "♥", "kiss", "♡", "♥", "♡"],
  },
  "black-friday": {
    key: "black-friday",
    latin: "BLACK FRIDAY / LIMITED EDITION",
    title: "جمعه سیاه کلبه",
    note: "پیشنهادهای محدود این هفته",
    symbols: ["٪", "SALE", "✦", "٪", "SALE", "✦", "٪", "SALE"],
  },
  nowruz: {
    key: "nowruz",
    latin: "NOWRUZ / A NEW CHAPTER",
    title: "بهار نو، استایل نو",
    note: "انتخاب‌های روشن برای شروع سال",
    symbols: ["✿", "❋", "✦", "✿", "❋", "✦", "✿", "❋"],
  },
  yalda: {
    key: "yalda",
    latin: "YALDA / THE LONGEST NIGHT",
    title: "روایت سرخ شب یلدا",
    note: "انتخاب‌های گرم برای بلندترین شب",
    symbols: ["pomegranate", "✦", "●", "pomegranate", "✦", "●", "pomegranate", "✦"],
  },
  "dark-academia": {
    key: "dark-academia",
    latin: "THE AUTUMN READING SOCIETY",
    title: "فصل کتابخانه و پارچه‌های سنگین",
    note: "منتخب دارک آکادمیا",
    symbols: ["§", "✦", "A", "§", "✦", "V", "§", "✦"],
  },
};

const atmosphereFallback: Partial<Record<SiteTheme["atmosphere"], string>> = {
  romantic: "valentine",
  noir: "black-friday",
  festive: "nowruz",
};

function KissMark() {
  return (
    <svg viewBox="0 0 64 42" aria-hidden="true" focusable="false">
      <path d="M4 23C14 8 24 6 32 16C40 6 50 8 60 23C49 38 15 38 4 23Z" fill="currentColor" />
      <path d="M8 23C22 20 42 20 56 23C44 26 20 26 8 23Z" fill="var(--site-bg)" opacity=".72" />
    </svg>
  );
}

function PomegranateMark() {
  return <span className="seasonal-pomegranate" aria-hidden="true"><i /><b>✦</b></span>;
}

function Motif({ symbol, index }: { symbol: string; index: number }) {
  if (symbol === "kiss") return <span className={`seasonal-motif motif-${index} motif-kiss`}><KissMark /></span>;
  if (symbol === "pomegranate") return <span className={`seasonal-motif motif-${index} motif-fruit`}><PomegranateMark /></span>;
  return <span className={`seasonal-motif motif-${index}`}>{symbol}</span>;
}

export default function SeasonalAtmosphere() {
  const { designSystem } = useSiteSettings();
  const theme = resolveTheme(designSystem);
  const sceneKey = scenes[theme.id] ? theme.id : atmosphereFallback[theme.atmosphere];
  const scene = sceneKey ? scenes[sceneKey] : undefined;

  return (
    <>
      <div className="seasonal-backdrop" aria-hidden="true" />
      {scene ? (
        <>
          <div className={`seasonal-motifs scene-${scene.key}`} aria-hidden="true">
            {scene.symbols.map((symbol, index) => <Motif key={`${symbol}-${index}`} symbol={symbol} index={index} />)}
          </div>
          <aside className={`seasonal-ribbon scene-${scene.key}`} aria-label={`تم مناسبتی ${theme.name}`}>
            <span className="seasonal-ribbon-mark" aria-hidden="true">{scene.key === "valentine" ? "♥" : scene.key === "yalda" ? "●" : "✦"}</span>
            <span className="seasonal-ribbon-copy"><b>{scene.title}</b><small>{scene.note}</small></span>
            <span className="seasonal-ribbon-latin" dir="ltr">{scene.latin}</span>
          </aside>
        </>
      ) : null}
    </>
  );
}
