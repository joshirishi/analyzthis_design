/**
 * Analyzthis website → Google Sheets lead endpoint.
 *
 * SETUP
 * 1. Create a Google Sheet, then open Extensions → Apps Script.
 * 2. Replace Code.gs with this file and save.
 * 3. Deploy → New deployment → Web app.
 * 4. Execute as: Me. Who has access: Anyone.
 * 5. Copy the /exec URL into GOOGLE_SHEETS_ENDPOINT in website/index.html.
 * 6. After any script change: Deploy → Manage deployments → pencil → Deploy.
 * 7. Test the form once (not ?form=mock) and confirm a "Leads" tab row is created.
 *
 * Partial saves: the site writes after each step and if the visitor leaves
 * with a name and email. The same email updates one row until status is
 * complete. Empty fields do not wipe answers already on the row.
 *
 * The endpoint is public by design. Validation, a honeypot, length limits,
 * formula neutralization, write locking, and a short email rate limit on
 * completed inquiries reduce accidental abuse.
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
  'failureMode',
  'status',
  'lastStep'
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
    if (lead.status === 'complete') {
      const rateLimit = getRateLimit(lead.email);
      upsertLead(lead);
      rateLimit.cache.put(rateLimit.key, '1', 300);
    } else {
      upsertLead(lead);
    }

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
  lead.status = payload.status === 'complete' ? 'complete' : 'partial';
  lead.lastStep = clean(payload.lastStep, 8);

  if (!lead.fullName) throw new Error('Full name is required.');
  if (!lead.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    throw new Error('A valid email is required.');
  }

  // Incomplete fills only need a name and email so drop-offs still land in the sheet.
  if (lead.status === 'partial') return lead;

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

  // The key is stored only after a successful complete write.
  return { cache: cache, key: key };
}

function upsertLead(lead) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) {
      throw new Error('Bind this Apps Script project to a Google Sheet.');
    }

    let sheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);

    const headers = ensureHeaders(sheet);
    const existingRow = findLeadRow(sheet, headers, lead.email);
    const existingStatus = existingRow
      ? String(sheet.getRange(existingRow, headers.status || 1).getValue())
      : '';

    // Keep one open row per email. A new row starts only after a completed inquiry.
    if (existingRow && existingStatus !== 'complete') {
      writeLeadRow(sheet, headers, existingRow, lead, true);
    } else {
      const row = sheet.getLastRow() + 1;
      writeLeadRow(sheet, headers, row, lead, false);
    }
  } finally {
    lock.releaseLock();
  }
}

function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  } else {
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    HEADERS.forEach(function (header) {
      if (existing.indexOf(header) === -1) {
        const col = sheet.getLastColumn() + 1;
        sheet.getRange(1, col).setValue(header).setFontWeight('bold');
        existing.push(header);
      }
    });
  }

  const names = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  names.forEach(function (name, index) {
    if (name) map[name] = index + 1;
  });
  return map;
}

function findLeadRow(sheet, headers, email) {
  const emailCol = headers.email;
  if (!emailCol || sheet.getLastRow() < 2) return 0;

  const values = sheet.getRange(2, emailCol, sheet.getLastRow() - 1, 1).getValues();
  const needle = email.toLowerCase();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]).toLowerCase() === needle) return i + 2;
  }
  return 0;
}

function writeLeadRow(sheet, headers, row, lead, merge) {
  HEADERS.forEach(function (header) {
    const col = headers[header];
    if (!col) return;

    const incoming = lead[header];
    if (incoming === undefined) return;

    // Updating a partial row: skip blanks so going back a step does not erase later answers.
    if (merge && incoming !== false && String(incoming).trim() === '') return;
    if (merge && header === 'consent' && incoming === false) return;
    if (merge && header === 'status' && incoming === 'partial') {
      const current = String(sheet.getRange(row, col).getValue());
      if (current === 'complete') return;
    }

    sheet.getRange(row, col).setValue(incoming);
  });
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
