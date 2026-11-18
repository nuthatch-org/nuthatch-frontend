import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { markdownResponse, markdownTwin } from '../../lib/markdown-twin';

export const getStaticPaths: GetStaticPaths = async () => {
  const docs = await getCollection('docs');
  return docs.map((doc) => ({ params: { slug: doc.id }, props: { doc } }));
};

export const GET: APIRoute = ({ props }) => {
  const { doc } = props as { doc: CollectionEntry<'docs'> };
  return markdownResponse(
    markdownTwin({
      title: doc.data.title,
      description: doc.data.description,
      canonical: `/docs/${doc.id}/`,
      meta: doc.data.checked ? `Checked against Nuthatch ${doc.data.checked}.` : undefined,
      body: doc.body,
    }),
  );
};
