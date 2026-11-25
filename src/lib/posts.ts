import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;
export type PostType = Post['data']['type'];

/** URL section for each post type. methodology posts live under /blog. */
export const SECTION: Record<PostType, 'writeups' | 'blog' | 'projects'> = {
  writeup: 'writeups',
  methodology: 'blog',
  blog: 'blog',
  project: 'projects',
};

export const TYPE_LABEL: Record<PostType, string> = {
  writeup: 'Writeup',
  methodology: 'Methodology',
  blog: 'Blog',
  project: 'Project',
};

/** Drafts are visible in `astro dev` (with a banner) and excluded from production builds. */
export const showDrafts = import.meta.env.DEV;

export const postUrl = (p: Post) => `/${SECTION[p.data.type]}/${p.id}`;

const byNewest = (a: Post, b: Post) => b.data.date.valueOf() - a.data.date.valueOf();

/** All posts that should be visible in this build, newest first. */
export async function getPosts(filter?: (p: Post) => boolean): Promise<Post[]> {
  const all = await getCollection('posts', (p) => showDrafts || p.data.draft === false);
  return (filter ? all.filter(filter) : all).sort(byNewest);
}

export const inSection = (section: string) => (p: Post) => SECTION[p.data.type] === section;

export const formatDate = (d: Date) =>
  d.toLocaleDateString('en-AU', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** ~230 words per minute, counting code as words too. */
export function readingTime(body: string | undefined): number {
  const words = (body ?? '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

/** Previous (older) and next (newer) published post of the same type. */
export async function getAdjacent(post: Post): Promise<{ prev?: Post; next?: Post }> {
  const same = await getPosts((p) => p.data.type === post.data.type);
  const i = same.findIndex((p) => p.id === post.id);
  // `same` is newest first, so the newer post sits before this one.
  return { next: i > 0 ? same[i - 1] : undefined, prev: i >= 0 ? same[i + 1] : undefined };
}

/** Up to `limit` other posts ranked by how many tags they share with `post`, then by date. */
export async function getRelated(post: Post, limit = 3): Promise<Post[]> {
  const mine = new Set(post.data.tags);
  const others = await getPosts((p) => p.id !== post.id);
  return others
    .map((p) => ({ p, shared: p.data.tags.filter((t) => mine.has(t)).length }))
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.shared - a.shared || b.p.data.date.valueOf() - a.p.data.date.valueOf())
    .slice(0, limit)
    .map((x) => x.p);
}

/** Every tag in use with its post count, most used first, then alphabetical. */
export async function getTags(): Promise<{ tag: string; count: number }[]> {
  const counts = new Map<string, number>();
  for (const p of await getPosts()) for (const t of p.data.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Distinct values of one field across `posts`, with counts, most common first. */
export function countBy(posts: Post[], pick: (p: Post) => string | string[] | undefined) {
  const counts = new Map<string, number>();
  for (const p of posts) {
    const v = pick(p);
    for (const x of Array.isArray(v) ? v : v ? [v] : []) counts.set(x, (counts.get(x) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
