"""
Supabase Storage Integration for File Uploads

Handles uploading/downloading files to Supabase Storage bucket instead of local filesystem.
This ensures files persist across Render deployments.
"""

import os
import io
from typing import Optional, BinaryIO
from supabase import create_client, Client

# Lazy-load Supabase client
_supabase_client: Optional[Client] = None

def get_supabase_client() -> Client:
    """Get or initialize the Supabase client."""
    global _supabase_client
    
    if _supabase_client is not None:
        return _supabase_client
    
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip() or 
        os.getenv("SUPABASE_SERVICE_KEY", "").strip() or 
        os.getenv("SUPABASE_KEY", "").strip()
    )
    if not supabase_url or not supabase_key:
        try:
            from dotenv import load_dotenv
            load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
            supabase_url = os.getenv("SUPABASE_URL", "").strip()
            supabase_key = (
                os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip() or 
                os.getenv("SUPABASE_SERVICE_KEY", "").strip() or 
                os.getenv("SUPABASE_KEY", "").strip()
            )
        except Exception:
            pass
    
    if not supabase_url or not supabase_key:
        raise ValueError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) environment variables must be set"
        )
    
    _supabase_client = create_client(supabase_url, supabase_key)
    return _supabase_client

def upload_file(
    file_path: str,
    bucket_name: str = "documents",
    remote_path: Optional[str] = None
) -> str:
    """
    Upload a local file to Supabase Storage.
    
    Args:
        file_path: Local path to file
        bucket_name: Supabase bucket name (default: "documents")
        remote_path: Remote path in bucket (default: filename)
    
    Returns:
        Remote path in bucket
    
    Raises:
        FileNotFoundError: If local file doesn't exist
        ValueError: If Supabase not configured
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    
    if not remote_path:
        remote_path = os.path.basename(file_path)
    
    try:
        client = get_supabase_client()
        
        with open(file_path, "rb") as f:
            file_content = f.read()
        
        # Upload to Supabase Storage
        response = client.storage.from_(bucket_name).upload(
            path=remote_path,
            file=file_content,
            file_options={"upsert": "true"}  # Overwrite if exists
        )
        
        print(f"[Supabase] ✓ Uploaded {file_path} to {bucket_name}/{remote_path}")
        return remote_path
    
    except Exception as e:
        print(f"[Supabase] Error uploading {file_path}: {e}")
        raise

def upload_bytes(
    file_bytes: bytes,
    remote_path: str,
    bucket_name: str = "documents"
) -> str:
    """
    Upload bytes directly to Supabase Storage.
    
    Args:
        file_bytes: File content as bytes
        remote_path: Remote path in bucket
        bucket_name: Supabase bucket name
    
    Returns:
        Remote path in bucket
    """
    try:
        client = get_supabase_client()
        
        response = client.storage.from_(bucket_name).upload(
            path=remote_path,
            file=file_bytes,
            file_options={"upsert": "true"}
        )
        
        print(f"[Supabase] ✓ Uploaded {len(file_bytes)} bytes to {bucket_name}/{remote_path}")
        return remote_path
    
    except Exception as e:
        print(f"[Supabase] Error uploading to {remote_path}: {e}")
        raise

def download_file(
    remote_path: str,
    local_path: str,
    bucket_name: str = "documents"
) -> str:
    """
    Download a file from Supabase Storage.
    
    Args:
        remote_path: Remote path in bucket
        local_path: Local path to save to
        bucket_name: Supabase bucket name
    
    Returns:
        Local path
    """
    try:
        client = get_supabase_client()
        
        # Download file
        response = client.storage.from_(bucket_name).download(remote_path)
        
        # Save to local path
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        with open(local_path, "wb") as f:
            f.write(response)
        
        print(f"[Supabase] ✓ Downloaded {remote_path} to {local_path}")
        return local_path
    
    except Exception as e:
        print(f"[Supabase] Error downloading {remote_path}: {e}")
        raise

def download_bytes(
    remote_path: str,
    bucket_name: str = "documents"
) -> bytes:
    """
    Download a file from Supabase Storage as bytes.
    
    Args:
        remote_path: Remote path in bucket
        bucket_name: Supabase bucket name
    
    Returns:
        File content as bytes
    """
    try:
        client = get_supabase_client()
        response = client.storage.from_(bucket_name).download(remote_path)
        print(f"[Supabase] ✓ Downloaded {remote_path} ({len(response)} bytes)")
        return response
    
    except Exception as e:
        print(f"[Supabase] Error downloading {remote_path}: {e}")
        raise

def delete_file(
    remote_path: str,
    bucket_name: str = "documents"
) -> bool:
    """
    Delete a file from Supabase Storage.
    
    Args:
        remote_path: Remote path in bucket
        bucket_name: Supabase bucket name
    
    Returns:
        True if deleted successfully
    """
    try:
        client = get_supabase_client()
        response = client.storage.from_(bucket_name).remove([remote_path])
        print(f"[Supabase] ✓ Deleted {remote_path}")
        return True
    
    except Exception as e:
        print(f"[Supabase] Error deleting {remote_path}: {e}")
        return False

def list_files(
    prefix: str = "",
    bucket_name: str = "documents"
) -> list[dict]:
    """
    List files in Supabase Storage bucket.
    
    Args:
        prefix: Filter by path prefix
        bucket_name: Supabase bucket name
    
    Returns:
        List of file objects with name, id, updated_at, etc.
    """
    try:
        client = get_supabase_client()
        response = client.storage.from_(bucket_name).list(prefix)
        print(f"[Supabase] ✓ Listed {len(response)} files in {bucket_name}/{prefix}")
        return response
    
    except Exception as e:
        print(f"[Supabase] Error listing files: {e}")
        return []

def get_public_url(
    remote_path: str,
    bucket_name: str = "documents",
    expires_in: int = 3600
) -> str:
    """
    Get a public/temporary URL for a file.
    
    Args:
        remote_path: Remote path in bucket
        bucket_name: Supabase bucket name
        expires_in: Expiration time in seconds (default 1 hour)
    
    Returns:
        Public URL
    """
    try:
        client = get_supabase_client()
        url = client.storage.from_(bucket_name).create_signed_url(
            path=remote_path,
            expires_in=expires_in
        )
        return url["signedURL"]
    
    except Exception as e:
        print(f"[Supabase] Error creating signed URL: {e}")
        raise

def file_exists(
    remote_path: str,
    bucket_name: str = "documents"
) -> bool:
    """
    Check if a file exists in Supabase Storage.
    
    Args:
        remote_path: Remote path in bucket
        bucket_name: Supabase bucket name
    
    Returns:
        True if file exists
    """
    try:
        files = list_files(bucket_name=bucket_name)
        return any(f["name"] == remote_path for f in files)
    except Exception:
        return False

def get_user_files(
    user_id: str,
    bucket_name: str = "documents"
) -> list[dict]:
    """
    List all files for a specific user.
    
    Args:
        user_id: User ID
        bucket_name: Supabase bucket name
    
    Returns:
        List of user's files
    """
    prefix = f"users/{user_id}/"
    return list_files(prefix=prefix, bucket_name=bucket_name)
