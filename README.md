# Jack Keuler · Portfolio

Personal portfolio and resume sites for Jack Keuler:

- **jackkeuler.com**: Senior Software Engineer portfolio, published by GitHub Pages from the repo root.
- **sales.jackkeuler.com**: Sales Engineer portfolio, served by a Cloudflare Worker from `_sales/` (see `_worker/sales-site/README.md`).

Both are static sites with no build step. The only outside resource they load is Google Fonts.

| File | What it is |
| --- | --- |
| `index.html` | jackkeuler.com: the portfolio page plus the resume page at `#resume` |
| `resume/index.html` | Shareable `/resume/` link with its own link preview; sends visitors to `/#resume` |
| `projects/` | Projects page and interactive demos, **shared by both sites** (root-relative links lead back to whichever host served them) |
| `_sales/` | sales.jackkeuler.com pages: `index.html`, `resume/`, link previews, robots and sitemap |
| `_archive/` | Retired sites, not served anywhere |
| `_worker/sales-site/` | The Cloudflare Worker behind sales.jackkeuler.com |
| `favicon.svg` | Browser tab icon |

Don't add a `.nojekyll` file: GitHub Pages' Jekyll step is what keeps the underscore folders (`_sales/`, `_archive/`, `_worker/`) off jackkeuler.com.

## Publish on GitHub Pages

### Option A: in the browser (no Git needed)

1. Sign in to GitHub and create a **new public repository**.
   - Name it `YOUR-USERNAME.github.io` to get the address `https://YOUR-USERNAME.github.io`.
   - Give it any other name (for example `portfolio`) to get `https://YOUR-USERNAME.github.io/portfolio`.
2. On the new repository's page, click **uploading an existing file**. Drag in every file from this folder and click **Commit changes**.
   - On a Mac, Finder hides `.nojekyll`. Press `Cmd + Shift + .` to show it. The site still works if you leave it out.
3. Go to **Settings → Pages**. Under **Build and deployment**, set **Source** to *Deploy from a branch*, then set **Branch** to `main` and the folder to `/ (root)`. Click **Save**.
4. Wait a minute or two, then refresh that page. The site's address appears at the top.

### Option B: from the command line

```bash
cd jack-keuler-portfolio
git init -b main
git add .
git commit -m "Add portfolio site"
git remote add origin https://github.com/YOUR-USERNAME/YOUR-USERNAME.github.io.git
git push -u origin main
```

Create the empty repository on GitHub first, then turn on Pages as in step 3 above.

## Use your own domain (optional)

1. Buy a domain, such as `jackkeuler.com`.
2. In **Settings → Pages → Custom domain**, enter the domain and click **Save**. GitHub adds a `CNAME` file to the repository for you.
3. At your domain registrar, add these DNS records:
   - Four `A` records for `@` pointing to `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`
   - A `CNAME` record for `www` pointing to `YOUR-USERNAME.github.io`
4. After the domain check passes, tick **Enforce HTTPS**.

DNS changes can take up to 48 hours to take effect, though they're usually much quicker.

## Editing

Open `index.html` in any text editor:

- The portfolio content is inside `<main id="view-home">`.
- The resume content is inside `<main id="view-resume">`.
- Colors and fonts are set in the `:root` block at the top of the `<style>` section.

Commit the changed file and GitHub Pages republishes the site within about a minute.
