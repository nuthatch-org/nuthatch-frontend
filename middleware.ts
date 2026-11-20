// A stopgap subgraph's page URL also answers GraphQL. People paste the page link into their app as
// its query URL, and a static page answers a POST with 405, so POST and its preflight are forwarded
// to the endpoint; every other request carries on to the page.
//
// A docs page or blog post asked for with `Accept: text/markdown` is answered with its .md twin
// (#2980). The twin is a static file beside the page; this only chooses which of the two to send.
export const config = {
  matcher: ['/subgraphs/:id', '/subgraphs/:id/', '/docs', '/docs/:path*', '/blog/:path+'],
};

const DEPLOYMENT = /^\/subgraphs\/(Qm[1-9A-HJ-NP-Za-km-z]{44})\/?$/;
const UPSTREAM = 'https://subgraphs.nuthatch-indexer.com/subgraphs/id/';
const TWINNED = /^\/(docs(\/.+)?|blog\/.+)$/;
const MARKDOWN = /(^|,)\s*text\/markdown\s*(;|,|$)/i;

const next = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

async function markdownTwin(request: Request): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (!MARKDOWN.test(request.headers.get('accept') ?? '')) return null;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('.md') || !TWINNED.test(path)) return null;
  const twin = await fetch(new URL(`${path}.md`, url));
  if (!twin.ok) return null;
  return new Response(request.method === 'HEAD' ? null : twin.body, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-location': `${path}.md`,
      vary: 'Accept',
    },
  });
}

export default async function middleware(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith('/subgraphs/')) return (await markdownTwin(request)) ?? next();
  const m = pathname.match(DEPLOYMENT);
  if (!m || (request.method !== 'POST' && request.method !== 'OPTIONS')) {
    return next();
  }
  const headers = new Headers();
  for (const h of ['content-type', 'accept', 'origin', 'access-control-request-method', 'access-control-request-headers']) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  const upstream = await fetch(UPSTREAM + m[1], {
    method: request.method,
    headers,
    body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
  });
  return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
}
