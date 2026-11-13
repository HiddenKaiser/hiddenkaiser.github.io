"""Local preview of sales.jackkeuler.com: serves this checkout with the same routing as src/index.js.

    python _worker/sales-site/preview.py [port]      (default port 8124)

Pages come from _sales/; the files both sites share (projects pages, demo scripts, photo, favicon, 404) come
from the repo root, exactly like the Worker. Keep SHARED_FILES / SHARED_DIRS in step with src/index.js.
"""
import http.server
import mimetypes
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
SITE_DIR = ROOT / "_sales"
SHARED_FILES = {"/404.html", "/favicon.svg", "/photo.jpg", "/cloth-preview.js", "/glass-preview.js",
                "/og-projects.png", "/og-cloth.png", "/og-glass.png"}
SHARED_DIRS = ("/projects/",)


def source(file):
    shared = file in SHARED_FILES or file.startswith(SHARED_DIRS)
    return (ROOT if shared else SITE_DIR) / file.lstrip("/")


class Handler(http.server.BaseHTTPRequestHandler):
    def do_HEAD(self):
        self.do_GET(head=True)

    def do_GET(self, head=False):
        parts = urlsplit(self.path)
        path = unquote(parts.path)
        if ".." in path or "\\" in path or "//" in path or "/." in path:
            return self.send_file("/404.html", 404, head)
        has_ext = "." in path.rsplit("/", 1)[-1]
        if not has_ext and not path.endswith("/"):
            self.send_response(301)
            self.send_header("Location", path + "/" + (("?" + parts.query) if parts.query else ""))
            self.end_headers()
            return
        file = path + "index.html" if path.endswith("/") else path
        if source(file).is_file():
            return self.send_file(file, 200, head)
        return self.send_file("/404.html", 404, head)

    def send_file(self, file, status, head):
        body = source(file).read_bytes()
        ctype = mimetypes.guess_type(file)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
            ctype += "; charset=utf-8"
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if not head:
            self.wfile.write(body)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
    print(f"sales.jackkeuler.com preview on http://localhost:{port}/")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
