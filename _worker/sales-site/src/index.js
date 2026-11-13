/* Serves sales.jackkeuler.com from the GitHub repo that also hosts jackkeuler.com.

   - Pages of this site (home, resume, robots, sitemap, link-preview images) come from the _sales/ folder.
   - Files both sites use (the projects pages, their demo scripts, the photo, favicon and 404 page) come from the
     repo root, the same files GitHub Pages publishes on jackkeuler.com, so they are never copied. Their links are
     root-relative ("/", "/#resume"), so on this host they lead back to sales.jackkeuler.com.

   GitHub Pages skips folders that start with an underscore, so _sales/ and _archive/ never appear on
   jackkeuler.com, and this Worker reads only _sales/ plus the SHARED list below, so nothing else in the repo
   (including _archive/) is reachable here. Pushing to GitHub updates the site; files are cached at the edge
   for CACHE_SECONDS. */
const REPO = 'https://raw.githubusercontent.com/HiddenKaiser/hiddenkaiser.github.io/master';
const SITE_DIR = '/_sales';
const CACHE_SECONDS = 120;

// Served from the repo root instead of _sales/: exact files, plus everything under /projects/.
const SHARED_FILES = new Set([
  '/404.html', '/favicon.svg', '/photo.jpg', '/cloth-preview.js', '/glass-preview.js',
  '/og-projects.png', '/og-cloth.png', '/og-glass.png',
]);
const SHARED_DIRS = ['/projects/'];

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
    // no climbing out of the served folders, and no hidden files
    if (path.includes('..') || path.includes('\\') || path.includes('//') || /\/\./.test(path)) return notFound(request);

    // Same URL shape as GitHub Pages, so relative links in shared pages resolve the same way on both hosts:
    // /projects -> 301 /projects/ ; /projects/ -> projects/index.html ; /site.js -> site.js
    const hasExt = /\.[a-z0-9]+$/i.test(path);
    if (!hasExt && !path.endsWith('/')) return Response.redirect(url.origin + path + '/' + url.search, 301);
    const file = path.endsWith('/') ? path + 'index.html' : path;

    const res = await fromOrigin(file);
    return res.ok ? respond(request, res, file, 200) : notFound(request);
  },
};

function isShared(file) {
  return SHARED_FILES.has(file) || SHARED_DIRS.some((dir) => file.startsWith(dir));
}

function fromOrigin(file) {
  const src = REPO + (isShared(file) ? '' : SITE_DIR) + file;
  return fetch(encodeURI(src), { cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true } });
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
