import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { markdownResponse, markdownTwin } from '../../lib/markdown-twin';

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
};

export const GET: APIRoute = ({ props }) => {
  const { post } = props as { post: CollectionEntry<'blog'> };
  return markdownResponse(
    markdownTwin({
      title: post.data.title,
      description: post.data.description,
      canonical: `/blog/${post.id}/`,
      meta: `${post.data.date.toISOString().slice(0, 10)}, ${post.data.author}`,
      body: post.body,
    }),
  );
};
