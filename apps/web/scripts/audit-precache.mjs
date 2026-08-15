/* global URL, console, process */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { containsForbiddenRuntimeCaching } from './audit-precache-runtime-caching.mjs';

const dist = path.resolve(import.meta.dirname, '../dist');
const sw = await readFile(path.join(dist, 'sw.js'), 'utf8');
const marker = '.precacheAndRoute(';
const callStart = sw.indexOf(marker);

if (callStart < 0) throw new Error('Manifesto de precache não encontrado em dist/sw.js.');

const arrayStart = sw.indexOf('[', callStart);
let arrayEnd = -1;
let depth = 0;
let inString = false;
let escaped = false;

for (let index = arrayStart; index < sw.length; index += 1) {
  const char = sw[index];
  if (inString) {
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (char === '"') inString = false;
    continue;
  }
  if (char === '"') inString = true;
  else if (char === '[') depth += 1;
  else if (char === ']' && --depth === 0) {
    arrayEnd = index + 1;
    break;
  }
}

if (arrayEnd < 0) throw new Error('Manifesto de precache inválido em dist/sw.js.');

const serialized = sw
  .slice(arrayStart, arrayEnd)
  .replace(/([{,])url:/g, '$1"url":')
  .replace(/,revision:/g, ',"revision":');
const entries = JSON.parse(serialized);
const urls = new Map();

for (const entry of entries) {
  const parsed = new URL(entry.url, 'https://local.invalid/');
  if (parsed.origin !== 'https://local.invalid') {
    throw new Error(`URL externa no precache: ${entry.url}`);
  }
  const relativePath = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  const file = path.resolve(dist, relativePath);
  if (!file.startsWith(`${dist}${path.sep}`)) throw new Error(`Caminho inseguro: ${entry.url}`);
  const bytes = (await stat(file)).size;
  const current = urls.get(entry.url) ?? { bytes, occurrences: 0 };
  current.occurrences += 1;
  urls.set(entry.url, current);
}

const rows = [...urls].map(([url, value]) => ({ url, ...value }));
const duplicateRows = rows.filter((row) => row.occurrences > 1);
const uniqueBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
const logicalBytes = rows.reduce((sum, row) => sum + row.bytes * row.occurrences, 0);
const report = {
  entries: entries.length,
  uniqueUrls: rows.length,
  duplicateOccurrences: entries.length - rows.length,
  uniqueBytes,
  logicalBytes,
  duplicateLogicalBytes: logicalBytes - uniqueBytes,
  runtimeCaching: containsForbiddenRuntimeCaching(sw) ? 'FOUND' : 'NONE',
};

console.log(JSON.stringify(report, null, 2));

if (duplicateRows.length > 0) {
  console.error('Entradas duplicadas:', duplicateRows);
  process.exitCode = 1;
}

if (report.runtimeCaching !== 'NONE') process.exitCode = 1;
