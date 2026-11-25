// Validates public/.well-known/security.txt (RFC 9116). Fails if a required field is missing,
// Expires is in the past or more than a year ahead; warns within 30 days of expiry.
// In GitHub Actions the warning is also shown as a workflow annotation.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, rel, color } from './lib.mjs';

const file = path.join(ROOT, 'public/.well-known/security.txt');
const text = readFileSync(file, 'utf8');
const fields = {};
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z-]+):\s*(.+)$/);
  if (m) (fields[m[1].toLowerCase()] ??= []).push(m[2].trim());
}

const errors = [];
const warnings = [];
const gh = process.env.GITHUB_ACTIONS === 'true';

if (!fields.contact?.length) errors.push('missing Contact');
if (fields.expires?.length !== 1) errors.push('needs exactly one Expires');
if (!fields.canonical?.some((u) => u === 'https://jimit.site/.well-known/security.txt')) errors.push('Canonical must be https://jimit.site/.well-known/security.txt');
if (!fields['preferred-languages']) warnings.push('no Preferred-Languages');

const expires = new Date(fields.expires?.[0] ?? '');
const days = Math.floor((expires - Date.now()) / 86_400_000);
if (Number.isNaN(expires.valueOf())) errors.push(`Expires "${fields.expires?.[0]}" is not an ISO 8601 date`);
else if (days < 0) errors.push(`Expires ${fields.expires[0]} has passed`);
else if (days > 366) errors.push(`Expires is ${days} days away; RFC 9116 recommends less than a year`);
else if (days <= 30) warnings.push(`Expires in ${days} days (${fields.expires[0]}); set a new date up to a year ahead`);

for (const w of warnings) {
  console.warn(color.yellow(`⚠ ${rel(file)}: ${w}`));
  if (gh) console.log(`::warning file=${rel(file)}::security.txt ${w}`);
}
for (const e of errors) {
  console.error(color.red(`✖ ${rel(file)}: ${e}`));
  if (gh) console.log(`::error file=${rel(file)}::security.txt ${e}`);
}
if (errors.length) process.exit(1);
console.log(color.green(`check:security-txt: valid, expires in ${days} days`));
