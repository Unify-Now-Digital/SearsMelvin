const INTERNAL_EMAILS = new Set(["admin@unifynow.digital"]);

const text = (value) => typeof value === "string" ? value.trim() : "";

export function isTestSubmission(input = {}) {
  const reasons = [];
  const names = [input.name, input.firstName, input.lastName].map(text).filter(Boolean);
  if (names.some((value) => /(^|[^a-z])test(?=$|[^a-z])/i.test(value))) reasons.push("test_name");

  const email = text(input.email).toLowerCase();
  if (email.includes("@")) {
    const [local, domain] = email.split("@");
    if (local === "test" || local.includes("+qa") || local.includes("+test") || local.includes("test+")) reasons.push("test_email_local");
    if (domain === "example.com" || domain === "test.com") reasons.push("test_email_domain");
    if (INTERNAL_EMAILS.has(email)) reasons.push("internal_email");
    if (local === "info+qa") reasons.push("qa_info_email");
  }

  const startsTest = (value) => /^test/i.test(text(value));
  if ([input.gclid, input.gbraid, input.wbraid, input.utm_campaign, input.utm_source].some(startsTest)) reasons.push("test_tracking_value");
  if ([input.utm_source, input.utm_campaign].some((value) => /^(qa|test)$/i.test(text(value)))) reasons.push("test_utm_marker");

  return { is_test: reasons.length > 0, reasons: [...new Set(reasons)] };
}
