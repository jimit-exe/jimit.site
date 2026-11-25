// Runs after `astro build` + Pagefind. Confirms two promises about the published output:
// 1. No image in dist/ carries EXIF, XMP or IPTC metadata (Astro's sharp pipeline strips it).
// 2. No draft appears anywhere: no page, and no mention in the RSS feed, sitemap or search index.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { POSTS_DIR, ROOT, readPost, rel, color } from './lib.mjs';
import { inlineHashes } from './csp-hashes.mjs';

const DIST = path.join(ROOT, 'dist');
if (!existsSync(DIST)) {
  console.error(color.red('✖ dist/ not found. Run astro build first.'));
  process.exit(1);
}

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(DIST);
const errors = [];

// 1. Metadata in published images. public/ files are copied as-is, so they are checked too.
let images = 0;
for (const f of files.filter((f) => /\.(jpe?g|png|webp|avif|gif|tiff?)$/i.test(f))) {
  images++;
  const meta = await sharp(f).metadata();
  const found = ['exif', 'xmp', 'iptc'].filter((k) => meta[k]);
  if (found.length) errors.push(`${rel(f)} carries ${found.join(', ').toUpperCase()} metadata`);
}

// 2. Drafts. Search the text outputs for each draft's URL path.
const SECTION = { writeup: 'writeups', methodology: 'blog', blog: 'blog', project: 'projects' };
const draftPaths = readdirSync(POSTS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(path.join(POSTS_DIR, d.name, 'index.md')))
  .map((d) => ({ slug: d.name, ...readPost(path.join(POSTS_DIR, d.name, 'index.md')) }))
  .filter((p) => p.data.draft !== false)
  .map((p) => `/${SECTION[p.data.type] ?? 'blog'}/${p.slug}`);

const textOf = (f) => {
  const buf = readFileSync(f);
  // Pagefind fragments are gzipped with a "pagefind_dcd" signature in front.
  if (/[\\/]pagefind[\\/]fragment[\\/]/.test(f)) {
    try {
      return gunzipSync(buf).toString('utf8');
    } catch {
      return buf.toString('utf8');
    }
  }
  return buf.toString('utf8');
};
const texts = files.filter((f) => /\.(html|xml|json|txt)$|[\\/]pagefind[\\/]fragment[\\/]/.test(f));
for (const p of draftPaths) {
  if (existsSync(path.join(DIST, `${p}.html`))) errors.push(`draft page was built: dist${p}.html`);
  for (const f of texts) {
    if (textOf(f).includes(p)) errors.push(`${rel(f)} mentions draft ${p}`);
  }
}

// 3. CSP hygiene: every page carries the policy, and no markup needs 'unsafe-inline'.
const SPLIT = /(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>)/gi;
const VALUE = String.raw`(?:"[^"]*"|'[^']*'|[^\s"'=<>\x60]+)`;
const ATTR = new RegExp(String.raw`([^\s"'<>\/=]+)(?:\s*=\s*(${VALUE}))?`, 'g');
const TAG = new RegExp(String.raw`<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*${VALUE})?)*)\s*\/?>`, 'g');
let pages = 0;
for (const f of files.filter((f) => f.endsWith('.html'))) {
  pages++;
  const html = readFileSync(f, 'utf8');
  if (!/<meta http-equiv="content-security-policy"/i.test(html)) errors.push(`${rel(f)} has no CSP <meta> tag`);
  // Every inline script and style must be allowed by a hash in the policy.
  const csp = html.match(/<meta http-equiv="content-security-policy" content="([^"]*)"/i)?.[1] ?? '';
  const directive = (name) => new Set((csp.match(new RegExp(`(?:^|;)\\s*${name} ([^;]*)`))?.[1] ?? '').split(/\s+/));
  const { scripts, styles } = inlineHashes(html);
  const scriptSrc = directive('script-src');
  const styleSrc = directive('style-src');
  for (const h of scripts) if (!scriptSrc.has(h)) errors.push(`${rel(f)} inline script ${h} is not in script-src`);
  for (const h of styles) if (!styleSrc.has(h)) errors.push(`${rel(f)} inline style ${h} is not in style-src`);
  const cspAt = html.search(/<meta http-equiv="content-security-policy"/i);
  const firstRes = html.search(/<(script|style|link)\b/i);
  if (cspAt > -1 && firstRes > -1 && cspAt > firstRes) errors.push(`${rel(f)} CSP <meta> comes after a script, style or link, so it doesn't cover them`);
  if (/'unsafe-inline'|'unsafe-eval'|'unsafe-hashes'/.test(html)) errors.push(`${rel(f)} CSP contains 'unsafe-inline' or 'unsafe-eval'`);
  const markup = html.split(SPLIT).filter((_, i) => i % 2 === 0).join('');
  // Tokenise real tags, consuming quoted attribute values whole: a "<" inside a value (such as
  // a code block's copy text in data-code="...") is text, not markup, and must not be matched.
  for (const m of markup.matchAll(TAG)) {
    for (const a of m[2].matchAll(ATTR)) {
      const name = a[1].toLowerCase();
      const value = (a[2] ?? '').replace(/^["']|["']$/g, '').trim();
      const where = `${rel(f)} <${m[1]} ${name}=…>`;
      if (name === 'style') errors.push(`${where} is an inline style attribute`);
      if (/^on[a-z]+$/.test(name)) errors.push(`${where} is an inline event handler`);
      if ((name === 'href' || name === 'src') && /^javascript:/i.test(value)) errors.push(`${where} is a javascript: URL`);
    }
  }
}

for (const e of errors) console.error(color.red(`✖ ${e}`));
const summary = `check:dist: ${pages} pages checked for CSP, ${images} images checked for metadata, ${draftPaths.length} draft${draftPaths.length === 1 ? '' : 's'} checked for leaks; ${errors.length} error${errors.length === 1 ? '' : 's'}`;
if (errors.length) {
  console.error(color.red(color.bold(summary)));
  process.exit(1);
}
console.log(color.green(summary));
