#!/usr/bin/env bats

load '../helpers/setup'

start_fake_health_server() {
  local port="$1"
  local response="$2"
  python3 -c "
import http.server, socketserver, sys, threading
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response($response)
            self.end_headers()
            self.wfile.write(b'ok')
        else:
            self.send_response(404)
            self.end_headers()
    def log_message(self, *a): pass
s = socketserver.TCPServer(('127.0.0.1', $port), H)
threading.Thread(target=s.serve_forever, daemon=True).start()
import time
while True: time.sleep(1)
" &
  echo $! > "${CLAUDE_CALL_TMP}/server.pid"
  for _ in $(seq 1 60); do
    if curl -sS -o /dev/null "http://127.0.0.1:${port}/health" 2>/dev/null; then
      break
    fi
    sleep 0.05
  done
}

stop_fake_health_server() {
  if [ -f "${CLAUDE_CALL_TMP}/server.pid" ]; then
    kill "$(cat "${CLAUDE_CALL_TMP}/server.pid")" 2>/dev/null || true
    rm -f "${CLAUDE_CALL_TMP}/server.pid"
  fi
}

@test "preflight passes when /health returns 200" {
  start_fake_health_server 19101 200
  export PATTER_MCP_URL="http://127.0.0.1:19101/mcp"
  run "${REPO_ROOT}/scripts/preflight.sh"
  stop_fake_health_server
  [ "$status" -eq 0 ]
}

@test "preflight fails when /health returns 500" {
  start_fake_health_server 19102 500
  export PATTER_MCP_URL="http://127.0.0.1:19102/mcp"
  run "${REPO_ROOT}/scripts/preflight.sh"
  stop_fake_health_server
  [ "$status" -ne 0 ]
  [[ "$output" == *"Patter MCP"* ]]
}

@test "preflight fails when no server is listening" {
  export PATTER_MCP_URL="http://127.0.0.1:19199/mcp"
  run "${REPO_ROOT}/scripts/preflight.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"npm run dev"* ]]
}
