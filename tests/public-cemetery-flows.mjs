import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [memorial, contact, permit] = await Promise.all([
  readFile(new URL("../memorial.html", import.meta.url), "utf8"),
  readFile(new URL("../contact.html", import.meta.url), "utf8"),
  readFile(new URL("../permit-checker.html", import.meta.url), "utf8"),
]);

assert.match(memorial, /new PlaceAutocompleteElement\(\{[\s\S]*includedRegionCodes: \['gb'\]/);
assert.match(memorial, /includedPrimaryTypes: \['cemetery'\]/);
assert.match(memorial, /addEventListener\('gmp-select'/);
assert.match(memorial, /addEventListener\('gmp-error'[\s\S]*replaceChild\(oldInput, autocomplete\)/);
assert.doesNotMatch(memorial, /gmp-placeselect|new google\.maps\.places\.Autocomplete/);
assert.match(memorial, /event\.preventDefault\(\)[\s\S]*input\.readOnly = true/);
assert.match(memorial, /\.quote-overlay \{ align-items: flex-start; overflow-y: auto; \}/);
assert.match(memorial, /matchMedia\('\(max-width: 600px\)'\)[\s\S]*setupMobilePlaces/);
assert.match(memorial, /AutocompleteSuggestion\.fetchAutocompleteSuggestions\(\{[\s\S]*includedPrimaryTypes: \['cemetery'\]/);
assert.match(memorial, /loading=async&callback=_onMapsReady/);
assert.match(memorial, /if \(params\.get\('preview'\) === '1'\) \{[\s\S]*fetch\('\/api\/admin'/);
assert.match(memorial, /if \(banner\) banner\.style\.display = 'none';[\s\S]*try \{ localStorage\.setItem\('cookieConsent'/);
assert.match(memorial, /organization_id=eq\./);
assert.match(memorial, /is_test=eq\.false/);

assert.match(contact, /CEMETERY: SUPABASE LIST/);
assert.doesNotMatch(contact, /PlaceAutocompleteElement|maps\.googleapis\.com/);
assert.match(contact, /cemetery_id: contactSelectedCemeteryId/);
assert.match(contact, /The cemetery list is unavailable; you can still type its name\./);
assert.match(contact, /organization_id=eq\.3770972d-1bbd-417b-b413-297e844db285/);

assert.doesNotMatch(permit, /PlaceAutocompleteElement|maps\.googleapis\.com/);
assert.match(permit, /if \(!rows\.length\) throw new Error\('anonymous cemetery query returned no rows'\)/);
assert.match(permit, /organization_id=eq\.3770972d-1bbd-417b-b413-297e844db285/);

console.log("public cemetery flow tests passed");
