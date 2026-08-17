// Hidden server step: the webpage talks to this file, and this file talks to Airtable.
// The Airtable secret stays on Vercel. Visitors never see it.

const LIMITS = {
  fullName: 100,
  email: 160,
  company: 120,
  role: 120,
  workflow: 1200,
  tools: 400,
  frequency: 80,
  teamSize: 40,
  outcome: 800,
  timeline: 80,
  source: 500,
  pageUrl: 1000,
  utmSource: 200,
  utmMedium: 200,
  utmCampaign: 200,
  successSignal: 800,
  failureMode: 600
};

const TEXT_FIELDS = Object.keys(LIMITS);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME || "Leads";

  if (!token || !baseId) {
    res.status(503).json({ error: "Airtable is not connected yet." });
    return;
  }

  try {
    const payload = readBody(req);

    // Bots often fill a hidden field. Ignore those quietly.
    if (clean(payload.website, 200)) {
      res.status(200).json({ ok: true });
      return;
    }

    const lead = validateLead(payload);
    await upsertLead(lead, { token, baseId, tableName });
    res.status(200).json({ ok: true });
  } catch (error) {
    const status = error.status || 400;
    res.status(status).json({
      error: error.message || "Unable to save inquiry."
    });
  }
}

function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  const raw = Buffer.isBuffer(req.body)
    ? req.body.toString("utf8")
    : String(req.body || "");

  if (!raw.trim()) throw Object.assign(new Error("Missing request body."), { status: 400 });

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 });
  }
}

function validateLead(payload) {
  const lead = {};
  TEXT_FIELDS.forEach((key) => {
    lead[key] = clean(payload[key], LIMITS[key]);
  });

  lead.submittedAt = validIsoDate(payload.submittedAt)
    ? payload.submittedAt
    : new Date().toISOString();
  lead.receivedAt = new Date().toISOString();
  lead.consent = payload.consent === true || payload.consent === "true";
  lead.status = payload.status === "complete" ? "complete" : "partial";
  lead.lastStep = clean(payload.lastStep, 8);

  if (!lead.fullName) throw Object.assign(new Error("Full name is required."), { status: 400 });
  if (!lead.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    throw Object.assign(new Error("A valid email is required."), { status: 400 });
  }

  if (lead.status === "partial") return lead;

  if (!lead.role) throw Object.assign(new Error("Profession or role is required."), { status: 400 });
  if (lead.workflow.length < 20) {
    throw Object.assign(new Error("Workflow description must be at least 20 characters."), { status: 400 });
  }
  if (!lead.frequency) throw Object.assign(new Error("Workflow frequency is required."), { status: 400 });
  if (!lead.outcome) throw Object.assign(new Error("Desired outcome is required."), { status: 400 });
  if (!lead.consent) throw Object.assign(new Error("Contact consent is required."), { status: 400 });

  return lead;
}

function clean(value, maxLength) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function validIsoDate(value) {
  if (typeof value !== "string" || value.length > 40) return false;
  return !isNaN(Date.parse(value));
}

function formulaEscape(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function fieldsFromLead(lead, merge) {
  const fields = {};
  Object.keys(lead).forEach((key) => {
    const value = lead[key];
    if (value === undefined) return;
    if (merge && value !== false && String(value).trim() === "") return;
    if (merge && key === "consent" && value === false) return;
    fields[key] = value;
  });
  return fields;
}

async function airtable(path, { token, method, body }) {
  const response = await fetch(`https://api.airtable.com/v0/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.error && data.error.message ? data.error.message : "Airtable request failed.";
    throw Object.assign(new Error(detail), { status: 502 });
  }
  return data;
}

async function upsertLead(lead, config) {
  const tablePath = `${config.baseId}/${encodeURIComponent(config.tableName)}`;
  const email = formulaEscape(lead.email.toLowerCase());
  const found = await airtable(
    `${tablePath}?filterByFormula=${encodeURIComponent(`LOWER({email})='${email}'`)}&maxRecords=20`,
    { token: config.token, method: "GET" }
  );

  const records = found.records || [];
  const openRow = [...records].reverse().find((row) => {
    const status = row.fields && row.fields.status;
    return status !== "complete";
  });

  if (lead.status === "complete") {
    const recentComplete = records.find((row) => {
      if (!row.fields || row.fields.status !== "complete" || !row.createdTime) return false;
      return Date.now() - Date.parse(row.createdTime) < 5 * 60 * 1000;
    });
    if (recentComplete) {
      throw Object.assign(new Error("A recent inquiry already exists for this email."), { status: 429 });
    }
  }

  const fields = fieldsFromLead(lead, Boolean(openRow));

  if (openRow) {
    await airtable(`${tablePath}/${openRow.id}`, {
      token: config.token,
      method: "PATCH",
      body: { fields, typecast: true }
    });
    return;
  }

  await airtable(tablePath, {
    token: config.token,
    method: "POST",
    body: { fields, typecast: true }
  });
}
