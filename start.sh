#!/bin/bash
set -e

echo "=== Starting Omni RAG Backend ==="
PORT=${PORT:-10000}
echo "Starting uvicorn server on 0.0.0.0:$PORT"

if [ -f ".venv/bin/uvicorn" ]; then
    exec .venv/bin/uvicorn src.api:app --host 0.0.0.0 --port "$PORT" --log-level info
elif command -v uvicorn >/dev/null 2>&1; then
    exec uvicorn src.api:app --host 0.0.0.0 --port "$PORT" --log-level info
else
    exec python3 -m uvicorn src.api:app --host 0.0.0.0 --port "$PORT" --log-level info
fi
