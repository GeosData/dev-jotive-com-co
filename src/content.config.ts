import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).optional().default([]),
    readTime: z.string().optional(),
    // Dual-purpose post + video script (ref Memory/reference_post_video_dual.md)
    videoLength: z.string().optional(),
    youtube_id: z.string().optional().default(''),
    video_status: z.enum(['draft', 'recorded', 'published']).optional().default('draft'),
    script_version: z.number().optional().default(1),
    image: z.string().optional(),
    imageAlt: z.string().optional(),
  }),
});

export const collections = { blog };
