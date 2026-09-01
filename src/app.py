import sys
import streamlit as st
import os
import tempfile
from datetime import datetime

os.environ["TRANSFORMERS_VERBOSITY"] = "error"

# --- PATH RESOLUTION ---
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

try:
    from src.db import init_db, clear_collection, get_collection_stats
    from src.ingest import ingest_file
    from src.generate import answer_query_stream, prepare_context_and_prompt
    from src.chat_db import init_chat_db, create_session, get_all_sessions, add_message, get_session_messages, delete_session
    from src.pdf_viewer import render_pdf_page_image, get_pdf_page_count, extract_pdf_page_text
except ImportError:
    from db import init_db, clear_collection, get_collection_stats
    from ingest import ingest_file
    from generate import answer_query_stream, prepare_context_and_prompt
    from chat_db import init_chat_db, create_session, get_all_sessions, add_message, get_session_messages, delete_session
    from pdf_viewer import render_pdf_page_image, get_pdf_page_count, extract_pdf_page_text


# ==========================================
# 1. PAGE CONFIGURATION & STYLING
# ==========================================
st.set_page_config(page_title="Enterprise Multi-Doc RAG", page_icon="📚", layout="centered")

st.markdown("""
<style>
    .stChatMessage p, .stChatMessage li {
        font-size: 0.96rem;
        line-height: 1.6;
    }
    .stChatMessage ul, .stChatMessage ol {
        margin-top: 0.3rem;
        margin-bottom: 0.5rem;
        padding-left: 1.4rem;
    }
    .stChatMessage h5 {
        font-size: 1.05rem;
        margin-top: 1rem;
        margin-bottom: 0.5rem;
        font-weight: 600;
        color: #7c3aed;
    }
    hr {
        margin: 1.2rem 0;
        border-color: rgba(255, 255, 255, 0.1);
    }
    .stat-box {
        background-color: rgba(124, 58, 237, 0.08);
        border: 1px solid rgba(124, 58, 237, 0.2);
        padding: 0.8rem;
        border-radius: 8px;
        margin-bottom: 1rem;
    }
</style>
""", unsafe_allow_html=True)

@st.cache_resource
def setup_databases():
    init_db()
    init_chat_db()

setup_databases()

# Ensure active chat session
sessions = get_all_sessions()
if not sessions:
    active_session_id = create_session("New Chat")
    sessions = get_all_sessions()

if "current_session_id" not in st.session_state:
    st.session_state.current_session_id = sessions[0]["session_id"]

st.title("Enterprise Multi-Document RAG 🤖")
st.caption("Powered by Groq LPUs, Cross-Encoder Reranking, PyMuPDF, and Qdrant")

# ==========================================
# 2. SIDEBAR: SESSIONS & DOCUMENT MANAGEMENT
# ==========================================
with st.sidebar:
    st.header("💬 Chat Threads")
    
    if st.button("➕ New Chat Thread", use_container_width=True, type="primary"):
        new_id = create_session("New Chat")
        st.session_state.current_session_id = new_id
        st.rerun()
        
    session_dict = {s["session_id"]: s["title"] for s in sessions}
    session_ids = list(session_dict.keys())
    
    current_index = session_ids.index(st.session_state.current_session_id) if st.session_state.current_session_id in session_ids else 0
    selected_session = st.selectbox(
        "Active Session",
        options=session_ids,
        format_func=lambda x: session_dict.get(x, "Chat"),
        index=current_index
    )
    
    if selected_session != st.session_state.current_session_id:
        st.session_state.current_session_id = selected_session
        st.rerun()

    if len(sessions) > 1:
        if st.button("🗑️ Delete Thread", use_container_width=True):
            delete_session(st.session_state.current_session_id)
            st.session_state.current_session_id = get_all_sessions()[0]["session_id"]
            st.toast("Chat thread deleted!", icon="🗑️")
            st.rerun()

    st.divider()
    st.header("📄 Knowledge Base")
    
    stats = get_collection_stats()
    st.markdown(f"""
    <div class="stat-box">
        <strong>Status:</strong> Active<br>
        <strong>Indexed Documents:</strong> {len(stats['files'])}<br>
        <strong>Total Vector Chunks:</strong> {stats['total_chunks']}
    </div>
    """, unsafe_allow_html=True)

    if stats['files']:
        with st.expander("📁 Ingested Files List"):
            for fname in stats['files']:
                st.markdown(f"• `{fname}`")
    
    uploaded_files = st.file_uploader("Upload Documents", type=["pdf", "txt", "md"], accept_multiple_files=True)
    
    if uploaded_files:
        if st.button("Process Documents", type="primary", use_container_width=True):
            with st.spinner(f"Processing {len(uploaded_files)} documents..."):
                uploads_dir = os.path.join(ROOT_DIR, "data", "uploaded_docs")
                os.makedirs(uploads_dir, exist_ok=True)
                
                count = 0
                for uploaded_file in uploaded_files:
                    save_path = os.path.join(uploads_dir, uploaded_file.name)
                    with open(save_path, "wb") as f:
                        f.write(uploaded_file.getvalue())
                    
                    try:
                        ingest_file(save_path)
                        count += 1
                    except Exception as e:
                        st.error(f"Error on {uploaded_file.name}: {e}")
                
                if count > 0:
                    st.toast(f"Successfully processed {count} document(s)!", icon="🎉")
                    st.rerun()

    st.divider()

    # Chat Export
    db_messages = get_session_messages(st.session_state.current_session_id)
    if db_messages:
        export_text = f"# RAG Chat Session Export\n*Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*\n\n"
        for msg in db_messages:
            export_text += f"### {msg['role'].upper()}\n{msg['content']}\n\n"
            
        st.download_button(
            label="📥 Export Chat Transcript (.md)",
            data=export_text,
            file_name=f"rag_transcript_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md",
            mime="text/markdown",
            use_container_width=True
        )

    if st.button("🗑️ Reset Knowledge Base", use_container_width=True):
        clear_collection()
        delete_session(st.session_state.current_session_id)
        new_id = create_session("New Chat")
        st.session_state.current_session_id = new_id
        st.toast("Knowledge base reset!", icon="🧹")
        st.rerun()

# ==========================================
# 3. MAIN WINDOW: TABS NAVIGATION
# ==========================================
tab_chat, tab_reader = st.tabs(["💬 Assistant Chat", "📖 Knowledge Base & Visual PDF Reader"])

# Fetch messages from SQLite for active session
current_messages = get_session_messages(st.session_state.current_session_id)

def render_assistant_message(content: str, contexts: list[dict] = None):
    st.markdown(content)
    if contexts:
        with st.expander("🔍 Source Inspector & Cross-Encoder Scores"):
            for idx, ctx in enumerate(contexts, start=1):
                rerank_score = ctx.get('rerank_score', 'N/A')
                vector_score = ctx.get('vector_score', 'N/A')
                lex_score = ctx.get('lexical_score', 'N/A')
                st.markdown(f"**[{idx}] {ctx['filename']}** *(Page {ctx.get('page', 1)})* — Rerank: `{rerank_score}` | Vector: `{vector_score}` | Lexical: `{lex_score}`")
                snippet = ctx.get('child_snippet') or ctx['content'][:300]
                st.caption(snippet + ("..." if len(snippet) > 300 else ""))
                if idx < len(contexts):
                    st.divider()

# TAB 1: CHAT INTERFACE
with tab_chat:
    if not current_messages:
        SUGGESTIONS = {
            "💡 Key document insights": "What are the key insights and main takeaways from the uploaded documents?",
            "📄 Executive summary": "Provide an executive summary of all ingested documents.",
            "⚙️ Bitcoin Proof-of-Work": "How does the proof-of-work mechanism work in Bitcoin?"
        }
        selected_suggestion = st.pills("Suggested Questions:", list(SUGGESTIONS.keys()), label_visibility="collapsed")
        if selected_suggestion:
            prompt_text = SUGGESTIONS[selected_suggestion]
            add_message(st.session_state.current_session_id, "user", prompt_text)
            st.rerun()

    for message in current_messages:
        with st.chat_message(message["role"]):
            if message["role"] == "assistant":
                render_assistant_message(message["content"], message.get("contexts"))
            else:
                st.markdown(message["content"])

    prompt_input = st.chat_input("Ask a question about your documents...")

    if prompt_input:
        add_message(st.session_state.current_session_id, "user", prompt_input)
        with st.chat_message("user"):
            st.markdown(prompt_input)

        with st.chat_message("assistant"):
            prompt_str, retrieved_contexts = prepare_context_and_prompt(prompt_input, current_messages)
            stream_gen = answer_query_stream(prompt_input, current_messages)
            full_response = st.write_stream(stream_gen)
            
            if retrieved_contexts:
                with st.expander("🔍 Source Inspector & Cross-Encoder Scores"):
                    for idx, ctx in enumerate(retrieved_contexts, start=1):
                        rerank_score = ctx.get('rerank_score', 'N/A')
                        vector_score = ctx.get('vector_score', 'N/A')
                        lex_score = ctx.get('lexical_score', 'N/A')
                        st.markdown(f"**[{idx}] {ctx['filename']}** *(Page {ctx.get('page', 1)})* — Rerank: `{rerank_score}` | Vector: `{vector_score}` | Lexical: `{lex_score}`")
                        snippet = ctx.get('child_snippet') or ctx['content'][:300]
                        st.caption(snippet + ("..." if len(snippet) > 300 else ""))
                        if idx < len(retrieved_contexts):
                            st.divider()

        add_message(st.session_state.current_session_id, "assistant", full_response, retrieved_contexts)

# TAB 2: KNOWLEDGE BASE READER & VISUAL PDF VIEWER
with tab_reader:
    st.subheader("🖼️ Visual Document & PDF Page Reader")
    
    uploads_dir = os.path.join(ROOT_DIR, "data", "uploaded_docs")
    available_files = [f for f in os.listdir(uploads_dir) if os.path.isfile(os.path.join(uploads_dir, f))] if os.path.exists(uploads_dir) else []
    pdf_files = [f for f in available_files if f.lower().endswith(".pdf")]
    
    if pdf_files:
        col_doc, col_page = st.columns([2, 1])
        with col_doc:
            selected_pdf = st.selectbox("Select PDF Document", options=pdf_files)
        
        pdf_path = os.path.join(uploads_dir, selected_pdf)
        total_pages = get_pdf_page_count(pdf_path)
        
        with col_page:
            selected_page = st.number_input("Page Number", min_value=1, max_value=max(total_pages, 1), value=1)
            
        st.markdown(f"**Viewing `{selected_pdf}`** *(Page {selected_page} of {total_pages})*")
        
        # Render PDF page as PNG image
        img_bytes = render_pdf_page_image(pdf_path, selected_page)
        if img_bytes:
            st.image(img_bytes, caption=f"{selected_pdf} — Page {selected_page}", use_container_width=True)
            
        with st.expander("📝 Page Extracted Raw Text"):
            raw_text = extract_pdf_page_text(pdf_path, selected_page)
            st.text_area("Page Text Content", value=raw_text, height=200)
    else:
        st.info("Upload PDF files using the sidebar to view high-resolution rendered PDF pages here!")

    st.divider()
    st.subheader("📖 Chunk Explorer")
    search_term = st.text_input("🔍 Quick Vector & Lexical Search", placeholder="Type keywords or topic to inspect chunks...")
    
    if search_term:
        from src.retrieve import hybrid_search
        results = hybrid_search(search_term, limit=6)
        if results:
            st.success(f"Found {len(results)} matching chunks sorted by Cross-Encoder relevance:")
            for idx, res in enumerate(results, start=1):
                with st.container():
                    st.markdown(f"##### [{idx}] {res['filename']} — Page {res.get('page', 1)}")
                    st.markdown(f"`Rerank Score: {res.get('rerank_score')}` | `Vector Score: {res.get('vector_score')}` | `Lexical Score: {res.get('lexical_score')}`")
                    st.info(res['content'])
        else:
            st.warning("No matching vector chunks found for your search term.")