"""Supabase Storage manager with local disk fallback and zero external dependencies."""
import os
import json
import urllib.request
import urllib.parse
import urllib.error
from typing import Optional

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_SERVICE_KEY")
    or os.getenv("SUPABASE_PUBLISHABLE_KEY")
    or os.getenv("SUPABASE_ANON_KEY")
)
BUCKET_NAME = os.getenv("SUPABASE_STORAGE_BUCKET", "documents")


def is_storage_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_KEY)


def get_storage_key(user_id: str, filename: str) -> str:
    return f"{user_id}/{filename}"


def get_encoded_key(user_id: str, filename: str) -> str:
    return f"{urllib.parse.quote(user_id)}/{urllib.parse.quote(filename)}"


def _get_headers() -> dict:
    key = SUPABASE_KEY or ""
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }


def save_file(user_id: str, filename: str, content: bytes, local_path: Optional[str] = None) -> bool:
    """Saves file to local disk cache and uploads to Supabase Storage."""
    if local_path:
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        with open(local_path, "wb") as f:
            f.write(content)

    if not is_storage_configured():
        return bool(local_path)

    base_url = SUPABASE_URL.rstrip("/")
    key = get_storage_key(user_id, filename)
    encoded_key = get_encoded_key(user_id, filename)
    url = f"{base_url}/storage/v1/object/{BUCKET_NAME}/{encoded_key}"

    headers = _get_headers()
    headers["Content-Type"] = "application/octet-stream"
    headers["x-upsert"] = "true"

    try:
        req = urllib.request.Request(url, data=content, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status in (200, 201):
                print(f"[Supabase Storage] Successfully uploaded {key} to bucket '{BUCKET_NAME}'")
                return True
    except urllib.error.HTTPError as exc:
        err_msg = exc.read().decode("utf-8", errors="ignore")
        print(f"[Warning] Supabase Storage upload failed ({exc.code}): {err_msg}")
    except Exception as exc:
        print(f"[Warning] Supabase Storage upload exception: {exc}")

    return bool(local_path)


def get_file_bytes(user_id: str, filename: str, local_path: Optional[str] = None) -> Optional[bytes]:
    """Retrieves file bytes from local cache or downloads from Supabase Storage."""
    if local_path and os.path.exists(local_path):
        try:
            with open(local_path, "rb") as f:
                return f.read()
        except Exception:
            pass

    if not is_storage_configured():
        return None

    base_url = SUPABASE_URL.rstrip("/")
    key = get_storage_key(user_id, filename)
    encoded_key = get_encoded_key(user_id, filename)
    url = f"{base_url}/storage/v1/object/authenticated/{BUCKET_NAME}/{encoded_key}"

    headers = _get_headers()

    try:
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
            if local_path:
                try:
                    os.makedirs(os.path.dirname(local_path), exist_ok=True)
                    with open(local_path, "wb") as f:
                        f.write(data)
                except Exception:
                    pass
            return data
    except urllib.error.HTTPError as exc:
        # Fallback to public object URL in case bucket is public
        try:
            pub_url = f"{base_url}/storage/v1/object/public/{BUCKET_NAME}/{encoded_key}"
            pub_req = urllib.request.Request(pub_url, headers=headers, method="GET")
            with urllib.request.urlopen(pub_req, timeout=15) as resp:
                data = resp.read()
                if local_path:
                    try:
                        os.makedirs(os.path.dirname(local_path), exist_ok=True)
                        with open(local_path, "wb") as f:
                            f.write(data)
                    except Exception:
                        pass
                return data
        except Exception:
            pass
        print(f"[Warning] Supabase Storage download failed ({exc.code}) for {key}")
    except Exception as exc:
        print(f"[Warning] Supabase Storage download exception: {exc}")

    return None


def delete_file(user_id: str, filename: str, local_path: Optional[str] = None) -> bool:
    """Deletes file from local cache and Supabase Storage."""
    if local_path and os.path.exists(local_path):
        try:
            os.remove(local_path)
        except Exception:
            pass

    if not is_storage_configured():
        return True

    base_url = SUPABASE_URL.rstrip("/")
    key = get_storage_key(user_id, filename)
    url = f"{base_url}/storage/v1/object/{BUCKET_NAME}"

    headers = _get_headers()
    headers["Content-Type"] = "application/json"
    body = json.dumps({"prefixes": [key]}).encode("utf-8")

    try:
        req = urllib.request.Request(url, data=body, headers=headers, method="DELETE")
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"[Supabase Storage] Deleted {key} from bucket '{BUCKET_NAME}'")
            return True
    except Exception as exc:
        print(f"[Warning] Supabase Storage delete failed for {key}: {exc}")

    return True
