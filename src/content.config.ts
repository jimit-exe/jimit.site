import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

export const POST_TYPES = ['writeup', 'methodology', 'project', 'blog'] as const;
export const DIFFICULTIES = ['beginner', 'easy', 'medium', 'hard', 'insane'] as const;

const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Every post is a folder: src/content/posts/<slug>/index.md plus its images.
 * The folder name is the slug, so ids are unique across all post types.
 */
const posts = defineCollection({
  loader: glob({
    base: './src/content/posts',
    pattern: '*/index.md',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: ({ image }) =>
    z
      .object({
        title: z.string().min(1).max(90, 'title must be 90 characters or fewer'),
        date: z.coerce.date(),
        updated: z.coerce.date().optional(),
        type: z.enum(POST_TYPES),
        summary: z
          .string()
          .min(50, 'summary must be at least 50 characters')
          .max(200, 'summary must be 200 characters or fewer'),
        tags: z
          .array(z.string().regex(kebab, 'tags must be lowercase kebab-case, e.g. "web-security"'))
          .min(1, 'at least one tag is required')
          .max(8, 'no more than 8 tags'),
        cover: image().optional(),
        coverAlt: z.string().min(1).optional(),
        platform: z.string().min(1).optional(),
        difficulty: z.enum(DIFFICULTIES).optional(),
        repo: z
          .string()
          .url()
          .refine((u) => u.startsWith('https://'), 'repo must be an https:// URL')
          .optional(),
        featured: z.boolean().default(false),
        draft: z.boolean().default(true),
      })
      .strict()
      .superRefine((d, ctx) => {
        if (d.updated && d.updated < d.date) {
          ctx.addIssue({ code: 'custom', path: ['updated'], message: 'updated must not be earlier than date' });
        }
        if (d.cover && !d.coverAlt) {
          ctx.addIssue({ code: 'custom', path: ['coverAlt'], message: 'coverAlt is required when cover is set' });
        }
        if (d.type !== 'writeup') {
          for (const f of ['platform', 'difficulty'] as const) {
            if (d[f] !== undefined) {
              ctx.addIssue({ code: 'custom', path: [f], message: `${f} is only allowed on writeups` });
            }
          }
        }
        if (d.type !== 'project' && d.repo !== undefined) {
          ctx.addIssue({ code: 'custom', path: ['repo'], message: 'repo is only allowed on projects' });
        }
      }),
});

export const collections = { posts };
