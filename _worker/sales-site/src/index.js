/* Serves sales.jackkeuler.com from the _sales/ folder of the GitHub repo that also hosts jackkeuler.com.

   GitHub Pages publishes jackkeuler.com and skips folders that start with an underscore, so _sales/ is never
   reachable from jackkeuler.com. This Worker reads only files inside _sales/, so nothing from the main site is
   reachable from sales.jackkeuler.com either. Pushing to GitHub updates the site; files are cached at the edge
   for CACHE_SECONDS. */
const ORIGIN = 'https://raw.githubusercontent.com/HiddenKaiser/hiddenkaiser.github.io/master/_sales';
const CACHE_SECONDS = 120;
const TYPES = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', xml: 'application/xml; charset=utf-8', txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  ico: 'image/x-icon', pdf: 'application/pdf', woff2: 'font/woff2',
};

export default {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const url = new URL(request.url);
    if (url.protocol === 'http:') { url.protocol = 'https:'; return Response.redirect(url.href, 301); }
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { return notFound(request); }
    // nothing outside _sales/, and no hidden files
    if (path.includes('..') || path.includes('\\') || path.includes('//') || /\/\./.test(path)) return notFound(request);
    // one URL per page: /resume/ -> /resume
    if (path.length > 1 && path.endsWith('/')) return Response.redirect(url.origin + path.slice(0, -1) + url.search, 301);

    // /            -> index.html
    // /resume      -> resume/index.html
    // /site.css    -> site.css
    const file = path === '/' ? '/index.html' : /\.[a-z0-9]+$/i.test(path) ? path : path + '/index.html';
    const res = await fromOrigin(file);
    return res.ok ? respond(request, res, file, 200) : notFound(request);
  },
};

function fromOrigin(file) {
  return fetch(ORIGIN + encodeURI(file), { cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true } });
}

// Build fresh headers: the raw-file server marks everything text/plain with a restrictive sandbox policy.
function respond(request, res, file, status) {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  const headers = new Headers({
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': ext === 'html' ? 'public, max-age=0, must-revalidate' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  const etag = res.headers.get('ETag');
  if (etag) headers.set('ETag', etag);
  return new Response(request.method === 'HEAD' ? null : res.body, { status, headers });
}

async function notFound(request) {
  const res = await fromOrigin('/404.html');
  if (res.ok) return respond(request, res, '/404.html', 404);
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
