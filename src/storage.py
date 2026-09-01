"""Cloudflare R2 (S3-compatible) storage manager with local disk fallback."""
import os
import io
import tempfile
from typing import Optional

R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME")
R2_ENDPOINT_URL = os.getenv("R2_ENDPOINT_URL")

_s3_client = None

def is_r2_configured() -> bool:
    return bool(R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME and (R2_ACCOUNT_ID or R2_ENDPOINT_URL))

def get_s3_client():
    global _s3_client
    if _s3_client is not None:
        return _s3_client

    if not is_r2_configured():
        return None

    try:
        import boto3
        from botocore.config import Config

        endpoint = R2_ENDPOINT_URL or f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
        _s3_client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto",
            config=Config(signature_version="s3v4"),
        )
        return _s3_client
    except Exception as exc:
        print(f"[Warning] Failed to initialize R2 S3 client: {exc}")
        return None

def get_storage_key(user_id: str, filename: str) -> str:
    return f"{user_id}/{filename}"

def save_file(user_id: str, filename: str, content: bytes, local_path: Optional[str] = None) -> bool:
    """Saves file to Cloudflare R2 and optionally local disk cache."""
    if local_path:
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        with open(local_path, "wb") as f:
            f.write(content)

    client = get_s3_client()
    if client and R2_BUCKET_NAME:
        try:
            key = get_storage_key(user_id, filename)
            client.put_object(Bucket=R2_BUCKET_NAME, Key=key, Body=content)
            print(f"[Storage] Uploaded {key} to Cloudflare R2 bucket '{R2_BUCKET_NAME}'")
            return True
        except Exception as exc:
            print(f"[Warning] Error uploading to Cloudflare R2: {exc}")
    return bool(local_path)

def get_file_bytes(user_id: str, filename: str, local_path: Optional[str] = None) -> Optional[bytes]:
    """Retrieves file bytes from local cache or Cloudflare R2."""
    if local_path and os.path.exists(local_path):
        try:
            with open(local_path, "rb") as f:
                return f.read()
        except Exception:
            pass

    client = get_s3_client()
    if client and R2_BUCKET_NAME:
        try:
            key = get_storage_key(user_id, filename)
            response = client.get_object(Bucket=R2_BUCKET_NAME, Key=key)
            data = response["Body"].read()
            if local_path:
                try:
                    os.makedirs(os.path.dirname(local_path), exist_ok=True)
                    with open(local_path, "wb") as f:
                        f.write(data)
                except Exception:
                    pass
            return data
        except Exception as exc:
            print(f"[Warning] Error downloading from Cloudflare R2 ({key}): {exc}")

    return None

def delete_file(user_id: str, filename: str, local_path: Optional[str] = None) -> bool:
    """Deletes file from local cache and Cloudflare R2."""
    if local_path and os.path.exists(local_path):
        try:
            os.remove(local_path)
        except Exception:
            pass

    client = get_s3_client()
    if client and R2_BUCKET_NAME:
        try:
            key = get_storage_key(user_id, filename)
            client.delete_object(Bucket=R2_BUCKET_NAME, Key=key)
            print(f"[Storage] Deleted {key} from Cloudflare R2")
            return True
        except Exception as exc:
            print(f"[Warning] Error deleting from Cloudflare R2: {exc}")
    return True
