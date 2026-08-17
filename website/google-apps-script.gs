/**
 * Analyzthis website → Google Sheets lead endpoint.
 *
 * SETUP
 * 1. Create a Google Sheet, then open Extensions → Apps Script.
 * 2. Replace Code.gs with this file and save.
 * 3. Deploy → New deployment → Web app.
 * 4. Execute as: Me. Who has access: Anyone.
 * 5. Copy the /exec URL into GOOGLE_SHEETS_ENDPOINT in website/index.html.
 * 6. Test the form once (not ?form=mock) and confirm a "Leads" tab row is created.
 *
 * The endpoint is public by design. Validation, a honeypot, length limits,
 * formula neutralization, write locking, and a short email rate limit reduce
 * accidental abuse. For high-volume public traffic, add Turnstile/reCAPTCHA
 * or move the endpoint behind a server-side form service.
 */

const SHEET_NAME = 'Leads';
const HEADERS = [
  'submittedAt',
  'receivedAt',
  'fullName',
  'email',
  'company',
  'role',
  'workflow',
  'tools',
  'frequency',
  'teamSize',
  'outcome',
  'timeline',
  'consent',
  'source',
  'pageUrl',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'successSignal',
  'failureMode'
];

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

function doGet() {
  return jsonResponse({ ok: true, service: 'analyzthis-leads' });
}

function doPost(event) {
  try {
    const payload = parsePayload(event);

    // Bots commonly fill fields hidden from human visitors.
    if (clean(payload.website, 200)) {
      return jsonResponse({ ok: true });
    }

    const lead = validateLead(payload);
    const rateLimit = getRateLimit(lead.email);
    appendLead(lead);
    rateLimit.cache.put(rateLimit.key, '1', 300);

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error(error);
    return jsonResponse({
      ok: false,
      error: error && error.message ? error.message : 'Unable to save lead.'
    });
  }
}

function parsePayload(event) {
  if (!event || !event.postData || !event.postData.contents) {
    throw new Error('Missing request body.');
  }

  try {
    return JSON.parse(event.postData.contents);
  } catch (error) {
    throw new Error('Request body must be valid JSON.');
  }
}

function validateLead(payload) {
  const lead = {};
  Object.keys(LIMITS).forEach(function (key) {
    lead[key] = clean(payload[key], LIMITS[key]);
  });

  lead.submittedAt = validIsoDate(payload.submittedAt)
    ? payload.submittedAt
    : new Date().toISOString();
  lead.receivedAt = new Date().toISOString();
  lead.consent = payload.consent === true || payload.consent === 'true';

  if (!lead.fullName) throw new Error('Full name is required.');
  if (!lead.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    throw new Error('A valid email is required.');
  }
  if (!lead.role) throw new Error('Profession or role is required.');
  if (lead.workflow.length < 20) {
    throw new Error('Workflow description must be at least 20 characters.');
  }
  if (!lead.frequency) throw new Error('Workflow frequency is required.');
  if (!lead.outcome) throw new Error('Desired outcome is required.');
  if (!lead.consent) throw new Error('Contact consent is required.');

  return lead;
}

function clean(value, maxLength) {
  if (value === null || value === undefined) return '';

  let normalized = String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);

  // Prevent spreadsheet formula injection without changing displayed text.
  if (/^[=+\-@]/.test(normalized)) normalized = "'" + normalized;
  return normalized;
}

function validIsoDate(value) {
  if (typeof value !== 'string' || value.length > 40) return false;
  return !isNaN(Date.parse(value));
}

function getRateLimit(email) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    email.toLowerCase(),
    Utilities.Charset.UTF_8
  );
  const key = 'lead_' + Utilities.base64EncodeWebSafe(digest).slice(0, 32);
  const cache = CacheService.getScriptCache();

  if (cache.get(key)) {
    throw new Error('A recent inquiry already exists for this email.');
  }

  // The key is stored only after a successful Sheet write.
  return { cache: cache, key: key };
}

function appendLead(lead) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) {
      throw new Error('Bind this Apps Script project to a Google Sheet.');
    }

    let sheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    }

    sheet.appendRow(HEADERS.map(function (header) {
      return lead[header] === undefined ? '' : lead[header];
    }));
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
