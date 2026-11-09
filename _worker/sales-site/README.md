# sales.jackkeuler.com Worker

Serves the `_sales/` folder of this repository at https://sales.jackkeuler.com, reading files straight from
GitHub. Edit files in `_sales/` and push: the live site updates within about two minutes. You only need to
redeploy this Worker when `src/index.js` or `cloudflare.config.ts` changes:

```bash
cd _worker/sales-site
npm install
cf deploy
```

GitHub Pages skips folders that start with an underscore, so neither `_sales/` nor `_worker/` is published on
jackkeuler.com.
