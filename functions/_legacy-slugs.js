/**
 * Memorial slugs that Search Console still requests and that are no longer
 * listed products. Each one 301s to the matching catalogue filter.
 * A removed design with no matching type is 410.
 *
 * Live products are checked first. A slug in this map is only used when
 * Supabase confirms it is not a listed product.
 */

export const LEGACY_SLUGS = {
  "tapered-churchyard-memorial": "/memorials?type=churchyard-memorials",
  "ogee-cremation-memorial": "/memorials?type=cremation-memorials",
  "companion-heart-memorial": "/memorials?type=heart-memorials",
  "all-polished-lawn-memorial": "/memorials?type=lawn-headstones",
  "boulder-memorial": 410,
  "heart-childrens-memorial": "/memorials?type=childrens-memorials",
  "star-childrens-memorial": "/memorials?type=childrens-memorials",
  "the-silverstone": 410,
};

export function legacySlugStatus(slug) {
  if (!Object.prototype.hasOwnProperty.call(LEGACY_SLUGS, slug)) return null;
  return LEGACY_SLUGS[slug];
}
