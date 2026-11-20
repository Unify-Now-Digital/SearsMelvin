/**
 * Memorial categories. /memorials/type/<slug> 301s to /memorials?type=<slug>.
 * The range page reads that query and checks the matching filter.
 * These slugs are the public URLs. Names here match the footer links.
 */

export const CATEGORIES = [
  { slug: "lawn-headstones", name: "Lawn headstones" },
  { slug: "kerb-sets", name: "Kerb sets" },
  { slug: "heart-memorials", name: "Heart memorials" },
  { slug: "book-memorials", name: "Book memorials" },
  { slug: "churchyard-memorials", name: "Churchyard memorials" },
  { slug: "cremation-memorials", name: "Cremation memorials" },
  { slug: "childrens-memorials", name: "Children's memorials" },
];

const BY_SLUG = new Map(CATEGORIES.map((category) => [category.slug, category]));

export function categoryBySlug(slug) {
  return BY_SLUG.get(String(slug || "").toLowerCase()) || null;
}
