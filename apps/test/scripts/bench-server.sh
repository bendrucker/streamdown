#!/usr/bin/env bash
# Rebuilds apps/test and restarts the production server the bench harness runs
# against. A stale server keeps serving its old build manifest, which silently
# invalidates measurements, so the port is always cleared first.
set -euo pipefail

port="${PORT:-3001}"
app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log="${app_dir}/../../tmp/next-start.log"

cd "$app_dir"

for pid in $(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true); do
  kill -9 "$pid" 2>/dev/null || true
done

if [ "${SKIP_BUILD:-}" != "1" ]; then
  # Turbopack's persistent cache can outlive a change to a workspace dependency
  # and serve the previous build with no warning, which turns an A/B comparison
  # into two runs of A. Discarding it costs a minute and removes the trap.
  rm -rf .next
  pnpm build
fi

mkdir -p "$(dirname "$log")"
nohup node node_modules/next/dist/bin/next start --port "$port" > "$log" 2>&1 &

for _ in $(seq 1 40); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${port}/bench")" = "200" ]; then
    echo "bench server ready on http://localhost:${port}/bench"
    exit 0
  fi
  sleep 0.5
done

echo "bench server failed to start; see ${log}" >&2
tail -20 "$log" >&2
exit 1
