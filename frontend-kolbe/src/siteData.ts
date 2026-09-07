/**
 * داده‌های سراسری سایت «کلبه وینتیج»
 * تمام متن‌ها فارسی و ساختار برای RTL طراحی شده است.
 */

export type NavItem = { label: string; to: string };

export const mainNav: NavItem[] = [
  { label: "جدیدترین‌ها", to: "/shop?sort=new" },
  { label: "کالکشن پاییز", to: "/collection" },
  { label: "کت و بلیزر", to: "/shop?cat=blazer" },
  { label: "پیراهن", to: "/shop?cat=shirt" },
  { label: "بافت و پلیور", to: "/shop?cat=knit" },
  { label: "شلوار", to: "/shop?cat=trouser" },
  { label: "اکسسوری", to: "/shop?cat=accessory" },
  { label: "استایل‌ها", to: "/styles" },
  { label: "مجله", to: "/blog" },
];

export const utilityNav: NavItem[] = [
  { label: "درباره کلبه", to: "/about" },
  { label: "راهنمای خرید", to: "/contact" },
  { label: "پیگیری سفارش", to: "/contact" },
];

/* ---------------------------------- استایل‌ها --------------------------------- */

export type Style = {
  slug: string;
  name: string;
  latin: string;
  tagline: string;
  description: string;
  img: string;
  swatches: string[];
  count: number;
};

export const styles: Style[] = [
  {
    slug: "old-money",
    name: "اولد مانی",
    latin: "Old Money",
    tagline: "ثروت قدیمی، سکوتِ شیک",
    description:
      "زبان پوشش خانواده‌های قدیمی؛ پارچه‌های نجیب، رنگ‌های خنثی و برش‌هایی که هیچ‌وقت فریاد نمی‌زنند. بلیزر کروات‌دوز، پلیور روی شانه و کفش چرم دست‌دوز.",
    img: "/images/model-front.jpg",
    swatches: ["#d9c7a7", "#22304a", "#f2f2ee", "#5a4030"],
    count: 42,
  },
  {
    slug: "vintage",
    name: "وینتیج",
    latin: "Vintage",
    tagline: "روح دهه‌های طلایی",
    description:
      "قطعاتی با حال‌وهوای دهه ۶۰ و ۷۰؛ رنگ‌های خاک‌خورده، بافت‌های زبر و جزئیاتی که با گذر زمان قشنگ‌تر می‌شوند.",
    img: "/images/model-teal.jpg",
    swatches: ["#9e4b3c", "#b7c98a", "#f0c04a", "#3fa89b"],
    count: 58,
  },
  {
    slug: "dark-academia",
    name: "دارک آکادمیا",
    latin: "Dark Academia",
    tagline: "کتابخانه‌های قدیمی و پاییزهای بلند",
    description:
      "چهارخانه‌های تیره، پشم ضخیم، قهوه‌ای سوخته و سبز جنگلی. لباسی برای کسی که کتاب می‌خواند و باران را دوست دارد.",
    img: "/images/detail-collar.jpg",
    swatches: ["#3d5c3a", "#4a4f55", "#5a4030", "#1a1d21"],
    count: 36,
  },
  {
    slug: "minimal",
    name: "مینیمال",
    latin: "Minimal",
    tagline: "هرچه کمتر، دقیق‌تر",
    description:
      "خط‌های تمیز، پالت محدود و صفر جزئیات اضافه. قطعاتی که به‌سادگی با هر چیزی در کمد شما ست می‌شوند.",
    img: "/images/flat.jpg",
    swatches: ["#f2f2ee", "#dfe3e6", "#7d8790", "#1a1d21"],
    count: 47,
  },
  {
    slug: "neo-classic",
    name: "نئو کلاسیک",
    latin: "Neo Classic",
    tagline: "کلاسیک، اما امروزی",
    description:
      "برش‌های کلاسیک با فرم‌های به‌روز؛ جایی که سنت خیاطی با راحتی امروز آشتی می‌کند.",
    img: "/images/model-full.jpg",
    swatches: ["#2f5c8a", "#c6d7e4", "#d97c50", "#22304a"],
    count: 31,
  },
];

/* ---------------------------------- محصولات ---------------------------------- */

export type Product = {
  id: string;
  name: string;
  subtitle: string;
  price: number;
  oldPrice?: number;
  img: string;
  hoverImg: string;
  style: string;
  category: string;
  badges: string[];
  rating: number;
  reviews: number;
  colours: string[];
  sold?: number;
};

export const products: Product[] = [
  {
    id: "blazer-oxford",
    name: "بلیزر آکسفورد",
    subtitle: "پشم بکر، آستر ابریشمی",
    price: 4_850_000,
    img: "/images/model-front.jpg",
    hoverImg: "/images/detail-collar.jpg",
    style: "old-money",
    category: "blazer",
    badges: ["جدید"],
    rating: 4.8,
    reviews: 64,
    colours: ["#22304a", "#5a4030", "#4a4f55"],
    sold: 212,
  },
  {
    id: "shirt-linen",
    name: "پیراهن کتان کلبه",
    subtitle: "کتان شسته، یقه فرانسوی",
    price: 2_390_000,
    oldPrice: 2_890_000,
    img: "/images/flat.jpg",
    hoverImg: "/images/model-teal.jpg",
    style: "minimal",
    category: "shirt",
    badges: ["پرفروش"],
    rating: 4.7,
    reviews: 128,
    colours: ["#f2f2ee", "#c6d7e4", "#d9c7a7"],
    sold: 480,
  },
  {
    id: "knit-cable",
    name: "پلیور بافت کابلی",
    subtitle: "پشم مرینوس، بافت دست",
    price: 3_180_000,
    img: "/images/model-teal.jpg",
    hoverImg: "/images/detail-hem.jpg",
    style: "dark-academia",
    category: "knit",
    badges: ["محدود"],
    rating: 4.9,
    reviews: 91,
    colours: ["#3d5c3a", "#5a4030", "#22304a"],
    sold: 305,
  },
  {
    id: "trouser-pleated",
    name: "شلوار پیلی‌دار کلاسیک",
    subtitle: "فاستونی، فرم‌دار",
    price: 2_950_000,
    img: "/images/model-full.jpg",
    hoverImg: "/images/flat.jpg",
    style: "neo-classic",
    category: "trouser",
    badges: [],
    rating: 4.6,
    reviews: 73,
    colours: ["#4a4f55", "#d9c7a7", "#1a1d21"],
    sold: 264,
  },
  {
    id: "polo-pique",
    name: "پولوشرت پیکه",
    subtitle: "پنبه ارگانیک، یقه فرم‌دار",
    price: 1_890_000,
    img: "/images/detail-collar.jpg",
    hoverImg: "/images/model-front.jpg",
    style: "vintage",
    category: "shirt",
    badges: ["پرفروش", "جدید"],
    rating: 4.7,
    reviews: 68,
    colours: ["#6fa4d8", "#9e4b3c", "#f0c04a"],
    sold: 512,
  },
  {
    id: "coat-herringbone",
    name: "پالتو شِوِرون",
    subtitle: "پشم و کشمیر، بلند",
    price: 7_450_000,
    img: "/images/detail-hem.jpg",
    hoverImg: "/images/model-full.jpg",
    style: "dark-academia",
    category: "blazer",
    badges: ["کالکشن پاییز"],
    rating: 5,
    reviews: 39,
    colours: ["#4a4f55", "#5a4030"],
    sold: 118,
  },
  {
    id: "vest-knit",
    name: "جلیقه بافت آرگایل",
    subtitle: "پشم سبک، طرح لوزی",
    price: 1_650_000,
    oldPrice: 1_950_000,
    img: "/images/model-teal.jpg",
    hoverImg: "/images/detail-collar.jpg",
    style: "dark-academia",
    category: "knit",
    badges: ["تخفیف"],
    rating: 4.5,
    reviews: 54,
    colours: ["#b7c98a", "#9e4b3c", "#22304a"],
    sold: 287,
  },
  {
    id: "belt-leather",
    name: "کمربند چرم دست‌دوز",
    subtitle: "چرم گاوی، سگک برنجی",
    price: 980_000,
    img: "/images/flat.jpg",
    hoverImg: "/images/detail-hem.jpg",
    style: "old-money",
    category: "accessory",
    badges: [],
    rating: 4.8,
    reviews: 112,
    colours: ["#5a4030", "#1a1d21"],
    sold: 396,
  },
  {
    id: "shirt-oxford",
    name: "پیراهن آکسفورد راه‌راه",
    subtitle: "پنبه ضخیم، دکمه‌یقه",
    price: 2_150_000,
    img: "/images/model-front.jpg",
    hoverImg: "/images/flat.jpg",
    style: "neo-classic",
    category: "shirt",
    badges: ["جدید"],
    rating: 4.6,
    reviews: 47,
    colours: ["#c6d7e4", "#f2f2ee"],
    sold: 173,
  },
  {
    id: "scarf-wool",
    name: "شال گردن پشمی",
    subtitle: "پشم لمبزوول، ریشه‌دوزی دست",
    price: 890_000,
    img: "/images/detail-hem.jpg",
    hoverImg: "/images/model-teal.jpg",
    style: "vintage",
    category: "accessory",
    badges: [],
    rating: 4.9,
    reviews: 88,
    colours: ["#9e4b3c", "#3d5c3a", "#d9c7a7"],
    sold: 341,
  },
  {
    id: "trouser-chino",
    name: "شلوار چینو کلبه",
    subtitle: "پنبه استرچ، فرم مستقیم",
    price: 1_980_000,
    img: "/images/model-full.jpg",
    hoverImg: "/images/model-front.jpg",
    style: "minimal",
    category: "trouser",
    badges: ["پرفروش"],
    rating: 4.7,
    reviews: 205,
    colours: ["#d9c7a7", "#22304a", "#4a4f55"],
    sold: 604,
  },
  {
    id: "cardigan-shawl",
    name: "ژاکت یقه شال",
    subtitle: "بافت درشت، دکمه صدفی",
    price: 3_450_000,
    img: "/images/detail-collar.jpg",
    hoverImg: "/images/model-full.jpg",
    style: "old-money",
    category: "knit",
    badges: ["کالکشن پاییز"],
    rating: 4.8,
    reviews: 61,
    colours: ["#d9c7a7", "#5a4030", "#22304a"],
    sold: 149,
  },
];

export const newArrivals = products.filter((p) => p.badges.includes("جدید") || p.badges.includes("کالکشن پاییز"));
export const bestSellers = [...products].sort((a, b) => (b.sold ?? 0) - (a.sold ?? 0)).slice(0, 8);

/* ------------------------------ ست‌های پیشنهادی ------------------------------ */

export type Look = {
  id: string;
  title: string;
  season: string;
  img: string;
  items: { name: string; price: number; productId: string }[];
};

export const looks: Look[] = [
  {
    id: "look-1",
    title: "عصر پاییزی در کتابخانه",
    season: "دارک آکادمیا",
    img: "/images/model-teal.jpg",
    items: [
      { name: "پلیور بافت کابلی", price: 3_180_000, productId: "knit-cable" },
      { name: "شلوار پیلی‌دار کلاسیک", price: 2_950_000, productId: "trouser-pleated" },
      { name: "شال گردن پشمی", price: 890_000, productId: "scarf-wool" },
    ],
  },
  {
    id: "look-2",
    title: "ناهار یکشنبه، ساحل شمالی",
    season: "اولد مانی",
    img: "/images/model-front.jpg",
    items: [
      { name: "بلیزر آکسفورد", price: 4_850_000, productId: "blazer-oxford" },
      { name: "پیراهن کتان کلبه", price: 2_390_000, productId: "shirt-linen" },
      { name: "کمربند چرم دست‌دوز", price: 980_000, productId: "belt-leather" },
    ],
  },
  {
    id: "look-3",
    title: "روزهای ساده شهری",
    season: "مینیمال",
    img: "/images/model-full.jpg",
    items: [
      { name: "پیراهن آکسفورد راه‌راه", price: 2_150_000, productId: "shirt-oxford" },
      { name: "شلوار چینو کلبه", price: 1_980_000, productId: "trouser-chino" },
      { name: "جلیقه بافت آرگایل", price: 1_650_000, productId: "vest-knit" },
    ],
  },
];

/* ---------------------------------- مقالات ---------------------------------- */

export type Article = {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  readTime: number;
  date: string;
  img: string;
  body: string[];
};

export const articles: Article[] = [
  {
    slug: "old-money-guide",
    title: "راهنمای کامل استایل اولد مانی برای آقایان",
    excerpt:
      "چطور بدون خرج کردن ثروت، مثل کسی لباس بپوشید که هیچ‌وقت لازم نبوده درباره پولش حرف بزند؟ از انتخاب پارچه تا قانون سه‌رنگ.",
    category: "راهنمای استایل",
    readTime: 8,
    date: "۲۳ مرداد ۱۴۰۵",
    img: "/images/model-front.jpg",
    body: [
      "استایل اولد مانی بیش از آنکه درباره برند باشد، درباره «نخوردن به چشم» است. اصل اول این سبک، کیفیت پارچه است؛ پشم بکر، کتان خالص، پنبه مصری و کشمیر. این پارچه‌ها با گذر زمان زیباتر می‌شوند و همین کهنگی خوش‌فرم، امضای این سبک است.",
      "قانون سه‌رنگ را جدی بگیرید: در هر ست، بیش از سه رنگ استفاده نکنید و یکی از آن‌ها را خنثی نگه دارید. کرم، سرمه‌ای، خاکستری سنگی و قهوه‌ای تنباکویی ستون فقرات این پالت هستند.",
      "برش لباس باید اندازه بدن شما باشد، نه اندازه مد امسال. یک بلیزر با شانه‌های درست و آستین‌هایی که یک سانتی‌متر از پیراهن کوتاه‌تر است، بیشتر از هر لوگویی حرف می‌زند.",
      "در نهایت، اکسسوری را کم کنید. یک ساعت ساده، یک کمربند چرم دست‌دوز و کفشی که واکس خورده باشد، تمام چیزی است که لازم دارید.",
    ],
  },
  {
    slug: "vintage-fabric-care",
    title: "نگهداری از لباس‌های وینتیج: هفت اشتباه رایج",
    excerpt:
      "لباس وینتیج سرمایه است، نه کالای مصرفی. از دمای شستشو تا نحوه آویختن، هرچه باید بدانید تا قطعات محبوبتان سال‌ها بمانند.",
    category: "نگهداری",
    readTime: 6,
    date: "۱۵ مرداد ۱۴۰۵",
    img: "/images/detail-hem.jpg",
    body: [
      "اولین و مهم‌ترین اشتباه، شستشوی بیش از حد است. لباس پشمی و بافت را بعد از هر بار پوشیدن نشویید؛ هوا دادن در فضای باز برای بیست‌وچهار ساعت، بیشتر از ماشین لباسشویی کار می‌کند.",
      "دمای آب را هرگز بالای سی درجه نبرید. الیاف طبیعی در آب داغ جمع می‌شوند و این تغییر برگشت‌ناپذیر است.",
      "بافت‌ها را هرگز آویزان نکنید. وزن خود لباس، شانه‌ها را می‌کشد و فرم را برای همیشه خراب می‌کند. بافت را تا کنید و در قفسه بگذارید.",
      "برای بلیزر و کت، از چوب‌لباسی پهن چوبی استفاده کنید تا فرم شانه حفظ شود و بعد از هر بار پوشیدن با برس مخصوص، گردوغبار را بگیرید.",
    ],
  },
  {
    slug: "dark-academia-capsule",
    title: "کمد کپسولی دارک آکادمیا با ده قطعه",
    excerpt:
      "با ده قطعه درست می‌توانید یک ماه کامل، هر روز متفاوت و در فضای دارک آکادمیا لباس بپوشید. فهرست دقیق را اینجا بخوانید.",
    category: "کمد کپسولی",
    readTime: 7,
    date: "۲ مرداد ۱۴۰۵",
    img: "/images/detail-collar.jpg",
    body: [
      "کمد کپسولی یعنی حداقل قطعات با حداکثر ترکیب. برای دارک آکادمیا، پایه کار سه رنگ است: قهوه‌ای سوخته، سبز جنگلی و خاکستری زغالی.",
      "قطعه اول و مهم‌ترین، یک پالتوی شورون بلند است. این قطعه به‌تنهایی هویت کل ست را می‌سازد.",
      "جلیقه بافت آرگایل، پیراهن آکسفورد سفید، شلوار پیلی‌دار پشمی و یک شال گردن پشمی، چهار قطعه بعدی هستند که با هم بیش از بیست ترکیب می‌سازند.",
      "کفش باید چرم و بنددار باشد. یک جفت دربی قهوه‌ای، کل مجموعه را جمع می‌کند.",
    ],
  },
  {
    slug: "how-to-measure",
    title: "چطور سایز درست را بدون رفتن به فروشگاه پیدا کنیم؟",
    excerpt:
      "چهار اندازه بدنتان را یک‌بار بگیرید و برای همیشه راحت خرید کنید. آموزش تصویری اندازه‌گیری دور سینه، شانه، قد آستین و قد بالاتنه.",
    category: "راهنمای سایز",
    readTime: 5,
    date: "۲۸ تیر ۱۴۰۵",
    img: "/images/flat.jpg",
    body: [
      "برای اندازه‌گیری دور سینه، متر را از پرترین قسمت سینه و زیر بغل عبور دهید و بدون فشار دادن، عدد را بخوانید.",
      "عرض شانه را از انتهای استخوان یک شانه تا انتهای شانه دیگر، از پشت اندازه بگیرید. بهتر است این کار را کسی برای شما انجام دهد.",
      "قد آستین از وسط پشت گردن، روی شانه و تا مچ دست اندازه گرفته می‌شود، در حالی که آرنج کمی خم است.",
      "این چهار عدد را در گوشی‌تان ذخیره کنید؛ در جدول سایز هر محصول کلبه وینتیج، دقیقاً همین چهار عدد آمده است.",
    ],
  },
  {
    slug: "minimal-color-palette",
    title: "پالت رنگی مینیمال: با پنج رنگ، سی ست بسازید",
    excerpt:
      "راز کمد مینیمال، محدودیت رنگ است. با این پنج رنگ پایه، هر قطعه با هر قطعه دیگری ست می‌شود.",
    category: "راهنمای استایل",
    readTime: 6,
    date: "۱۹ تیر ۱۴۰۵",
    img: "/images/model-full.jpg",
    body: [
      "پنج رنگ پایه پیشنهادی ما: سفید شکری، خاکستری سنگی، سرمه‌ای عمیق، شتری و مشکی مات.",
      "هر قطعه‌ای که می‌خرید باید حداقل با سه قطعه موجود در کمدتان ست شود؛ اگر نمی‌شود، آن قطعه برای شما نیست.",
      "بافت را جایگزین رنگ کنید. وقتی پالت محدود است، تفاوت بافت پارچه‌هاست که ست را جذاب می‌کند.",
    ],
  },
  {
    slug: "neo-classic-tailoring",
    title: "خیاطی نئو کلاسیک: وقتی سنت با راحتی آشتی می‌کند",
    excerpt:
      "بلیزرهای بدون لایه، شلوارهای کش‌دار و پارچه‌های تکنیکال؛ نسل جدید لباس رسمی چه شکلی است؟",
    category: "پشت صحنه",
    readTime: 9,
    date: "۷ تیر ۱۴۰۵",
    img: "/images/model-teal.jpg",
    body: [
      "تا دهه نود، یک بلیزر خوب یعنی لایه‌گذاری سنگین، مو اسبی و ساختار سفت. امروز اما راحتی به همان اندازه مهم است.",
      "بلیزر بدون لایه یا نیمه‌لایه، همان خط شانه را می‌سازد اما مثل یک ژاکت روی بدن می‌نشیند.",
      "در کارگاه کلبه وینتیج، این بلیزرها با دوخت دست و پارچه پشم استرچ ساخته می‌شوند؛ نتیجه، کتی است که می‌توانید هشت ساعت بپوشید و فراموشش کنید.",
    ],
  },
];

/* ----------------------------------- فوتر ----------------------------------- */

export const footerColumnsFa = [
  {
    title: "خرید",
    items: ["جدیدترین‌ها", "کالکشن پاییز", "کت و بلیزر", "پیراهن", "بافت و پلیور", "شلوار", "اکسسوری", "حراج فصل"],
  },
  {
    title: "استایل‌ها",
    items: ["اولد مانی", "وینتیج", "دارک آکادمیا", "مینیمال", "نئو کلاسیک", "ست‌های پیشنهادی"],
  },
  {
    title: "خدمات مشتریان",
    items: ["پیگیری سفارش", "راهنمای سایز", "شرایط مرجوعی", "روش‌های ارسال", "سوالات متداول", "تماس با ما"],
  },
  {
    title: "کلبه وینتیج",
    items: ["درباره ما", "کارگاه دوخت", "مجله استایل", "فروشگاه‌ها", "همکاری با ما", "فرصت‌های شغلی"],
  },
];

export const trustBadges = [
  { title: "ارسال رایگان", text: "برای سفارش‌های بالای ۳ میلیون تومان", icon: "truck" },
  { title: "۳۰ روز مهلت مرجوعی", text: "بدون پرسش، بدون دردسر", icon: "return" },
  { title: "دوخت دست", text: "در کارگاه اختصاصی کلبه", icon: "needle" },
  { title: "پرداخت امن", text: "درگاه معتبر بانکی", icon: "shield" },
];
