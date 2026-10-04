#!/usr/bin/env bash
set -e

# Disable stdout/stderr buffering so all logs appear live in Render
export PYTHONUNBUFFERED=1

# Constrain thread pools to 1 thread to stay strictly under Render 512MB RAM limit
export OMP_NUM_THREADS=1
export MKL_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
export VECLIB_MAXIMUM_THREADS=1
export NUMEXPR_NUM_THREADS=1

# Limit glibc memory arenas to prevent memory fragmentation on Linux cgroups
export MALLOC_ARENA_MAX=2

# Default ENVIRONMENT to production on Render if not explicitly set
export ENVIRONMENT="${ENVIRONMENT:-production}"

PORT="${PORT:-10000}"
echo "==> [Omni Startup] Launching Uvicorn on 0.0.0.0:${PORT}..."

exec python3 -m uvicorn src.api:app --host 0.0.0.0 --port "$PORT" --log-level info
