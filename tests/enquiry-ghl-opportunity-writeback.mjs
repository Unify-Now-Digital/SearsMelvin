import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { upsertWebsiteOpportunity } from "../functions/api/_ghl-opportunity.js";
import {
  createGHLOpportunity,
  saveEnquiryGhlOpportunityId,
} from "../functions/api/submit.js";

const realFetch = globalThis.fetch;
const realError = console.error;
const realWarn = console.warn;
const env = {
  GHL_API_KEY: "test",
  GHL_LOCATION_ID: "loc",
  GHL_PIPELINE_ID: "pipe",
  GHL_PIPELINE_STAGE_ID: "new",
  SUPABASE_URL: "https://db.example",
  SUPABASE_SERVICE_KEY: "service-key",
};
const args = {
  contactId: "contact-1",
  name: "Website enquiry",
  monetaryValue: 100,
  pipelineId: "pipe",
  defaultStageId: "new",
  enquiry: { type: "enquiry" },
  submittedAt: new Date("2026-11-22T10:00:00.000Z"),
};

try {
  // Successful idempotent write-back includes the row id and sync timestamp.
  {
    const calls = [];
    const now = () => new Date("2026-11-22T12:34:56.000Z");
    const status = await saveEnquiryGhlOpportunityId(env, "enquiry/1", 123, {
      now,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(null, { status: 204 });
      },
    });
    assert.equal(status, "saved");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /enquiries\?id=eq\.enquiry%2F1&ghl_opportunity_id=is\.null$/);
    assert.equal(calls[0].init.method, "PATCH");
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      ghl_opportunity_id: "123",
      ghl_synced_at: "2026-11-22T12:34:56.000Z",
    });
  }

  // Create, update, returning-customer, and malformed create response ids.
  {
    const run = async (opportunities, writeResponse = Response.json({ opportunity: { id: "created-1" } }, { status: 201 })) => {
      globalThis.fetch = async (url, init = {}) => {
        const value = String(url);
        if (value.includes("/opportunities/search?")) return Response.json({ opportunities });
        if (value.endsWith("/opportunities/") || init.method === "PUT") return writeResponse;
        return Response.json({ ok: true });
      };
      return upsertWebsiteOpportunity(env, args);
    };

    assert.equal((await run([])).opportunityId, "created-1");
    assert.equal((await run([{ id: "open-1", status: "open", pipelineStageId: "stage" }])).opportunityId, "open-1");
    assert.equal((await run([{ id: "won-1", status: "won" }])).opportunityId, null);
    const badJson = new Response("not json", { status: 201 });
    assert.equal((await run([], badJson)).opportunityId, null);
  }

  // A failed GHL create still throws and never reaches the Supabase PATCH.
  {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || "GET" });
      if (String(url).includes("/opportunities/search?")) return Response.json({ opportunities: [] });
      if (String(url).endsWith("/opportunities/")) return new Response(null, { status: 500 });
      throw new Error("unexpected fetch");
    };
    await assert.rejects(
      createGHLOpportunity(env, { ...args, enquiryId: "enquiry-1" }),
      /GHL Opportunity returned 500/,
    );
    assert.equal(calls.some((call) => call.url.includes("/rest/v1/enquiries")), false);
  }

  // Supabase failures remain best-effort, including a missing migration.
  {
    console.error = () => {};
    console.warn = () => {};
    assert.equal(await saveEnquiryGhlOpportunityId(env, "e1", "o1", {
      fetchImpl: async () => new Response(null, { status: 500 }),
    }), "failed");
    assert.equal(await saveEnquiryGhlOpportunityId(env, "e1", "o1", {
      fetchImpl: async () => { throw new Error("offline"); },
    }), "failed");
    assert.equal(await saveEnquiryGhlOpportunityId(env, "e1", "o1", {
      fetchImpl: async () => new Response(
        "PGRST204 Could not find the 'ghl_opportunity_id' column",
        { status: 400 },
      ),
    }), "columns-missing");
  }

  // Missing either id is a true no-op.
  {
    let fetches = 0;
    const fetchImpl = async () => { fetches += 1; return new Response(null, { status: 204 }); };
    assert.equal(await saveEnquiryGhlOpportunityId(env, "e1", null, { fetchImpl }), "skipped");
    assert.equal(await saveEnquiryGhlOpportunityId(env, null, "o1", { fetchImpl }), "skipped");
    assert.equal(fetches, 0);
  }

  // All opportunity-producing paths pass enquiryId; brochure remains note-only.
  {
    const source = readFileSync(new URL("../functions/api/submit.js", import.meta.url), "utf8");
    const calls = [...source.matchAll(/await createGHLOpportunity\(env, \{([\s\S]*?)\n\s*\}\);/g)];
    assert.equal(calls.length, 3);
    for (const call of calls) assert.match(call[1], /\benquiryId\s*,/);
    const syncFunction = source.match(/async function syncEnquiryContact[\s\S]*?\n}\n\nasync function addGhlNote/)?.[0] || "";
    const brochureBranch = syncFunction.match(/if \(isBrochure\) \{([\s\S]*?)\n\s*\} else \{/)?.[1] || "";
    assert.match(brochureBranch, /addGhlNote/);
    assert.doesNotMatch(brochureBranch, /createGHLOpportunity/);
  }
} finally {
  globalThis.fetch = realFetch;
  console.error = realError;
  console.warn = realWarn;
}

console.log("enquiry-ghl-opportunity-writeback: ok");
