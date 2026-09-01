"""Audio transcription service using Groq Whisper LPUs."""
import os
import io
import json
import urllib.request
import urllib.error

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

def transcribe_audio(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """Transcribes audio using Groq's ultra-fast Whisper LPU endpoint."""
    api_key = os.getenv("GROQ_API_KEY") or GROQ_API_KEY
    if not api_key:
        raise ValueError("GROQ_API_KEY is not configured")

    url = "https://api.groq.com/openai/v1/audio/transcriptions"
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    
    body = bytearray()
    
    # model field
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(b'Content-Disposition: form-data; name="model"\r\n\r\n')
    body.extend(b"whisper-large-v3-turbo\r\n")
    
    # file field
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode("utf-8"))
    body.extend(b"Content-Type: audio/webm\r\n\r\n")
    body.extend(audio_bytes)
    body.extend(b"\r\n")
    
    body.extend(f"--{boundary}--\r\n".encode("utf-8"))
    
    req = urllib.request.Request(
        url,
        data=bytes(body),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "Omni-RAG/2.0"
        },
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("text", "").strip()
    except urllib.error.HTTPError as exc:
        err_msg = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Groq Whisper transcription failed ({exc.code}): {err_msg}")
