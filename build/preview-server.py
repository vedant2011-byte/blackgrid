#!/usr/bin/env python3
"""Local preview server for the VEYLORA static site.

Plain `python3 -m http.server` is fine, but it sends ETag/Last-Modified, so a
browser that already loaded an earlier build keeps getting 304s and shows stale
markup. This variant disables caching outright so what you see is always what
is on disk. Development only -- production caching is set in vercel.json.
"""

import http.server
import socketserver
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_header(self, keyword, value):
        # Suppress validators so the browser cannot revalidate into a 304.
        if keyword in ("Last-Modified", "ETag"):
            return
        super().send_header(keyword, value)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("0.0.0.0", PORT), NoCacheHandler) as httpd:
        print(f"VEYLORA preview serving {ROOT} on http://0.0.0.0:{PORT}", flush=True)
        httpd.serve_forever()
