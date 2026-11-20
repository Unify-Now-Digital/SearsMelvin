#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isLegacyJwtKey, supabaseKeyHeaders } from "../functions/api/_supabase-keys.js";

const IDS = [
  "72c61a5c-83d4-44dc-9cce-b753f1b9ef6e",
  "0d6f7f8a-ce2e-45de-887e-628de42b3f6e",
  "6a7b17ce-3f71-40c9-82dd-ec0dd5676c6f",
];
const ENQUIRY_ID = "6da8463d-4c44-445d-beb2-f27460b79ecb";
const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
if (!base || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_KEY).");
  process.exit(1);
}

const headers = supabaseKeyHeaders(key, { "Content-Type": "application/json" });
const peopleFilter = `id=in.(${IDS.join(",")})`;
const getJson = async (url, options = {}) => {
  const response = await fetch(url, { headers, ...options });
  if (!response.ok) throw new Error(`Supabase request failed with HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
};
const maskEmail = (email) => {
  const [local = "", domain = ""] = String(email || "").split("@");
  return domain ? `${local.slice(0, 1)}***@${domain}` : "";
};

const peopleUrl = `${base}/rest/v1/people?${peopleFilter}&select=id,first_name,last_name,email,is_test,created_at`;
const enquiriesUrl = `${base}/rest/v1/enquiries?or=(person_id.in.(${IDS.join(",")}),id.eq.${ENQUIRY_ID})&select=*`;
const [people, enquiries] = await Promise.all([getJson(peopleUrl), getJson(enquiriesUrl)]);

await mkdir(path.resolve("backups"), { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.resolve("backups", `test-flags-${timestamp}.json`);
await writeFile(backupPath, JSON.stringify({ captured_at: new Date().toISOString(), people, enquiries }, null, 2) + "\n", { flag: "wx" });
console.log(`Backup: ${backupPath}`);
console.table(people.map((row) => ({
  id: row.id, name: [row.first_name, row.last_name].filter(Boolean).join(" "),
  email: maskEmail(row.email), before: row.is_test, after: true,
})));

const patchUrl = `${base}/rest/v1/people?${peopleFilter}`;
console.log("PATCH", patchUrl);
console.log('Headers: Prefer: return=representation; Content-Type: application/json; authorization headers omitted');
console.log('Body: {"is_test":true}');
console.log("Rollback commands (restore each backed-up value):");
for (const row of people) {
  const keyExpr = process.env.SUPABASE_SERVICE_KEY ? "$SUPABASE_SERVICE_KEY" : "$SUPABASE_KEY";
  const bearer = isLegacyJwtKey(key) ? ` -H "Authorization: Bearer ${keyExpr}"` : "";
  console.log(`curl -X PATCH "$SUPABASE_URL/rest/v1/people?id=eq.${row.id}" -H "apikey: ${keyExpr}"${bearer} -H "Content-Type: application/json" -d '${JSON.stringify({ is_test: row.is_test })}'`);
}

const applying = process.argv.includes("--apply") && process.env.CONFIRM_TEST_FLAGS === "yes";
if (!applying) {
  console.log("Dry run only. Apply requires both --apply and CONFIRM_TEST_FLAGS=yes.");
  process.exit(0);
}

const updated = await getJson(patchUrl, {
  method: "PATCH",
  headers: { ...headers, Prefer: "return=representation" },
  body: JSON.stringify({ is_test: true }),
});
const verified = await getJson(peopleUrl);
if (verified.length !== IDS.length || verified.some((row) => row.is_test !== true)) {
  throw new Error("Verification failed: not every target row has is_test=true");
}
console.log(`Applied ${updated.length} row(s); re-verification passed.`);
