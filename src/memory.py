"""Memory management utilities for constrained cloud environments (e.g. Render 512MB RAM)."""
import gc
import os
import platform
import resource
import ctypes
import ctypes.util

def reclaim_memory():
    """Forces Python garbage collection and glibc heap trim to release RSS back to the OS."""
    gc.collect()
    try:
        libc_name = ctypes.util.find_library("c") or "libc.so.6"
        libc = ctypes.CDLL(libc_name)
        if hasattr(libc, "malloc_trim"):
            libc.malloc_trim(0)
    except Exception:
        pass


def get_rss_mb() -> float:
    """Returns the current process Resident Set Size (RSS) in MB."""
    try:
        rusage = resource.getrusage(resource.RUSAGE_SELF)
        # On Linux ru_maxrss is in kilobytes; on macOS it is in bytes
        if platform.system() == "Darwin":
            return round(rusage.ru_maxrss / (1024 * 1024), 2)
        return round(rusage.ru_maxrss / 1024, 2)
    except Exception:
        return 0.0
