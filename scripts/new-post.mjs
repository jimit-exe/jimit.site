// npm run new -- <type> "<title>"
// Creates src/content/posts/<slug>/index.md with front matter and that type's section template.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { POSTS_DIR, TYPES, slugify, today, rel, color } from './lib.mjs';

const SECTIONS = {
  writeup: [
    ['The chain at a glance', 'Three to five bullets: entry point, foothold, escalation, impact.'],
    ['Enumeration', 'What you scanned, what stood out, and why.'],
    ['Foothold', 'The first working exploit, step by step.'],
    ['Privilege escalation', 'How you went from user to root/admin.'],
    ['Root cause', 'The underlying mistake, in one or two sentences.'],
    ['Fix', 'What the developer or admin should change.'],
    ['How to detect it', 'Logs, alerts or queries a defender would use.'],
    ["What I'd do differently", 'One honest mistake or rabbit hole, and how you noticed.'],
  ],
  project: [
    ['What it does', 'The problem and who it is for.'],
    ['How it works', 'Architecture and key design choices.'],
    ['Security review', 'Threats you considered and how the design handles them.'],
    ['What I learned', 'What you would change next time.'],
  ],
  methodology: [],
  blog: [],
};

const [type, ...titleParts] = process.argv.slice(2);
const title = titleParts.join(' ').trim();

function die(msg) {
  console.error(color.red(`✖ ${msg}`));
  console.error(`Usage: npm run new -- <${TYPES.join('|')}> "Post title"`);
  process.exit(1);
}

if (!TYPES.includes(type)) die(type ? `Unknown type "${type}".` : 'Missing the post type.');
if (!title) die('Missing the post title.');
if (title.length > 90) die(`Title is ${title.length} characters; the limit is 90.`);

const slug = slugify(title);
if (!slug) die('The title has no letters or numbers to make a slug from.');
const dir = path.join(POSTS_DIR, slug);
if (existsSync(dir)) die(`${rel(dir)} already exists. Slugs must be unique across all post types.`);

const q = (s) => JSON.stringify(s);
const fm = [
  '---',
  `title: ${q(title)}`,
  `date: ${today()}`,
  `type: ${type}`,
  'summary: "[YOUR WORDS] One or two sentences for post cards, link previews and search results."',
  'tags: [needs-tags] # [VERIFY] replace with 1 to 8 lowercase kebab-case tags',
];
if (type === 'writeup') fm.push('# platform: Hack The Box', '# difficulty: easy # beginner | easy | medium | hard | insane');
if (type === 'project') fm.push('# repo: https://github.com/jimit-exe/<repo>');
fm.push('# cover: ./cover.png', '# coverAlt: Describe the cover image', '# featured: true', 'draft: true', '---', '');

const body = SECTIONS[type].length
  ? SECTIONS[type].map(([h, hint]) => `## ${h}\n\n[YOUR WORDS] ${hint}\n`).join('\n')
  : '[YOUR WORDS] Start writing here. Use ## for section headings; the title is the page heading.\n';

mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'index.md');
writeFileSync(file, fm.join('\n') + '\n' + body);

console.log(color.green(`✔ Created ${rel(file)}`));
console.log(`  Preview: npm run dev, then open /${{ writeup: 'writeups', project: 'projects' }[type] ?? 'blog'}/${slug}`);
console.log('  Screenshots go in the same folder, named 01-what-it-shows.png in reading order.');
console.log(color.dim('  It stays a draft until you set draft: false and every [YOUR WORDS]/[VERIFY] marker is gone.'));
