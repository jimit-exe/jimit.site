// npm run import-draft -- <file.md>
// Imports a post exported from the drafts doc into src/content/posts/<slug>/index.md:
// - removes the ```yaml fence lines around the front matter and drops `slug` (the folder is the slug)
// - forces draft: true, and fixes or flags front matter the schema would reject
// - converts `> **Note:**` / `> **Defender view:**` (and Tip/Warning/Caution) to GitHub alert syntax
// - rewrites /images/<slug>/x.png to ./x.png, copying the image in when it can be found
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { POSTS_DIR, TYPES, slugify, rel, color } from './lib.mjs';

const src = process.argv[2];
const die = (msg) => {
  console.error(color.red(`✖ ${msg}`));
  console.error('Usage: npm run import-draft -- <file.md>');
  process.exit(1);
};
if (!src) die('Missing the file to import.');
if (!existsSync(src)) die(`${src} not found.`);

const notes = [];
const warn = (m) => notes.push(color.yellow(`⚠ ${m}`));
const did = (m) => notes.push(color.dim(`• ${m}`));

let text = readFileSync(src, 'utf8').replace(/\r\n?/g, '\n').replace(/^﻿/, '');

// ---------------------------------------------------------------- front matter
let fmText;
let body;
const plainFm = text.match(/^\s*---\n([\s\S]*?)\n---\n/);
const fenced = text.match(/^((?:\s*\n)*(?:#[^\n]*\n(?:\s*\n)*)?)(```|~~~)\s*ya?ml\s*\n([\s\S]*?)\n\2[ \t]*\n/);
if (plainFm) {
  fmText = plainFm[1];
  body = text.slice(plainFm[0].length);
} else if (fenced) {
  fmText = fenced[3].replace(/^\s*---\s*\n/, '').replace(/\n\s*---\s*$/, '');
  body = text.slice(fenced[0].length);
  did('Removed the ```yaml fence around the front matter');
  if (fenced[1].trim()) did(`Dropped the heading above the front matter (${fenced[1].trim()})`);
} else {
  die('No front matter found: expected a ```yaml block (or --- lines) at the top of the file.');
}

// Google Docs escapes some characters inside the exported code block.
fmText = fmText.replace(/\\([[\]_*#-])/g, '$1');

let doc;
try {
  doc = YAML.parseDocument(fmText);
  if (doc.errors.length) throw doc.errors[0];
} catch (e) {
  die(`Front matter is not valid YAML: ${e.message.split('\n')[0]}`);
}
const get = (k) => doc.get(k);

const title = String(get('title') ?? '').trim();
if (!title) die('Front matter has no title.');
const type = get('type');
if (!TYPES.includes(type)) die(`type is "${type}"; it must be one of ${TYPES.join(', ')}.`);
const date = get('date');
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date instanceof Date ? date.toISOString().slice(0, 10) : date))) {
  die(`date is "${date}"; use YYYY-MM-DD.`);
}

const slug = slugify(String(get('slug') ?? '') || title);
if (doc.has('slug')) {
  doc.delete('slug');
  did(`Dropped slug; the folder name is the slug: ${slug}`);
}
const dir = path.join(POSTS_DIR, slug);
if (existsSync(dir)) die(`${rel(dir)} already exists. Slugs must be unique across all post types.`);

if (title.length > 90) warn(`title is ${title.length} characters; the limit is 90, so the build will fail until it is shortened`);

const ALLOWED = ['title', 'date', 'updated', 'type', 'summary', 'tags', 'cover', 'coverAlt', 'platform', 'difficulty', 'repo', 'featured', 'draft'];
for (const pair of [...doc.contents.items]) {
  const k = String(pair.key);
  if (!ALLOWED.includes(k)) {
    doc.delete(k);
    warn(`Removed unknown field "${k}" (the schema only allows ${ALLOWED.join(', ')})`);
  }
}
if (type !== 'writeup') {
  for (const k of ['platform', 'difficulty']) if (doc.has(k)) { doc.delete(k); warn(`Removed ${k}: it is for writeups only`); }
}
if (type !== 'project' && doc.has('repo')) { doc.delete('repo'); warn('Removed repo: it is for projects only'); }
if (doc.has('repo') && (!/^https:\/\//.test(String(get('repo'))) || String(get('repo')).includes('...'))) {
  doc.set('repo', `https://github.com/jimit-exe/${slug}`);
  doc.get('repo', true).comment = ' [VERIFY] repository URL';
  warn('repo was not a full https:// URL; set a guess marked [VERIFY]');
}
const DIFF = ['beginner', 'easy', 'medium', 'hard', 'insane'];
if (doc.has('difficulty') && !DIFF.includes(String(get('difficulty')).toLowerCase())) {
  warn(`Removed difficulty "${get('difficulty')}": use one of ${DIFF.join(', ')}`);
  doc.delete('difficulty');
} else if (doc.has('difficulty')) doc.set('difficulty', String(get('difficulty')).toLowerCase());

// Summary: 50 to 200 characters. Out of range keeps the text but adds a marker so it can't publish.
let summary = String(get('summary') ?? '').trim();
if (summary.length < 50 || summary.length > 200 || /^one sentence for post cards/i.test(summary)) {
  summary = `[YOUR WORDS] ${summary || 'Summary for post cards and link previews.'}`;
  if (summary.length < 50) summary += ' (write 50 to 200 characters)';
  if (summary.length > 200) summary = summary.slice(0, 197) + '...';
  doc.set('summary', summary);
  warn('summary is missing or not 50 to 200 characters; marked [YOUR WORDS]');
}

// Tags: lowercase kebab-case, 1 to 8.
let tags = get('tags');
tags = (Array.isArray(tags) ? tags : tags?.toJSON?.() ?? (tags ? String(tags).split(',') : [])).map((t) => slugify(String(t))).filter(Boolean);
tags = [...new Set(tags)];
if (tags.length > 8) { warn(`Kept the first 8 of ${tags.length} tags`); tags = tags.slice(0, 8); }
if (!tags.length) { tags = ['needs-tags']; warn('No tags; added needs-tags'); }
const tagNode = doc.createNode(tags);
tagNode.flow = true;
doc.set('tags', tagNode);

// Always import as a draft.
if (get('draft') !== true) did('Set draft: true');
doc.set('draft', true);

// ------------------------------------------------------------------- images
mkdirSync(dir, { recursive: true });
const srcDir = path.dirname(path.resolve(src));
const imgSlug = String(get('slug') ?? slug);

/** Find an image the draft refers to: next to the file, in images/<slug>/, or a public-style path. */
function findImage(ref) {
  const base = path.basename(ref);
  const candidates = [
    path.resolve(srcDir, ref.replace(/^\//, '')),
    path.join(srcDir, base),
    path.join(srcDir, 'images', imgSlug, base),
    path.join(srcDir, imgSlug, base),
  ];
  return candidates.find((c) => existsSync(c));
}
function localise(ref) {
  if (/^[a-z]+:|^\/\//i.test(ref) || ref.startsWith('data:')) return { ref, found: true };
  const base = decodeURI(path.basename(ref.split(/[?#]/)[0]));
  const dest = path.join(dir, base);
  const from = findImage(decodeURI(ref.split(/[?#]/)[0]));
  if (from && !existsSync(dest)) copyFileSync(from, dest);
  return { ref: `./${base}`, found: Boolean(from) || existsSync(dest), base };
}

if (doc.has('cover')) {
  const { ref, found, base } = localise(String(get('cover')));
  if (found) {
    doc.set('cover', ref);
    if (!String(get('coverAlt') ?? '').trim()) {
      doc.set('coverAlt', '[YOUR WORDS] describe the cover image');
      warn('cover has no coverAlt; added a [YOUR WORDS] placeholder');
    }
  } else {
    doc.delete('cover');
    doc.delete('coverAlt');
    const note = ` [SCREENSHOT] add ${base} to this folder, then set cover: ./${base} and coverAlt`;
    doc.comment = doc.comment ? `${doc.comment}\n${note}` : note;
    warn(`cover ${base} not found; removed it and left a [SCREENSHOT] note in the front matter`);
  }
}

// --------------------------------------------------------------------- body
const lines = body.replace(/^\s*\n/, '').split('\n');
// Drop a leading "# Title" heading: the page renders the title as the h1.
if (/^#\s+/.test(lines[0] ?? '')) {
  did(`Dropped the leading h1 (${lines[0].replace(/^#\s+/, '')}); the title is the page heading`);
  lines.shift();
  while (lines[0] === '') lines.shift();
}

const CALLOUT = { note: 'NOTE', tip: 'TIP', important: 'IMPORTANT', warning: 'WARNING', caution: 'CAUTION', 'defender view': 'DEFENDER', defender: 'DEFENDER' };
const calloutRe = /^(\s*>\s*)(?:\*\*|__)\s*(note|tip|important|warning|caution|defender view|defender)\s*:?\s*(?:\*\*|__)\s*:?\s*(.*)$/i;
let callouts = 0;
let missingImages = 0;
let inFence = null;
const out = [];
for (let i = 0; i < lines.length; i++) {
  let line = lines[i];
  const fence = line.match(/^\s*(```|~~~)/);
  if (fence) {
    inFence = inFence === null ? fence[1] : line.trim().startsWith(inFence) ? null : inFence;
    out.push(line);
    continue;
  }
  if (inFence) {
    out.push(line);
    continue;
  }

  // Callouts: only at the start of a blockquote.
  const c = line.match(calloutRe);
  if (c && !/^\s*>/.test(lines[i - 1] ?? '')) {
    out.push(`${c[1].trimEnd()} [!${CALLOUT[c[2].toLowerCase()]}]`);
    if (c[3].trim()) out.push(`${c[1].trimEnd()} ${c[3].trim()}`);
    callouts++;
    continue;
  }

  // Docs escapes [ and ] around markers and [REDACTED]; unescape those so they render and get checked.
  line = line.replace(/\\\[(REDACTED|VERIFY|SCREENSHOT|YOUR WORDS)([^\]\n]*?)\\\]/g, '[$1$2]');

  // Images: point at the post folder; if the file can't be found, leave a marker instead of a broken image.
  line = line.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(\s+"[^"]*")?\s*\)/g, (_all, alt, ref, title = '') => {
    const { ref: local, found, base } = localise(ref);
    if (found) return `![${alt}](${local}${title})`;
    missingImages++;
    return `[SCREENSHOT] add ${base} to this folder, then use: \`![${alt}](${local}${title})\``;
  });
  out.push(line);
}

const fmOut = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
const result = `---\n${fmOut}\n---\n\n${out.join('\n').trimEnd()}\n`;
const file = path.join(dir, 'index.md');
writeFileSync(file, result);

if (callouts) did(`Converted ${callouts} callout${callouts === 1 ? '' : 's'} to [!NOTE]/[!DEFENDER] syntax`);
if (missingImages) warn(`${missingImages} image${missingImages === 1 ? '' : 's'} not found; each is now a [SCREENSHOT] line with the Markdown to restore`);

const markers = (result.match(/\[(VERIFY|SCREENSHOT|YOUR WORDS)\b[^\]\n]*\]/g) ?? []).length;
console.log(color.green(`✔ Imported ${src} → ${rel(file)} (draft)`));
for (const n of notes) console.log(`  ${n}`);
console.log(
  markers
    ? `  ${markers} [VERIFY]/[SCREENSHOT]/[YOUR WORDS] marker${markers === 1 ? '' : 's'} to resolve before publishing. See them with: npm run check:posts -- --all`
    : '  No unfinished markers. Review it with npm run dev, then set draft: false to publish.',
);
