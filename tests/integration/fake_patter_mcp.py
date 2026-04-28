#!/usr/bin/env python3
"""Fake patter-mcp HTTP server for integration tests. Stdlib only.

Usage: fake_patter_mcp.py <port> <log_file>

  GET  /health  -> 200 "ok"
  POST /mcp     -> 200 with a canned MCP response; appends request body to log_file.
"""
from __future__ import annotations
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1])
LOG_PATH = sys.argv[2]

_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if not self.path.startswith("/mcp"):
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8") if length else ""
        with _lock:
            with open(LOG_PATH, "a", encoding="utf-8") as f:
                f.write(body.replace("\n", " ") + "\n")
        try:
            req = json.loads(body) if body else {}
        except Exception:
            req = {}
        rid = req.get("id", 1)
        resp = {
            "jsonrpc": "2.0",
            "id": rid,
            "result": {
                "content": [{"type": "text", "text": "Call initiated. Call ID: fake-call-001"}],
            },
        }
        payload = json.dumps(resp).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        return


def main() -> None:
    open(LOG_PATH, "w").close()
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
