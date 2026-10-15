const MAX_REPORT_BYTES = 16 * 1024;
const REPORT_TYPES = ["application/csp-report", "application/reports+json"];

function documentPath(value) {
  if (!value) return "";
  try {
    return new URL(value).pathname;
  } catch {
    return String(value).split(/[?#]/, 1)[0];
  }
}

function summarise(payload) {
  const reports = Array.isArray(payload) ? payload : [payload];
  return reports.slice(0, 20).map((entry) => {
    const report = entry?.["csp-report"] || entry?.body || entry || {};
    return {
      blocked: report["blocked-uri"] || report.blockedURL || "",
      directive: report["violated-directive"] || report.effectiveDirective || "",
      document: documentPath(report["document-uri"] || report.documentURL),
    };
  });
}

async function readReport(request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;

  while (length < MAX_REPORT_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = MAX_REPORT_BYTES - length;
    chunks.push(value.subarray(0, remaining));
    length += Math.min(value.byteLength, remaining);
    if (value.byteLength > remaining || length === MAX_REPORT_BYTES) {
      await reader.cancel();
      break;
    }
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function onRequestPost({ request }) {
  const contentType = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (!REPORT_TYPES.includes(contentType)) return new Response(null, { status: 415 });

  try {
    const payload = await readReport(request);
    console.log(JSON.stringify({ csp: summarise(payload) }));
  } catch {
    // Reports are best-effort telemetry. Malformed or truncated JSON is discarded.
  }
  return new Response(null, { status: 204 });
}

function methodNotAllowed() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export const onRequestGet = methodNotAllowed;
export const onRequestHead = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
export const onRequestOptions = methodNotAllowed;
