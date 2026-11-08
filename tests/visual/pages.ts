// The eight baseline pages. Widths are the viewports the capture script uses.
// Heights keep each shot in a normal desktop, tablet, or phone frame.

export type PageSpec = {
  slug: string;
  path: string;
  name: string;
  ready: string;
};

export const PAGES: PageSpec[] = [
  { slug: "home", path: "/", name: "Home", ready: ".hero" },
  { slug: "memorials", path: "/memorials", name: "Memorials list", ready: "a.product-card" },
  {
    slug: "the-castell",
    path: "/memorials/the-castell",
    name: "Product: The Castell (lawn headstone)",
    ready: "#productName",
  },
  {
    slug: "the-hartwell",
    path: "/memorials/the-hartwell",
    name: "Product: The Hartwell (kerb set)",
    ready: "#productName",
  },
  {
    slug: "the-petworth-heart",
    path: "/memorials/the-petworth-heart",
    name: "Product: The Petworth Heart",
    ready: "#productName",
  },
  { slug: "quote", path: "/quote", name: "Quote page", ready: "#lookupEmail" },
  { slug: "contact", path: "/contact", name: "Contact and showroom", ready: "#contactForm" },
  { slug: "about", path: "/about", name: "About", ready: "h1" },
];

export const WIDTHS = [
  { name: "1280", width: 1280, height: 800 },
  { name: "744", width: 744, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

export const PHONE_TEXT = "020 3835 2548";
export const GTM_ID = "GTM-KRDX4BQ5";
export const GA4_ID = "G-RF3LYJMFVE";

export function baseUrl(): string {
  return (process.env.BASE_URL || "https://searsmelvin.co.uk").replace(/\/$/, "");
}
