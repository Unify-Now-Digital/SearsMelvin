// Billable inscription length: Unicode letters and digits only.
// Spaces, newlines, and punctuation are free.
// memorial.html keeps an identical copy of this function. The page is a
// classic script with no bundler, so tests/inscription-billable-count.mjs
// asserts the two copies stay in step.

export function countBillableInscriptionChars(text) {
  if (typeof text !== "string" || !text) return 0;
  const matches = text.match(/\p{L}|\p{N}/gu);
  return matches ? matches.length : 0;
}
