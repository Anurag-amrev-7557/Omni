"""Server-Sent Events (SSE) streaming chat endpoint with multi-turn grounding."""
import json
from pydantic import BaseModel, Field
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from src.core.logging import logger
from src.core.auth import require_user, set_current_user
from src.core.rate_limit import limiter
from src.storage.chat_db import save_message_async, get_session_messages
from src.generation.service import prepare_context_and_prompt, answer_query_stream

router = APIRouter(tags=["Chat Stream"])


class ChatStreamRequest(BaseModel):
    session_id: str
    prompt: str
    model: Optional[str] = None
    custom_instructions: Optional[str] = None
    web_search: bool = False


@router.post("/api/chat/stream")
def stream_chat(data: ChatStreamRequest, user_id: str = Depends(require_user)):
    """Streams token-by-token RAG answer generation with live citations and status events."""
    set_current_user(user_id)

    # Enforce per-user rate limits
    limiter.check_or_raise(user_id, action="chat")
    if data.web_search:
        limiter.check_or_raise(user_id, action="search")

    session_id = data.session_id
    prompt = data.prompt
    model = data.model
    custom_instructions = data.custom_instructions
    web_search = bool(data.web_search)

    logger.info(f"Received chat stream request for session={session_id}")

    def sse_event_generator():
        try:
            status_msg = "Searching vault & live web via Tavily..." if web_search else "Searching knowledge vault..."
            yield f"data: {json.dumps({'type': 'status', 'message': status_msg})}\n\n"

            # 1. Fetch past messages and record new user question
            try:
                save_message_async(session_id, "user", prompt, user_id=user_id)
                messages = get_session_messages(session_id)
            except Exception as hist_err:
                logger.warning(f"Chat history notice: {hist_err}")
                messages = []

            # 2. Retrieve user-scoped contexts and assemble prompt
            try:
                prompt_str, retrieved_contexts = prepare_context_and_prompt(
                    query=prompt,
                    chat_history=messages,
                    user_id=user_id,
                    custom_instructions=custom_instructions,
                    web_search=web_search,
                )
            except Exception as prep_err:
                logger.warning(f"Context preparation notice: {prep_err}")
                prompt_str = prompt
                retrieved_contexts = []

            # 3. Stream retrieved contexts metadata
            yield f"data: {json.dumps({'type': 'contexts', 'contexts': retrieved_contexts})}\n\n"

            # 4. Stream response tokens
            full_text = ""
            stream_gen = answer_query_stream(
                query=prompt,
                chat_history=messages,
                model=model,
                prepared_prompt=prompt_str,
                user_id=user_id,
            )
            for token in stream_gen:
                full_text += token
                yield f"data: {json.dumps({'type': 'token', 'token': token})}\n\n"

            # 5. Record assistant response in database
            try:
                save_message_async(session_id, "assistant", full_text, retrieved_contexts, user_id=user_id)
            except Exception as save_err:
                logger.warning(f"Failed to save assistant message: {save_err}")

            yield f"data: {json.dumps({'type': 'done', 'full_text': full_text})}\n\n"
        except Exception as e:
            logger.error(f"Stream generation error: {e}", exc_info=True)
            err_msg = f"\n\n⚠️ *Backend Stream Error: {str(e)}*"
            yield f"data: {json.dumps({'type': 'token', 'token': err_msg})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'full_text': err_msg})}\n\n"

    return StreamingResponse(
        sse_event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
