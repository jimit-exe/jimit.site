import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPosts, postUrl, TYPE_LABEL } from '../lib/posts';
import { site } from '../lib/site';

export async function GET(context: APIContext) {
  // Drafts never go in the feed, even in local preview.
  const posts = await getPosts((p) => p.data.draft === false);
  return rss({
    title: `${site.name}: writeups, projects and notes`,
    description: site.pitch,
    site: context.site ?? site.url,
    trailingSlash: false,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.summary,
      pubDate: p.data.date,
      link: postUrl(p),
      categories: [TYPE_LABEL[p.data.type], ...p.data.tags],
    })),
    customData: '<language>en-AU</language>',
  });
}
