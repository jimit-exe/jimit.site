// Runs after `astro build`.
// 1. A <meta> CSP only governs what comes after it, and Astro places it after the inline theme
//    script. Move it to just after <meta charset> so it covers the whole page.
//    Then make sure every inline <script> and <style> in the page has its hash in the policy
//    (Astro doesn't hash `is:inline` scripts, such as the theme script).
// 2. A strict CSP (no 'unsafe-inline') blocks style="" attributes, which
// Expressive Code uses for token colours (style="--0:#24292E;--1:#E1E4E8"). This moves every
// style attribute into one stylesheet: style="X" becomes data-s="<hash>", with a matching
// [data-s="<hash>"]{X} rule, and Expressive Code's span[style^='--'] selector becomes span[data-s].
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, color } from './lib.mjs';
import { inlineHashes } from './csp-hashes.mjs';

const DIST = path.join(ROOT, 'dist');
const ASTRO = path.join(DIST, '_astro');
const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const short = (s, n = 8) => createHash('sha256').update(s).digest('base64url').slice(0, n);

const CSP_META = /<meta http-equiv="content-security-policy"[^>]*>/i;
function addHashes(meta, directive, hashes) {
  return meta.replace(new RegExp(`(${directive} [^;"]*)`), (d) => {
    const have = new Set(d.split(/\s+/));
    const missing = [...new Set(hashes)].filter((h) => !have.has(h));
    added += missing.length;
    return missing.length ? `${d} ${missing.join(' ')}` : d;
  });
}
let moved = 0;
let added = 0;
for (const file of walk(DIST).filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(file, 'utf8');
  let meta = html.match(CSP_META)?.[0];
  if (!meta) continue;
  const { scripts, styles } = inlineHashes(html);
  meta = addHashes(addHashes(meta, 'script-src', scripts), 'style-src', styles);
  const without = html.replace(CSP_META, '');
  const charset = without.match(/<meta charset="[^"]*"\s*\/?>/i)?.[0];
  if (!charset) throw new Error(`No <meta charset> in ${file}`);
  writeFileSync(file, without.replace(charset, `${charset}${meta}`));
  moved++;
}

const rules = new Map(); // key -> declarations
const touched = [];
// Leave the contents of <script> and <style> elements alone; only rewrite markup.
const SPLIT = /(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>)/gi;

for (const file of walk(DIST).filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(file, 'utf8');
  let count = 0;
  const out = html
    .split(SPLIT)
    .map((part, i) => {
      if (i % 2 === 1) return part; // a <script>/<style> block
      return part.replace(/<[a-zA-Z][^<>]*?\sstyle="([^"]*)"[^<>]*>/g, (tag, decl) => {
        const css = decl.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim().replace(/;$/, '');
        if (/[{}<]/.test(css)) throw new Error(`Unexpected characters in a style attribute in ${file}: ${decl}`);
        const key = short(css);
        rules.set(key, css);
        count++;
        return tag.replace(/\sstyle="[^"]*"/, ` data-s="${key}"`);
      });
    })
    .join('');
  if (count) touched.push({ file, out, count });
}

console.log(color.green(`csp-postbuild: moved the CSP <meta> to the top of <head> in ${moved} pages; added ${added} missing inline hashes`));
if (!touched.length) {
  console.log(color.green('csp-postbuild: no style attributes found'));
  process.exit(0);
}

const css = [...rules].map(([k, v]) => `[data-s="${k}"]{${v}}`).join('\n') + '\n';
const cssName = `attr-styles.${short(css)}.css`;
writeFileSync(path.join(ASTRO, cssName), css);

for (const { file, out } of touched) {
  if (!out.includes('</head>')) throw new Error(`No </head> in ${file}`);
  writeFileSync(file, out.replace('</head>', `<link rel="stylesheet" href="/_astro/${cssName}"></head>`));
}

// Expressive Code styles token spans with span[style^='--']; point it at the new attribute.
let ecFixed = 0;
for (const file of readdirSync(ASTRO).filter((f) => /^ec\..*\.css$/.test(f))) {
  const p = path.join(ASTRO, file);
  const before = readFileSync(p, 'utf8');
  const after = before.replaceAll("span[style^='--']", 'span[data-s]');
  if (after !== before) {
    writeFileSync(p, after);
    ecFixed++;
  }
}
const ecUsed = touched.some(({ out }) => out.includes('class="expressive-code'));
if (ecUsed && !ecFixed) {
  throw new Error("Expressive Code's span[style^='--'] selector was not found; its CSS has changed, so code colours would break.");
}

const total = touched.reduce((n, t) => n + t.count, 0);
console.log(color.green(`csp-postbuild: moved ${total} style attributes (${rules.size} unique) from ${touched.length} pages into /_astro/${cssName}`));
