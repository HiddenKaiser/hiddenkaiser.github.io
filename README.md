# Jack Keuler · Portfolio

Personal portfolio and resume site for Jack Keuler, Sales Engineer.

It's a static site with no build step: one `index.html` file holds the pages, styles and scripts. The only outside resource it loads is Google Fonts.

| File | What it is |
| --- | --- |
| `index.html` | The whole site: the portfolio page plus the resume page at `#resume` |
| `favicon.svg` | Browser tab icon |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are, without running Jekyll |

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
