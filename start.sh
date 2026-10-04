#!/usr/bin/env bash
set -e

# Disable stdout/stderr buffering so all logs appear live in Render
export PYTHONUNBUFFERED=1

# Configure thread pools for optimal ONNX / CPU embedding speed without RAM spikes
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-2}"
export MKL_NUM_THREADS="${MKL_NUM_THREADS:-2}"
export OPENBLAS_NUM_THREADS="${OPENBLAS_NUM_THREADS:-2}"
export VECLIB_MAXIMUM_THREADS="${VECLIB_MAXIMUM_THREADS:-2}"
export NUMEXPR_NUM_THREADS="${NUMEXPR_NUM_THREADS:-2}"

# Default ENVIRONMENT to production on Render if not explicitly set
export ENVIRONMENT="${ENVIRONMENT:-production}"

PORT="${PORT:-10000}"
echo "==> [Omni Startup] Launching Uvicorn on 0.0.0.0:${PORT}..."

exec python3 -m uvicorn src.api:app --host 0.0.0.0 --port "$PORT" --log-level info
