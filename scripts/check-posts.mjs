// npm run check:posts [-- --all]
// Pre-publish check for every post with draft: false. Runs before every build and in CI.
// Fails on unfinished markers, missing alt text and missing images. Warns on large images,
// GPS data in originals, flag-like strings, and writeups without the fixed ending sections.
// --all also reports on drafts (as warnings), which is handy while writing.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { POSTS_DIR, ROOT, readPost, rel, color } from './lib.mjs';

const includeDrafts = process.argv.includes('--all');
const MB = 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|tiff?|svg)$/i;

const MARKERS = [
  { re: /\[(VERIFY|SCREENSHOT|YOUR WORDS)\b[^\]\n]*\]/g, why: (m) => `${m.split(/[\]:]/)[0]}] marker left in` },
  { re: /\b(TODO|TBD)\b/g, why: (m) => `"${m}" left in` },
];
const FLAG_LIKE = [/\b(?:HTB|THM|CSEC|flag|picoCTF|DUCTF)\{[^}\n]*\}?/gi, /\b[0-9a-f]{32}\b/gi];
const WRITEUP_ENDINGS = [
  ['Root cause', /^root cause\b/],
  ['Fix', /^(the )?fix(es)?\b/],
  ['How to detect it', /^how to detect it\b/],
];

/** True if a raw EXIF block has a GPS IFD with latitude or longitude in it. */
function exifHasGps(exif) {
  try {
    let b = exif;
    if (b.toString('latin1', 0, 6) === 'Exif\0\0') b = b.subarray(6);
    const le = b.toString('latin1', 0, 2) === 'II';
    const u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
    const u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
    const ifd0 = u32(4);
    for (let i = 0, n = u16(ifd0); i < n; i++) {
      const e = ifd0 + 2 + i * 12;
      if (u16(e) !== 0x8825) continue; // GPSInfo pointer
      const gps = u32(e + 8);
      for (let j = 0, m = u16(gps); j < m; j++) {
        const t = u16(gps + 2 + j * 12);
        if (t === 0x0002 || t === 0x0004) return true; // GPSLatitude / GPSLongitude
      }
    }
  } catch {
    /* unreadable EXIF: treat as no GPS */
  }
  return false;
}

export async function imageWarnings(file) {
  const out = [];
  const size = statSync(file).size;
  if (size > MB) out.push(`is ${(size / MB).toFixed(1)} MB; over 1 MB, consider cropping or resizing the original`);
  if (!/\.svg$/i.test(file)) {
    try {
      const meta = await sharp(file).metadata();
      if (meta.exif && exifHasGps(meta.exif)) out.push('has GPS location data in its EXIF (the published copy is stripped, but the original sits in the repo)');
    } catch (e) {
      out.push(`could not be read as an image (${e.message})`);
    }
  }
  return out;
}

/** Blank out fenced code blocks, keeping line numbers, so image syntax in code is ignored. */
const withoutCode = (s) =>
  s.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (block) => block.replace(/[^\n]/g, ''));

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Resolve an image reference the way Astro does: relative to the post, or / from public/. */
function resolveImage(src, postDir) {
  const clean = decodeURI(src.split(/[?#]/)[0]);
  if (clean.startsWith('/')) return path.join(ROOT, 'public', clean);
  return path.resolve(postDir, clean);
}

async function checkPost(dir) {
  const file = path.join(dir, 'index.md');
  const errors = [];
  const warnings = [];
  const buildBreakers = []; // fail even for drafts: Astro can't build a post whose image is missing
  const at = (line) => `${rel(file)}:${line}`;

  const { text, data, body, bodyStartLine, error } = readPost(file);
  if (error) return { file, draft: true, errors: [], warnings, buildBreakers: [`${rel(file)}: ${error}`] };
  const draft = data.draft !== false; // draft defaults to true

  // Unfinished markers, anywhere in the file (front matter included). Unescape \[ \] from Docs exports.
  const plain = text.replace(/\\([[\]])/g, '$1');
  for (const { re, why } of MARKERS) {
    for (const m of plain.matchAll(re)) errors.push(`${at(lineOf(plain, m.index))} ${why(m[0])} the post`);
  }

  // Images in the body: Markdown ![alt](src "title") and raw <img>.
  const scan = withoutCode(body);
  const images = [];
  for (const m of scan.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) {
    images.push({ alt: m[1], src: m[2], line: bodyStartLine - 1 + lineOf(scan, m.index) });
  }
  for (const m of scan.matchAll(/<img\b[^>]*>/gi)) {
    const src = m[0].match(/\bsrc\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    const alt = m[0].match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1];
    images.push({ alt: alt ?? '', src, line: bodyStartLine - 1 + lineOf(scan, m.index), noAltAttr: alt === undefined });
  }
  if (data.cover) {
    const line = text.split('\n').findIndex((l) => /^cover:/.test(l)) + 1;
    images.push({ alt: String(data.coverAlt ?? ''), src: String(data.cover), line, cover: true });
  }

  for (const img of images) {
    const label = img.cover ? 'cover image' : `image ${img.src}`;
    if (!img.alt.trim()) {
      errors.push(`${at(img.line)} ${label} has no alt text${img.cover ? ' (set coverAlt)' : ''}`);
    } else if (/^(image|img|screenshot|picture|photo)$/i.test(img.alt.trim()) || IMAGE_EXT.test(img.alt.trim())) {
      warnings.push(`${at(img.line)} ${label} has alt text "${img.alt}", which doesn't describe it`);
    }
    if (!img.src) {
      errors.push(`${at(img.line)} ${label} has no src`);
      continue;
    }
    if (/^data:/i.test(img.src)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(img.src) || img.src.startsWith('//')) {
      errors.push(`${at(img.line)} ${label} is remote; the CSP only allows images from this site, so save it into the post folder`);
      continue;
    }
    const abs = resolveImage(img.src, dir);
    if (!existsSync(abs)) {
      const msg = `${at(img.line)} ${label} points to a missing file (${rel(abs)})`;
      // Inline code like `![alt](./x.png)` (left by import-draft) is not rendered, so it can't break the build.
      const inCode = /`[^`]*$/.test(scan.split('\n')[img.line - bodyStartLine]?.split('![')[0] ?? '');
      (img.cover || !inCode ? buildBreakers : errors).push(msg);
      continue;
    }
    for (const w of await imageWarnings(abs)) warnings.push(`${at(img.line)} ${label} ${w}`);
  }

  // Mermaid diagrams become images: accDescr is the alt text, accTitle the caption.
  for (const m of body.matchAll(/^(```|~~~)\s*mermaid\b[^\n]*\n([\s\S]*?)^\1/gm)) {
    const line = bodyStartLine - 1 + lineOf(body, m.index);
    const hasTitle = /^\s*accTitle\s*:\s*\S/m.test(m[2]);
    const hasDescr = /^\s*accDescr\s*(:\s*\S|\{)/m.test(m[2]);
    if (!hasTitle && !hasDescr) errors.push(`${at(line)} diagram has no alt text; add accTitle: and accDescr: lines`);
    else if (!hasDescr) warnings.push(`${at(line)} diagram has no accDescr:, so its alt text is just the title`);
    else if (!hasTitle) warnings.push(`${at(line)} diagram has no accTitle:, so it has no caption`);
  }

  // Flag-like strings: warn so a real flag is never published by accident.
  for (const re of FLAG_LIKE) {
    for (const m of plain.matchAll(re)) {
      warnings.push(`${at(lineOf(plain, m.index))} "${m[0].slice(0, 40)}" looks like a flag or hash; confirm it is meant to be public`);
    }
  }

  // Writeups end with Root cause, Fix and How to detect it.
  if (data.type === 'writeup') {
    const headings = [...body.matchAll(/^#{2,3}\s+(.+?)\s*#*\s*$/gm)].map((m) => m[1].toLowerCase().replace(/[*_`]/g, ''));
    const missing = WRITEUP_ENDINGS.filter(([, re]) => !headings.some((h) => re.test(h))).map(([name]) => name);
    if (missing.length) warnings.push(`${rel(file)} writeup has no ${missing.join(', ')} heading${missing.length > 1 ? 's' : ''}`);
  }

  return { file, draft, errors, warnings, buildBreakers };
}

const dirs = readdirSync(POSTS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(POSTS_DIR, d.name));

let published = 0;
let drafts = 0;
const allErrors = [];
const allWarnings = [];

for (const dir of dirs) {
  if (!existsSync(path.join(dir, 'index.md'))) {
    allWarnings.push(`${rel(dir)} has no index.md, so it is not a post`);
    continue;
  }
  const r = await checkPost(dir);
  allErrors.push(...r.buildBreakers);
  if (r.draft) {
    drafts++;
    if (includeDrafts) allWarnings.push(...[...r.errors, ...r.warnings].map((m) => `[draft] ${m}`));
    continue;
  }
  published++;
  allErrors.push(...r.errors);
  allWarnings.push(...r.warnings);
}

for (const w of allWarnings) console.warn(color.yellow(`⚠ ${w}`));
for (const e of allErrors) console.error(color.red(`✖ ${e}`));

const summary = `check:posts: ${published} published, ${drafts} draft${drafts === 1 ? '' : 's'} skipped${includeDrafts ? ' (reported as warnings)' : ''}; ${allErrors.length} error${allErrors.length === 1 ? '' : 's'}, ${allWarnings.length} warning${allWarnings.length === 1 ? '' : 's'}`;
if (allErrors.length) {
  console.error(color.red(color.bold(summary)));
  console.error('Fix the errors above, or set draft: true to keep the post unpublished.');
  process.exit(1);
}
console.log(color.green(summary));
