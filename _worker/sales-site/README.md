# sales.jackkeuler.com Worker

Serves the Sales Engineer site at https://sales.jackkeuler.com, reading files straight from GitHub:

- `_sales/` holds the pages of this site: the home page (`index.html`, with the resume at `#resume`), the
  `/resume/` share link, link-preview images, `robots.txt` and `sitemap.xml`.
- The projects pages (`projects/`), their demo scripts, the photo, favicon and 404 page are **shared** with
  jackkeuler.com: the Worker serves them from the repo root, so there is one copy of each. Their links are
  root-relative, so on this host they lead back to sales.jackkeuler.com. The shared list is `SHARED_FILES` /
  `SHARED_DIRS` in `src/index.js`.

Nothing else is reachable here, including the archived sales-rep site in `_archive/`.

Edit files and push: the live site updates within about two minutes. You only need to redeploy this Worker when
`src/index.js` or `cloudflare.config.ts` changes:

```bash
cd _worker/sales-site
npm install
npx cf deploy
```

## Preview locally

```bash
python _worker/sales-site/preview.py
```

This serves the local checkout on http://localhost:8124 with the same routing as the Worker (keep its shared list
in step with `src/index.js`).

GitHub Pages skips folders that start with an underscore, so `_sales/`, `_archive/` and `_worker/` are never
published on jackkeuler.com.
