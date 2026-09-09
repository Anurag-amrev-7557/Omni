#!/usr/bin/env bash
set -e

# Disable stdout/stderr buffering so all logs appear live in Render
export PYTHONUNBUFFERED=1

# Constrain thread pools to 1 thread to stay well under 512MB RAM limit
export OMP_NUM_THREADS=1
export MKL_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
export VECLIB_MAXIMUM_THREADS=1
export NUMEXPR_NUM_THREADS=1

PORT="${PORT:-10000}"
echo "==> [Omni Startup] Launching Uvicorn on 0.0.0.0:${PORT}..."

exec python3 -m uvicorn src.api:app --host 0.0.0.0 --port "$PORT" --log-level info
