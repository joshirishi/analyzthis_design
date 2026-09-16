'use strict';

/**
 * Detect installed motion / UX / visual-design libraries from package.json
 * and copy-paste kit folders. Personas read Tech/Installed-UI-Libraries.md
 * and session.installed_ui_libraries instead of guessing the stack.
 */

const fs = require('fs');
const path = require('path');
const retrieve = require('./retrieve');

const DEFAULT_BY_JOB = {
  primitives: 'Shadcn UI',
  motion: 'Motion',
  icons: 'Lucide',
};

const FOLDER_CANDIDATES = [
  'components/ui',
  'src/components/ui',
  'app/components/ui',
  'components/magicui',
  'src/components/magicui',
  'components/aceternity',
  'src/components/aceternity',
];

function catalogRows() {
  try {
    return retrieve.loadCsv('ui-libraries.csv').rows || [];
  } catch {
    return [];
  }
}

function splitAliases(field) {
  return String(field || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function npmMatches(depName, npmField) {
  return splitAliases(npmField).some((alias) => {
    if (alias.endsWith('/*')) {
      const prefix = alias.slice(0, -1);
      const pkg = alias.slice(0, -2);
      return depName === pkg || depName.startsWith(prefix);
    }
    return depName === alias;
  });
}

function readPackageDeps(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return { deps: [], pkgPath: null };
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const names = Object.keys({
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    });
    return { deps: names, pkgPath };
  } catch {
    return { deps: [], pkgPath };
  }
}

function folderExists(cwd, rel) {
  try {
    return fs.statSync(path.join(cwd, rel)).isDirectory();
  } catch {
    return false;
  }
}

function detectFolders(cwd) {
  const found = [];
  for (const rel of FOLDER_CANDIDATES) {
    if (folderExists(cwd, rel)) found.push(rel);
  }
  return found;
}

function folderHitsRow(foundFolders, detectionFolders) {
  const needles = splitAliases(detectionFolders).filter(Boolean);
  if (!needles.length) return false;
  return foundFolders.some((rel) =>
    needles.some((n) => rel === n || rel.endsWith('/' + n) || rel.indexOf(n) !== -1));
}

/**
 * @param {{ cwd: string }} opts
 * @returns {{ installed: object[], missing_defaults: object[], folders: string[], full_kits: string[], mixed_kits: boolean }}
 */
function detectInstalledUiLibraries({ cwd } = {}) {
  const root = path.resolve(cwd || process.cwd());
  const { deps } = readPackageDeps(root);
  const folders = detectFolders(root);
  const rows = catalogRows();
  const installed = [];
  const seen = new Set();

  for (const row of rows) {
    const byNpm = deps.some((d) => npmMatches(d, row['Npm Names']));
    const byFolder = folderHitsRow(folders, row['Detection Folders']);
    if (!byNpm && !byFolder) continue;
    const name = row.Library;
    if (seen.has(name)) continue;
    seen.add(name);
    installed.push({
      library: name,
      job: row.Job,
      persona: row.Persona,
      import_example: row['Import Example'],
      docs: row['Docs URL'],
      do_not_use_for: row['Do Not Use For'],
      bundle_hint: row['Bundle Hint'],
      how: byNpm ? (byFolder ? 'package+folder' : 'package.json') : 'folder',
    });
  }

  const jobsPresent = new Set(installed.map((i) => i.job));
  const missing_defaults = [];
  Object.keys(DEFAULT_BY_JOB).forEach((job) => {
    if (jobsPresent.has(job)) return;
    // full-kit covers primitives
    if (job === 'primitives' && jobsPresent.has('full-kit')) return;
    const libName = DEFAULT_BY_JOB[job];
    const row = rows.find((r) => r.Library === libName);
    missing_defaults.push({
      job,
      library: libName,
      install: row ? row.Install : '',
      docs: row ? row['Docs URL'] : '',
    });
  });

  const full_kits = installed.filter((i) => i.job === 'full-kit').map((i) => i.library);
  const hasShadcn = installed.some((i) => i.library === 'Shadcn UI' || i.library === 'Radix UI');
  const mixed_kits = full_kits.length > 1 || (full_kits.length > 0 && hasShadcn);

  return { installed, missing_defaults, folders, full_kits, mixed_kits };
}

function buildNoteMarkdown(detection) {
  const date = new Date().toISOString().split('T')[0];
  const installed = detection.installed || [];
  const missing = detection.missing_defaults || [];
  const lines = [
    '---',
    'title: Installed-UI-Libraries',
    'tags: [tech, ui-libraries]',
    'source: package.json',
    'category: tech',
    `collected_at: "${date}"`,
    'enriched: true',
    '---',
    '',
    '## Purpose',
    'Libraries already in this repo that design personas must prefer. One library per job. Do not add a second full UI kit. Do not put marketing FX (Magic UI, Aceternity, 21st.dev, Lottie, Spline) on daily working dashboards.',
    '',
    '## Installed',
  ];
  if (!installed.length) {
    lines.push('- _(none of the catalogued packages detected)_');
  } else {
    for (const i of installed) {
      lines.push(`- **${i.library}** (${i.job}) via ${i.how} — \`${i.import_example}\``);
    }
  }
  lines.push('', '## Missing defaults (optional — do not install unless the brief needs them)');
  if (!missing.length) {
    lines.push('- All default jobs covered.');
  } else {
    for (const m of missing) {
      lines.push(`- **${m.job}:** ${m.library} — \`${m.install}\``);
    }
  }
  lines.push('', '## Kit rule');
  if (detection.mixed_kits) {
    lines.push('- **BLOCK mix:** more than one full kit (or a full kit plus Shadcn) is present. Priya: do not add more. Use the incumbent kit.');
  } else if (detection.full_kits && detection.full_kits.length) {
    lines.push(`- Incumbent full kit: **${detection.full_kits.join(', ')}**. Prescribe this kit's components; do not start a Shadcn tree.`);
  } else {
    lines.push('- No full kit detected. Shadcn + Radix is the greenfield default for Tailwind apps.');
  }
  lines.push('', '## Folders found');
  if (!(detection.folders || []).length) {
    lines.push('- _(none)_');
  } else {
    for (const f of detection.folders) lines.push(`- \`${f}\``);
  }
  lines.push('');
  return lines.join('\n');
}

function writeInstalledUiLibrariesNote({ vaultPath, detection, dryRun }) {
  const md = buildNoteMarkdown(detection);
  const rel = path.join('Tech', 'Installed-UI-Libraries.md');
  if (dryRun || !vaultPath) {
    return { vaultRel: rel, written: false, markdown: md };
  }
  const destDir = path.join(vaultPath, 'Tech');
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, 'Installed-UI-Libraries.md');
  fs.writeFileSync(dest, md);
  return { vaultRel: rel, written: true, markdown: md, dest };
}

function sessionPayload(detection) {
  return {
    installed: (detection.installed || []).map((i) => ({
      library: i.library,
      job: i.job,
      how: i.how,
    })),
    missing_defaults: detection.missing_defaults || [],
    full_kits: detection.full_kits || [],
    mixed_kits: !!detection.mixed_kits,
    folders: detection.folders || [],
  };
}

module.exports = {
  detectInstalledUiLibraries,
  writeInstalledUiLibrariesNote,
  buildNoteMarkdown,
  sessionPayload,
  DEFAULT_BY_JOB,
};
