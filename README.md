# Omni — Enterprise Agentic Multi-Document RAG Workstation

<p align="center">
  <strong>A robust, minimalist, production-ready multi-document research workstation featuring hierarchical parent-child vector chunking, two-stage hybrid retrieval (Dense + BM25 RRF + Cross-Encoder Reranking), verified sidecar PDF reader, and a luxury dynamic UI.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/FastAPI-0.115+-009688.svg?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/React-19.0+-61DAFB.svg?style=flat-square&logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/Vite-6.0+-646CFF.svg?style=flat-square&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Qdrant-Vector%20Storage-DC2626.svg?style=flat-square&logo=qdrant&logoColor=white" alt="Qdrant" />
  <img src="https://img.shields.io/badge/Groq-LPU%20Inference-F55036.svg?style=flat-square" alt="Groq" />
  <img src="https://img.shields.io/badge/PyMuPDF-PDF%20Extraction-3776AB.svg?style=flat-square&logo=python&logoColor=white" alt="PyMuPDF" />
  <img src="https://img.shields.io/badge/Cross--Encoder-ms--marco-792EE5.svg?style=flat-square" alt="Cross-Encoder" />
  <img src="https://img.shields.io/badge/TailwindCSS-v3.4-38B2AC.svg?style=flat-square&logo=tailwind-css&logoColor=white" alt="TailwindCSS" />
</p>

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph INGESTION["1. Ingestion & Hierarchical Chunking"]
        DOCS[Multi-Document Uploads: PDF / TXT / MD] --> PARSE[PyMuPDF High-Fidelity Extraction]
        PARSE --> SUMM[LLM Document Summary Generation]
        SUMM --> PARENT[Parent Chunker: 1500 chars]
        PARENT --> CHILD[Child Chunker: 300 chars + Summary Context]
        CHILD --> EMBED[all-MiniLM-L6-v2 Embeddings 384d]
        EMBED --> QDRANT[(Qdrant Vector Storage: data/qdrant_db)]
    end

    subgraph RETRIEVAL["2. Two-Stage Hybrid Retrieval & Reranking"]
        QUERY[User Query + Conversational History] --> REFORM[Conversational Memory Router / Decomposer]
        REFORM --> DENSE[Stage 1A: Qdrant Dense Similarity Search k=12]
        REFORM --> SPARSE[Stage 1B: In-Memory BM25 Lexical Scoring k=12]
        DENSE & SPARSE --> RRF[Reciprocal Rank Fusion RRF: 0.6 Dense + 0.4 BM25]
        RRF --> CROSS[Stage 2: Cross-Encoder Deep Attention Reranking ms-marco-MiniLM]
        CROSS --> CONTEXT[Top-K Deduplicated Parent Context Blocks]
    end

    subgraph GENERATION["3. Inference & Workstation Serving"]
        CONTEXT --> PROMPT[Grounding Prompt + Citation Constraints]
        PROMPT --> GROQ[Groq LPU High-Speed Inference with Model Failover]
        GROQ --> SSE[FastAPI Server-Sent Events SSE Stream]
        SSE --> UI[React 19 Frontend Dashboard + Sidecar PDF Viewer]
        UI --> SQLITE[(SQLite Session & Message Store: data/chat_history.db)]
    end
```

---

## ✨ Core Features

### 1. 🧠 Hierarchical Multi-Document RAG Engine
- **Parent-Child Chunking**: Embeds fine-grained 300-character child snippets for precision vector retrieval, then expands to complete 1500-character parent context blocks before sending to the LLM.
- **Two-Stage Hybrid RRF Retrieval**: Combines dense semantic cosine similarity with BM25 lexical token matching via Reciprocal Rank Fusion ($RRF = 0.6 \cdot Dense + 0.4 \cdot BM25$), followed by cross-attention deep reranking (`cross-encoder/ms-marco-MiniLM-L-6-v2`).
- **Conversational Memory Router**: Automatically rephrases ambiguous multi-turn follow-up questions into standalone queries and decomposes complex multi-topic inquiries into parallel sub-searches.
- **Resilient Groq Failover**: Automatic fallback across high-throughput models on Groq LPUs (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`, `qwen/qwen3.6-27b`, `groq/compound`).

### 2. 🗄️ Knowledge Vault & Document Management
- **Multi-Format Ingestion**: Ingests PDFs, Markdown, and plain text files with PyMuPDF page-level text extraction.
- **Real-Time Storage Diagnostics**: Instant tracking of corpus volume, total vector count, indexed documents, and active chat sessions.
- **Live Re-indexing & Deletion**: Re-index individual documents on demand or remove documents with automatic vector deletion from Qdrant.

### 3. 📖 Visual PDF Reader Sidecar
- **Split-Screen Verification**: Inspect cited source passages side-by-side with your active conversation.
- **High-Resolution Page Rendering**: PyMuPDF renders individual PDF pages as crisp images with page navigation and raw extracted text inspection.
- **Inline Numerical Citations**: Grounded responses feature bracketed citations `[1]`, `[2]` with exact page references and source quote snippets.

### 4. 🎨 Enterprise Dynamic UI & Theme Engine
- **12 Curated Themes**: Complete design token coverage across warm editorial palettes (Warm Cream, Matcha Linen, Tuscan Terracotta, Porcelain Minimal) and dark variants (Obsidian Charcoal, Midnight Cobalt, Matcha Forest).
- **Responsive Layout**: Fluid sidebar navigation, search modals, collapsible source inspectors, and interactive citation chips.

---

## 📁 Repository Structure

```
Omni/
├── data/                      # Local SQLite databases & vector storage
├── frontend/                  # React 19 + TypeScript + Vite + Tailwind CSS
│   ├── src/
│   │   ├── components/        # Chat, Vault, Graph, Reader, Layout & Modal components
│   │   ├── context/           # ThemeContext & dynamic token injection
│   │   ├── hooks/             # useDocuments, useSpeech custom hooks
│   │   ├── services/          # api.ts (Centralized API client & streaming utilities)
│   │   └── types/             # TypeScript schemas & interfaces
│   ├── package.json
│   └── vite.config.ts
├── src/                       # Modular FastAPI Backend Engine
│   ├── api/                   # REST routing, lifespan events, and dependencies
│   ├── config/                # Centralized settings and environment loader
│   ├── core/                  # Auth, rate limiting, and security filters
│   ├── generation/            # Groq LPU inference, prompts, and streaming service
│   ├── github/                # GitHub repository tree sync & batch ingestion
│   ├── graph/                 # SQLite Knowledge Graph extraction & traversal
│   ├── ingestion/             # PyMuPDF extraction, summarization, and chunking
│   ├── retrieval/             # Hybrid search (FastEmbed + BM25) and reranking
│   ├── storage/               # Qdrant vector store, SQLite chat & document DBs
│   ├── web_search/            # Tavily live web retrieval
│   └── main.py                # Unified CLI & server entrypoint
├── tests/                     # Automated pytest regression & contract suite
├── requirements.txt           # Python dependencies
└── README.md
```

---

## 🌐 Live Deployment

- **Backend API**: [https://omni-lufq.onrender.com](https://omni-lufq.onrender.com) (Render Free Tier)
- **Frontend App**: Deployed on Vercel
- **API Docs (Swagger)**: `https://omni-lufq.onrender.com/docs`
- **Health Endpoint**: `https://omni-lufq.onrender.com/api/health`

> [!NOTE]
> Free-tier hosting on Render automatically spins down after 15 minutes of inactivity. Initial requests after a cold start take ~30–50s to wake up the container.

---

## 🚀 Quick Start Guide

### Prerequisites
- **Python 3.11+** (Python 3.12 recommended)
- **Node.js 18+** & **npm**
- **Groq API Key** (Free tier available at [console.groq.com](https://console.groq.com))

### 1. Clone & Setup Environment

```bash
git clone https://github.com/Anurag-amrev-7557/Omni.git
cd Omni

# Create and activate Python virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
```

### 2. Start Backend Service

```bash
python -m src.main
```

### 3. Start Frontend Dashboard

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 📡 API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/chat/stream` | Multi-turn RAG chat stream with Server-Sent Events (SSE) |
| `POST` | `/api/upload` | Ingest and chunk PDFs, Markdown, or text files |
| `GET` | `/api/documents` | Retrieve all documents, metadata, and indexing statuses |
| `DELETE`| `/api/documents/{filename}` | Remove document and purge vector points |
| `GET` | `/api/download/{filename}` | Download original document file |
| `POST` | `/api/documents/{filename}/reindex` | Re-index and re-embed a specific document |
| `GET` | `/api/sessions` | List active chat sessions |
| `POST` | `/api/sessions` | Create a new chat session |
| `GET` | `/api/sessions/{session_id}/messages` | Retrieve conversation history |
| `DELETE`| `/api/sessions/{session_id}` | Delete a chat session and its history |
| `GET` | `/api/stats` | Return total chunks, file count, and session count |
| `GET` | `/api/health` | Diagnostic pipeline health checks (Qdrant, LLM, Embeddings) |
| `POST` | `/api/reset` | Clear all vector collections and chat sessions |

---

## 📄 License

Distributed under the **MIT License**.
