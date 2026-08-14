export type Colour = { name: string; hex: string; angle: number };

/** 24 colourways arranged on the MR MARVIS colour wheel */
export const colours: Colour[] = [
  { name: "Boulevards", hex: "#6fa4d8", angle: 0 },
  { name: "Kingfishers", hex: "#2f5c8a", angle: 15 },
  { name: "Avenues", hex: "#c6d7e4", angle: 30 },
  { name: "Gazettes", hex: "#dfe3e6", angle: 45 },
  { name: "Ceramics", hex: "#1a1d21", angle: 60 },
  { name: "Bricks", hex: "#9e4b3c", angle: 75 },
  { name: "Chillies", hex: "#c0392b", angle: 90 },
  { name: "Wimbledons", hex: "#f2f2ee", angle: 105 },
  { name: "Terracottas", hex: "#d97c50", angle: 120 },
  { name: "Sunbeams", hex: "#f0c04a", angle: 135 },
  { name: "Pistachios", hex: "#b7c98a", angle: 150 },
  { name: "Meadows", hex: "#5c8a4a", angle: 165 },
  { name: "Woods", hex: "#3d5c3a", angle: 180 },
  { name: "Lagoons", hex: "#3fa89b", angle: 195 },
  { name: "Oceans", hex: "#1f6f8b", angle: 210 },
  { name: "Nightfalls", hex: "#22304a", angle: 225 },
  { name: "Lavenders", hex: "#9a8fbf", angle: 240 },
  { name: "Blossoms", hex: "#e7b3bd", angle: 255 },
  { name: "Rosés", hex: "#d98b96", angle: 270 },
  { name: "Sands", hex: "#d9c7a7", angle: 285 },
  { name: "Camels", hex: "#b2895c", angle: 300 },
  { name: "Espressos", hex: "#5a4030", angle: 315 },
  { name: "Slates", hex: "#7d8790", angle: 330 },
  { name: "Charcoals", hex: "#4a4f55", angle: 345 },
];

export const sizes = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];

export const gallery = [
  { src: "/images/flat.jpg", tall: false },
  { src: "/images/model-front.jpg", tall: false },
  { src: "/images/model-full.jpg", tall: false, shopTheLook: true },
  { src: "/images/model-teal.jpg", tall: false, shopTheLook: true },
  { src: "/images/detail-collar.jpg", tall: false },
  { src: "/images/detail-hem.jpg", tall: false },
  { src: "/images/model-front.jpg", tall: false },
  { src: "/images/detail-collar.jpg", tall: false },
];

export const accordions = [
  {
    title: "Description",
    body: "Meet The Classic Polo in Boulevards. A refined take on a timeless icon, knitted from breathable organic pique cotton with a subtle stretch. It has a clean two-button placket, a structured collar that keeps its shape wash after wash and side vents for extra comfort. Wear it tucked into your chinos or loose over your swim shorts — it is equally at home at the office and on the terrace.",
  },
  {
    title: "Size & fit",
    body: "Regular fit with a slightly tapered body. Adam is 188 cm tall and wears a size L. If you are between sizes we recommend sizing up for a more relaxed silhouette. Check the size guide for exact measurements.",
  },
  {
    title: "Materials",
    body: "95% organic cotton, 5% elastane. Knitted in a fine pique in Portugal. Mother-of-pearl style buttons. Weight: 220 g/m².",
  },
  {
    title: "Sustainability",
    body: "Made with GOTS certified organic cotton, in a family-run factory in the north of Portugal that runs on 100% renewable energy. Our packaging is plastic free and fully recyclable.",
  },
  {
    title: "Care",
    body: "Machine wash at 30°C with similar colours. Do not tumble dry. Iron on medium heat. Do not bleach. Wash less, wear more.",
  },
  {
    title: "Shipping, exchanges & returns",
    body: "Orders placed before 22:00 are dispatched the same business day. Free shipping on orders above €35 within the EU. You have 100 days to return or exchange your order, free of charge.",
  },
];

export const related = [
  {
    name: "The Terry Polo",
    colour: "Boulevards",
    price: "€89",
    img: "/images/model-front.jpg",
    tags: [] as string[],
  },
  {
    name: "The Classic Polo Longsleeve",
    colour: "Ceramics",
    price: "€99",
    img: "/images/detail-collar.jpg",
    tags: ["New", "Limited edition"],
  },
  {
    name: "The Classic Polo Longsleeve",
    colour: "Kingfishers",
    price: "€99",
    img: "/images/model-teal.jpg",
    tags: ["New", "Limited edition"],
  },
  {
    name: "The Classic Polo Longsleeve",
    colour: "Avenues",
    price: "€99",
    img: "/images/model-full.jpg",
    tags: ["New", "Limited edition"],
  },
  {
    name: "The Classic Polo",
    colour: "Gazettes",
    price: "€79",
    img: "/images/flat.jpg",
    tags: ["New"],
  },
];

export const reviews = [
  {
    stars: 4,
    colour: "Chillies",
    product: "The classic polo",
    author: "Fiona S.",
    date: "08/01/2026",
    text: "Great fit stylish",
  },
  {
    stars: 5,
    colour: "Wimbledons",
    product: "The classic polo",
    author: "Graeme C.",
    date: "07/08/2026",
    text: "Superb cut and fabric. Well made and look great on.",
  },
  {
    stars: 5,
    colour: "Chillies",
    product: "The classic polo",
    author: "James S.",
    date: "07/08/2026",
    text: "Vivid colour and excellent fit.",
  },
  {
    stars: 5,
    colour: "Gazettes",
    product: "The classic polo",
    author: "Georg B.",
    date: "04/03/2026",
    text: "Color and fit as expected",
  },
  {
    stars: 5,
    colour: "Bricks",
    product: "The classic polo",
    author: "Taha E.",
    date: "02/09/2026",
    text: "High quality and fit",
  },
];

export const footerColumns = [
  {
    title: "Trousers",
    items: [
      "The Linens",
      "The Techwoods",
      { label: "The Smart Easies", badge: "New" },
      "The Easies",
      "The Flannels",
      "The Larks",
      "The Cords",
      "The Fine Cords",
      "The Flannels Alpinist",
    ],
  },
  {
    title: "Chinos",
    items: [
      "The Longs",
      "The Cotton Short",
      "The Easy Chinos",
      "The Classic Chinos",
      "The Coolerdays",
      "The Heavy Classics",
      "The Coolerdays Alpinist",
    ],
  },
  {
    title: "Jeans",
    items: [
      "The Jeans",
      "The Five-pockets",
      "The Straight Fit Jeans",
      "The Straight Fit Five-pockets",
    ],
  },
  {
    title: "Shirts",
    items: [
      "The Linen Shirt",
      "The Summer Shirt",
      "The Airy Knit Shirt",
      "The Oxford Shirt",
      "The Cotton Shirt",
      "The Piqué Shirt",
      "The Denim Shirt",
      "The Cord Shirt",
      "The Flannel Shirt",
    ],
  },
  {
    title: "Sweaters & pullovers",
    items: [
      "The Polo Pullover",
      "The Cotton Crew",
      { label: "The Classic Polo Longsleeve", badge: "New" },
      { label: "The Zip Cardigan", badge: "New" },
      "The Midweight Crew",
      "The Merino Zip Pullover",
      { label: "The Midweight Cable Crew", badge: "New" },
      "The Merino V-neck",
      "The Rugby Pullover",
      "The Merino Pullover",
      "The Easy Sweater",
      { label: "The Terry Sweater", badge: "New" },
      "The Wool Pullover",
      "The Chalet Pullover",
      "The Knit Pullover",
      "The Retro Zip Pullover",
      "The Cable Knit Pullover",
    ],
  },
  {
    title: "T-Shirts",
    items: [
      "The Piqué Tee",
      "The Midweight Tee",
      "The Knitted Tee",
      "The Heavy Tee",
    ],
  },
  {
    title: "Polos",
    items: [
      "The Classic Polo",
      "The Knitted Polo",
      "The Buttonless Polo",
      "The Airy Knit Polo",
      "The Terry Polo",
      "The Polo Pullover",
      { label: "The Classic Polo Longsleeve", badge: "New" },
    ],
  },
  {
    title: "Cardigans & Blazers",
    items: ["The Linen Blanket", "The Knitted Blazer", "The Shacket"],
  },
  {
    title: "Outerwear & jackets",
    items: [
      "The Iconic Jacket",
      "The Wool Zip Shacket",
      "The Seersucker Jacket",
      "The Flannel Bomber",
      "The First-class Jacket",
      "The Downtown Jacket",
    ],
  },
  {
    title: "Shorts",
    items: [
      "The Originals",
      "The Short Linens",
      "The Short Easies",
      "The Short Cords",
      "The Short Tennies",
      "The Short Vacays",
      "The Short Linens",
      "The First Originals",
      "The Short Seersuckers",
      "The Sports",
      { label: "The Short Weekenders", badge: "New" },
      "The Short Classics",
    ],
  },
  {
    title: "Swims",
    items: [
      "The Print Swims",
      "The Short Swims",
      "The Big Stripes Swims",
      "The Seersucker Swims",
      "The Juniors",
    ],
  },
  {
    title: "Shoes",
    items: ["The Boat Sneakers", "The Suede Sneakers", "The Classic Sneakers"],
  },
  {
    title: "Accessories",
    items: [
      { label: "The Beach Towel", badge: "New" },
      "The Stretch Belt",
      "The Beanies",
    ],
  },
];
