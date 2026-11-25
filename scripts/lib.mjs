// Shared helpers for the authoring scripts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import YAML from 'yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const POSTS_DIR = path.join(ROOT, 'src/content/posts');
export const TYPES = ['writeup', 'methodology', 'project', 'blog'];

/** "HTB Reactor: Next.js RCE!" -> "htb-reactor-next-js-rce" */
export const slugify = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');

/** Today's date in local time as YYYY-MM-DD. */
export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Split a post into its front matter object, the raw front matter text, and the body. */
export function readPost(file) {
  const text = readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { text, data: {}, fmText: '', body: text, bodyStartLine: 1, error: 'no front matter' };
  let data = {};
  let error;
  try {
    data = YAML.parse(m[1]) ?? {};
  } catch (e) {
    error = `front matter is not valid YAML: ${e.message.split('\n')[0]}`;
  }
  const bodyStartLine = m[0].split('\n').length;
  return { text, data, fmText: m[1], body: text.slice(m[0].length), bodyStartLine, error };
}

export const rel = (p) => path.relative(ROOT, p);

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const color = { red: c('31'), yellow: c('33'), green: c('32'), dim: c('2'), bold: c('1') };
