export type ProductTypeId = "clothing" | "shoe" | "hat" | "accessory" | "bag";

export type AttributeField = {
  id: string;
  label: string;
  type: "text" | "number" | "select" | "textarea";
  unit?: string;
  placeholder?: string;
  options?: string[];
  required?: boolean;
};

export type AttributeGroup = { id: string; title: string; description: string; fields: AttributeField[] };

export type SizeColumn = { id: "size" | "chest" | "shoulder" | "length" | "sleeve"; label: string; unit?: string };

export type ProductTypeDefinition = {
  id: ProductTypeId;
  label: string;
  description: string;
  example: string;
  groups: AttributeGroup[];
  sizeColumns: SizeColumn[];
  defaultSizes: string[];
};

export const PRODUCT_TYPES: ProductTypeDefinition[] = [
  {
    id: "clothing",
    label: "لباس",
    description: "پیراهن، کت، شلوار، مانتو و پوشاک",
    example: "ترکیب الیاف، تن‌خور، یقه و آستین",
    groups: [
      { id: "material", title: "پارچه و ساخت", description: "اطلاعاتی که تصمیم خرید و نگهداری لباس را ساده می‌کند.", fields: [
        { id: "composition", label: "ترکیب الیاف", type: "text", placeholder: "مثلاً ۷۰٪ پشم، ۳۰٪ ویسکوز", required: true },
        { id: "fabric", label: "نوع پارچه", type: "text", placeholder: "مثلاً فاستونی" },
        { id: "fabricWeight", label: "وزن یا ضخامت پارچه", type: "select", options: ["سبک", "متوسط", "سنگین"] },
        { id: "stretch", label: "کشسانی", type: "select", options: ["بدون کشسانی", "کم", "متوسط", "زیاد"] },
        { id: "lining", label: "آستر", type: "text", placeholder: "جنس و میزان آسترکشی" },
      ]},
      { id: "fit", title: "فرم و جزئیات", description: "فرم پوشیدن و جزئیات قابل مشاهده محصول.", fields: [
        { id: "fit", label: "تن‌خور", type: "select", options: ["جذب", "راسته", "آزاد", "اورسایز"] },
        { id: "cut", label: "نوع برش", type: "text" },
        { id: "collar", label: "نوع یقه", type: "text" },
        { id: "sleeve", label: "نوع آستین", type: "text" },
        { id: "closure", label: "نوع بسته‌شدن", type: "text" },
      ]},
      { id: "origin", title: "نگهداری و تولید", description: "اطلاعات تکمیلی قابل نمایش در صفحه محصول.", fields: [
        { id: "season", label: "فصل پیشنهادی", type: "text" },
        { id: "country", label: "کشور تولید", type: "text" },
        { id: "care", label: "روش نگهداری و شست‌وشو", type: "textarea" },
      ]},
    ],
    sizeColumns: [
      { id: "size", label: "سایز" }, { id: "chest", label: "دور سینه", unit: "cm" },
      { id: "shoulder", label: "عرض شانه", unit: "cm" }, { id: "length", label: "قد", unit: "cm" },
      { id: "sleeve", label: "آستین", unit: "cm" },
    ],
    defaultSizes: ["S", "M", "L", "XL"],
  },
  {
    id: "shoe",
    label: "کفش",
    description: "کفش روزمره، رسمی، بوت و کتانی",
    example: "رویه، زیره، ارتفاع پاشنه و طول پا",
    groups: [
      { id: "construction", title: "ساخت کفش", description: "مواد و ساختار اجزای اصلی کفش.", fields: [
        { id: "upperMaterial", label: "جنس رویه", type: "text", required: true },
        { id: "liningMaterial", label: "جنس آستر داخلی", type: "text" },
        { id: "outsoleMaterial", label: "جنس زیره", type: "text", required: true },
        { id: "insole", label: "کفی", type: "text" },
        { id: "closure", label: "نوع بسته‌شدن", type: "select", options: ["بندی", "زیپی", "سگکی", "کشی", "بدون بست"] },
      ]},
      { id: "shape", title: "فرم و اندازه", description: "ویژگی‌هایی که روی راحتی و انتخاب سایز اثر دارند.", fields: [
        { id: "toeShape", label: "فرم پنجه", type: "select", options: ["گرد", "مربعی", "نوک‌تیز", "پهن"] },
        { id: "heelHeight", label: "ارتفاع پاشنه", type: "number", unit: "cm" },
        { id: "shaftHeight", label: "ارتفاع ساق", type: "number", unit: "cm" },
        { id: "width", label: "عرض قالب", type: "select", options: ["باریک", "استاندارد", "پهن"] },
      ]},
      { id: "origin", title: "نگهداری و تولید", description: "روش مراقبت و محل تولید.", fields: [
        { id: "country", label: "کشور تولید", type: "text" },
        { id: "care", label: "روش نگهداری", type: "textarea" },
      ]},
    ],
    sizeColumns: [{ id: "size", label: "سایز EU" }, { id: "chest", label: "طول پا", unit: "cm" }],
    defaultSizes: ["۳۸", "۳۹", "۴۰", "۴۱", "۴۲", "۴۳"],
  },
  {
    id: "hat",
    label: "کلاه",
    description: "کپ، فدورا، بافت و کلاه‌های کلاسیک",
    example: "دور سر، تاج، لبه و ساختار",
    groups: [
      { id: "construction", title: "جنس و ساخت", description: "مواد و فرم اصلی کلاه.", fields: [
        { id: "material", label: "جنس", type: "text", required: true },
        { id: "structure", label: "ساختار", type: "select", options: ["نرم", "نیمه‌ساختارمند", "ساختارمند"] },
        { id: "lining", label: "آستر", type: "text" },
        { id: "adjustment", label: "تنظیم اندازه", type: "text" },
      ]},
      { id: "measurements", title: "ابعاد", description: "اندازه‌های مخصوص کلاه.", fields: [
        { id: "headCircumference", label: "دور سر", type: "number", unit: "cm" },
        { id: "crownHeight", label: "ارتفاع تاج", type: "number", unit: "cm" },
        { id: "brimWidth", label: "عرض لبه", type: "number", unit: "cm" },
        { id: "care", label: "روش نگهداری", type: "textarea" },
      ]},
    ],
    sizeColumns: [{ id: "size", label: "سایز" }, { id: "chest", label: "دور سر", unit: "cm" }],
    defaultSizes: ["S", "M", "L"],
  },
  {
    id: "accessory",
    label: "اکسسوری",
    description: "کمربند، عینک، شال، زیورآلات و اکسسوری",
    example: "جنس، ابعاد، یراق و وزن",
    groups: [
      { id: "details", title: "مشخصات اکسسوری", description: "ویژگی‌های عمومی و ابعادی این اکسسوری.", fields: [
        { id: "material", label: "جنس اصلی", type: "text", required: true },
        { id: "dimensions", label: "ابعاد", type: "text", placeholder: "طول × عرض × ارتفاع" },
        { id: "hardware", label: "جنس یراق", type: "text" },
        { id: "closure", label: "نوع بسته‌شدن", type: "text" },
        { id: "weight", label: "وزن", type: "number", unit: "g" },
        { id: "care", label: "روش نگهداری", type: "textarea" },
      ]},
    ],
    sizeColumns: [{ id: "size", label: "اندازه" }, { id: "length", label: "طول", unit: "cm" }],
    defaultSizes: ["تک‌سایز"],
  },
  {
    id: "bag",
    label: "کیف",
    description: "کیف دستی، دوشی، کوله و کیف‌های چرمی",
    example: "بدنه، آستر، بند، جیب‌ها و ابعاد",
    groups: [
      { id: "materials", title: "جنس و اجزا", description: "اطلاعات ساخت و یراق کیف.", fields: [
        { id: "bodyMaterial", label: "جنس بدنه", type: "text", required: true },
        { id: "liningMaterial", label: "جنس آستر", type: "text" },
        { id: "hardware", label: "جنس یراق", type: "text" },
        { id: "closure", label: "نوع بسته‌شدن", type: "text" },
      ]},
      { id: "capacity", title: "ابعاد و ظرفیت", description: "آنچه خریدار برای سنجش فضای کیف نیاز دارد.", fields: [
        { id: "dimensions", label: "ابعاد", type: "text", placeholder: "طول × عرض × ارتفاع" },
        { id: "strap", label: "مشخصات بند", type: "text" },
        { id: "pockets", label: "تعداد و نوع جیب", type: "text" },
        { id: "weight", label: "وزن", type: "number", unit: "g" },
        { id: "care", label: "روش نگهداری", type: "textarea" },
      ]},
    ],
    sizeColumns: [{ id: "size", label: "مدل" }, { id: "length", label: "طول", unit: "cm" }, { id: "chest", label: "عرض", unit: "cm" }, { id: "shoulder", label: "ارتفاع", unit: "cm" }],
    defaultSizes: ["استاندارد"],
  },
];

export function getProductTypeDefinition(id?: string): ProductTypeDefinition {
  return PRODUCT_TYPES.find((item) => item.id === id) ?? PRODUCT_TYPES[0];
}

export function getVisibleAttributes(typeId: string | undefined, values: Record<string, string> = {}) {
  return getProductTypeDefinition(typeId).groups.flatMap((group) => group.fields)
    .map((field) => ({ ...field, value: values[field.id] ?? "" }))
    .filter((field) => field.value.trim());
}
