# SEO Action Plan — Sears Melvin

**Based on:** SEO Audit dated 9 May 2026
**Scope:** 90 days — Quick wins → Local SEO → Content engine
**Goal:** Balanced local lead generation + organic traffic growth across Greater London

Each item includes a plain-English explanation of what it is, why it's good, and why it matters for Sears Melvin specifically.

---

## Phase 1 — Quick Wins (Weeks 1–2)

### Fix 17 broken internal links to `/cdn-cgi/l/email-protection`
**ELI5:** Cloudflare has a feature that scrambles email addresses on the page so spam bots can't harvest them. When a real human clicks the link, Cloudflare unscrambles it via a route at `/cdn-cgi/l/email-protection`. That route is currently 404'ing on every major page (homepage, all area pages, memorials, FAQ, care guide, contact) — meaning Cloudflare's email obfuscation is enabled but the route isn't resolving, or the site has moved off Cloudflare and the obfuscated links are still baked into the HTML.
**Why it matters for us:** 17 broken internal links sitewide is a Semrush "Error" — Google sees the same 404s and treats them as poor maintenance. It also breaks the customer email path: a bereaved family clicks "email us" and lands on a 404. In funeral services, those visitors don't retry — they call the next mason. Recommended fix: disable Cloudflare's "Email Address Obfuscation" (Scrape Shield → off) and replace the mailto with a contact form on the Contact page for spam protection.

### Remove `Stop Claude` line from robots.txt
**ELI5:** robots.txt is a sign on the website's front door telling search engines what they can and can't look at. There's a graffiti-style line that doesn't mean anything in the standard "language" search engines speak.
**Why it matters for us:** harmless today, but a stricter parser could throw an error. Keep the front door tidy.

### Set `/quote` to `noindex` and remove from public sitemap
**ELI5:** the sitemap is the list of pages we're inviting Google to put in its phone book. `/quote` is a private "track my order" page — useful for existing customers but useless to a stranger searching Google.
**Why it matters for us:** Google rewards sites where every listed page has a clear purpose for new visitors. Including a tracking page dilutes that signal and can mean a real customer lands on a confusing page from a search result. Keep it linked from the footer "track order" and from order confirmation emails.

### Trim Resources meta description to ≤160 characters
**ELI5:** the meta description is the little blurb under our link in Google. Google chops it off mid-sentence if it's too long.
**Why it matters for us:** a sentence ending "…step-by-step guidance for arranging a hea…" looks unprofessional in front of someone choosing a memorial mason in a vulnerable moment. Tight blurbs convert better.

### Add `aria-label` to the 4 unlabelled icon links
**ELI5:** these are buttons (probably social or icon links) that have a picture but no text underneath. Screen readers and search engines literally see "link → ???".
**Why it matters for us:** accessibility law (UK Equality Act / WCAG) matters in the funeral sector where elderly and bereaved users are common. It's also a small SEO and trust signal.

### Convert PNG product images to WebP
**ELI5:** PNG and WebP are both image formats. WebP files are roughly 30–50% smaller for the same visual quality, so pages load faster.
**Why it matters for us:** the products page has 24 PNGs of memorials. On a slow mobile connection at a graveside or in a care home, a slow page loses the lead. Google also uses page speed as a ranking factor.

### Rewrite homepage and Contact H1s to be keyword-led
**ELI5:** the H1 is the biggest headline on the page — Google treats it like the title of a chapter. The current homepage H1 *"Crafting meaningful tributes…"* is beautiful but tells Google nothing about what we sell.
**Why it matters for us:** when someone Googles "headstone makers London", Google needs to see those words somewhere prominent on the page. We can keep the emotional line as a sub-heading so the brand voice survives — we don't have to choose between heart and traffic.

### Rebalance homepage copy for *headstone*, *gravestone*, *monument*
**ELI5:** the homepage says "memorial" 37 times but barely mentions "headstone", and never says "gravestone" or "monument" — even though those are the words customers actually type into Google.
**Why it matters for us:** every time someone searches "gravestones near me" and we don't appear, that's a competitor getting the call. Not keyword stuffing — just using the words customers already use.

### Data analysis — by end of Week 2
**ELI5:** before deciding which London boroughs to build pages for and what blog topics to write, look at the data: which queries are people already finding us through, which ones are competitors stealing, and which boroughs have the biggest opportunity?
**Why it matters for us:** building 32 borough pages on a hunch could waste two months. Looking at GSC, GA4, and Ahrefs/SEMrush first means we build the 8–10 boroughs that will actually generate leads. Output: borough tier list + content cadence proposal.

---

## Phase 2 — Local SEO (Weeks 3–6)

### Add full `PostalAddress` to global Stonemason schema
**ELI5:** schema is invisible code that tells Google "I am a business at this address, with these hours, in these areas." Right now the code says everything except the actual address.
**Why it matters for us:** for a local trade like memorial masonry, the address is the single most important piece of local SEO data. Without it, Google is less likely to show us in the local "map pack" — the boxed results at the top of Google with three businesses and a map. That box is where most local leads click.

### Upgrade area pages to `LocalBusiness` schema with geo-coordinates
**ELI5:** right now the Barnet page schema says "we're a memorial mason." We want it to say "we're a memorial mason serving Barnet at these coordinates with this catchment area."
**Why it matters for us:** when someone in Barnet searches "memorial mason near me", Google does literal distance maths using coordinates. Without geo-coordinates on the page, we might be invisible to a customer two streets away.

### Add `ContactPoint` to Contact page schema
**ELI5:** a structured way of telling Google "this is the phone number, this is the email, these are the languages we speak."
**Why it matters for us:** lets Google show the phone number directly in search results — meaning a bereaved family member can call us with one tap from the search page, without even visiting the website.

### Scaffold `sameAs` array (with GBP slot ready)
**ELI5:** `sameAs` is where we tell Google "this website, this Facebook page, this Instagram, and this Google Business Profile are all the same business." We prep this now so the moment GBP verifies in ~4 weeks, we drop the URL in.
**Why it matters for us:** Google's confidence in a local business goes up a lot when it can cross-reference the same NAP (Name, Address, Phone) across multiple sources. More confidence → better rankings.

### Build NAP citations across UK directories
**ELI5:** the business name, address and phone need to be listed identically on Yell, Bing Places, Thomson Local, Free Index, Apple Maps, etc. Each one is a "vote" that we exist and are who we say we are.
**Why it matters for us:** Google trusts businesses it can find in 10 reputable places more than businesses it only finds on their own website. Citations take 4–6 weeks to fully propagate, so starting now means they're ready when GBP verifies.

### Plan `aggregateRating` schema for after GBP + reviews are live
**ELI5:** this is what makes those gold star ratings appear under our link in Google. We can only legitimately use it when there's a real, verifiable source of reviews.
**Why it matters for us:** stars in search results dramatically increase click-through rate. In a sensitive industry like ours, third-party social proof matters even more — bereaved families are vetting carefully.

### Borough rollout — Tier 1 first, Tier 2 informed by Week 2 data
**ELI5:** instead of building 32 thin, near-identical "memorial mason in [borough]" pages (which Google may flag as low-quality and bury), we build deep, genuinely useful pages for the boroughs we serve, then expand outward based on real search demand.
- **Tier 1** — boroughs we actively service: full pages with cemetery names, permit specifics, geo schema, ~600–900 words.
- **Tier 2** — boroughs we'll travel to: lighter pages from a structured template with ≥1 unique local element each, ~300–400 words.
- **Tier 3** — aspirational coverage: skip until demand justifies, or roll into a single "We serve all London boroughs" hub.

**Why it matters for us:** quality over quantity. One excellent Camden page outranks five mediocre ones. Google's "Helpful Content" system actively penalises sites that pump out templated location pages.

### Add a "London hub" page in primary navigation
**ELI5:** right now the borough pages are buried — Google has to dig to find them. Adding a top-level "Areas We Serve" link in the main menu pushes "link equity" (SEO power) down to all of them.
**Why it matters for us:** the homepage is our most powerful page. Right now it shares almost none of that power with the local landing pages. One nav link fixes that for every borough we build.

### GBP activation when verification lands (~Week 5–6)
**ELI5:** Google Business Profile is the listing that creates the side-panel on Google with hours, photos, reviews, and phone number. It's free and it's the single biggest local SEO lever we have.
**Why it matters for us:** for a London memorial mason, GBP often drives more leads than the website itself. The day it verifies: drop the URL into `sameAs`, start collecting Google reviews systematically (post-installation email with one-tap review link), and unlock `aggregateRating` schema.

---

## Phase 3 — Content Engine (Weeks 7–12)

### Launch a guides/blog hub at the cadence locked in Week 2
**ELI5:** static pages (homepage, memorials page, etc.) can only rank for a fixed set of keywords. A blog or guides section lets us rank for hundreds more — every question a customer might ask becomes a page.
**Why it matters for us:** "how long does a headstone take to make", "do I need permission for a kerb set in Highgate cemetery", "how to clean a marble headstone" — these are real searches with no ad competition. Each guide is a fishing line in the water for a different long-tail query, and they compound over time.

### Cornerstone piece per month + 2 supporting pieces
**ELI5:** the cornerstone is a flagship 2,000+ word definitive guide (e.g., a London-wide cemetery permit guide). The supporting pieces are shorter, more specific, and link back to the cornerstone.
**Why it matters for us:** Google rewards sites that demonstrate topical authority — going deep on a subject. One borough-by-borough cemetery permit guide could become the de facto reference for the whole sector and earn unsolicited backlinks.

### Add social profile links to footer + `sameAs`
**ELI5:** even with minimal posting, having social profiles linked from the site makes the business look real, established and trustworthy.
**Why it matters for us:** in this sector, families often vet a memorial mason carefully before contacting. The absence of any social presence is a small red flag. Even minimal Facebook and Instagram pages with consistent NAP help.

### Pursue 3–5 outbound editorial links from bereavement/legal/funeral sites
**ELI5:** when other reputable websites link to us, Google treats it like a referral — a vote of confidence from one expert to another. Right now we have one external link out (to Cruse) and likely very few coming in.
**Why it matters for us:** backlinks are still the strongest ranking signal in SEO. Three good links from funeral directors, bereavement charities, or legal sites covering wills/probate would put us ahead of most competitors locally.

### Internal linking pass
**ELI5:** every blog post should link to at least one relevant borough page and one relevant service page, like a librarian connecting books on related topics.
**Why it matters for us:** this turns informational traffic (someone reading a grief guide) into commercial traffic (clicking through to a Camden memorial page, then to a quote form). Without internal links, content sits in isolation and never converts.

---

## Tracking & Review Checkpoints

### Week 2 — Data review
**ELI5:** before committing to which boroughs and which content, look at the actual numbers from GSC, GA4, and Ahrefs/SEMrush.
**Why it matters for us:** prevents two months of building the wrong thing.

### Week 6 — GBP activation + Phase 2 retro
**ELI5:** the moment GBP verifies, several things switch on at once (sameAs, review collection, aggregateRating prep). We also check Phase 2 worked as expected.
**Why it matters for us:** GBP going live is the single highest-impact moment in this plan. Make sure everything connects to it cleanly.

### Week 12 — Full re-audit
**ELI5:** rerun the same audit that produced this report and compare side-by-side.
**Why it matters for us:** proves which actions moved the needle, exposes anything that regressed, and sets the priorities for the next 90 days.
