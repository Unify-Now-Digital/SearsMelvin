/**
 * Shared Stonemason JSON-LD.
 * Showroom coordinates from https://api.postcodes.io/postcodes/NW116LB
 * (latitude 51.58619, longitude -0.183617), rounded to 5 decimal places.
 * sameAs is omitted: no candidate URL both returned HTTP 200 and named
 * Sears Melvin as the register entry or an official profile. Google Business
 * Profile URL is unknown. Sears Melvin is not a NAMM member.
 */

export const BUSINESS_DESCRIPTION = "Memorial masons crafting headstones, gravestones and kerb sets. Permit handling, cemetery liaison, and installation across Greater London and surrounds.";

export const HAS_MAP = "https://www.google.com/maps/search/?api=1&query=1+The+Market+Place+Falloden+Way+London+NW11+6LB";

export const AREA_SERVED = [
  { "@type": "AdministrativeArea", name: "Greater London" },
  { "@type": "AdministrativeArea", name: "Hertfordshire" },
  { "@type": "AdministrativeArea", name: "Essex" },
  { "@type": "AdministrativeArea", name: "Kent" },
  { "@type": "AdministrativeArea", name: "Surrey" },
  { "@type": "AdministrativeArea", name: "Buckinghamshire" },
  { "@type": "AdministrativeArea", name: "Berkshire" },
];

export function businessJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Stonemason",
    "@id": "https://searsmelvin.co.uk/#business",
    name: "Sears Melvin Memorials",
    alternateName: "Sears Melvin",
    description: BUSINESS_DESCRIPTION,
    image: "https://searsmelvin.co.uk/images/brand/share-card.jpg",
    logo: "https://searsmelvin.co.uk/images/brand/logo/favicon/icon-512.png",
    url: "https://searsmelvin.co.uk",
    telephone: "+442038352548",
    email: "info@searsmelvin.co.uk",
    priceRange: "££",
    address: {
      "@type": "PostalAddress",
      streetAddress: "1 The Market Place, Falloden Way",
      addressLocality: "London",
      postalCode: "NW11 6LB",
      addressCountry: "GB",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: 51.58619,
      longitude: -0.18362,
    },
    hasMap: HAS_MAP,
    areaServed: AREA_SERVED,
    openingHoursSpecification: [{
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "10:00",
      closes: "15:00",
    }],
  };
}
