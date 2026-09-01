# Omni — Enterprise Agentic Multi-Document RAG Workstation

<p align="center">
  <strong>A production-grade, multi-document research workstation with hierarchical parent-child vector chunking, two-stage hybrid retrieval (Dense + BM25 RRF + Cross-Encoder Reranking), verified sidecar PDF reader, workspace partitions, and a luxury dynamic UI.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/FastAPI-0.115+-009688.svg?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/React-19.0+-61DAFB.svg?style=flat-square&logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/Vite-6.0+-646CFF.svg?style=flat-square&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Qdrant-Vector%20DB-DC2626.svg?style=flat-square&logo=qdrant&logoColor=white" alt="Qdrant" />
  <img src="https://img.shields.io/badge/Groq-LPU%20Inference-F55036.svg?style=flat-square" alt="Groq" />
  <img src="https://img.shields.io/badge/PyMuPDF-PDF%20Extraction-3776AB.svg?style=flat-square&logo=python&logoColor=white" alt="PyMuPDF" />
  <img src="https://img.shields.io/badge/TailwindCSS-v4-38B2AC.svg?style=flat-square&logo=tailwind-css&logoColor=white" alt="TailwindCSS" />
</p>

---

## 🏛️ System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             INGESTION & CHUNKING                                 │
│  Multi-Doc Uploads (PDF / TXT / MD) → PyMuPDF Parser → LLM Summary Extraction    │
│  → Hierarchical Parent Blocks (1500c) → Precise Child Chunks (300c + Summary)    │
│  → Dense Embeddings (sentence-transformers/all-MiniLM-L6-v2 · 384d Cosine)       │
│  → Qdrant Vector Storage + In-Memory BM25 Sparse Inverted Index                  │
└──────────────────────────────────────────────────────────────────────────────────┘
                                          ↓
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         TWO-STAGE HYBRID RETRIEVAL                               │
│  User Query + Chat History → Conversational Reformulation + Sub-Query Split      │
│  → Stage 1A: Dense Vector Similarity Search (Qdrant Cosine, k=12)                │
│  → Stage 1B: Sparse BM25 Lexical Tokenization (rank_bm25, k=12)                  │
│  → Reciprocal Rank Fusion (Weighted RRF: 0.6 Dense + 0.4 BM25)                   │
│  → Stage 2: Deep Cross-Encoder Reranking (ms-marco-MiniLM-L-6-v2)                │
│  → Top-K Deduplicated Parent Context Assembly                                    │
└──────────────────────────────────────────────────────────────────────────────────┘
                                          ↓
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         GENERATION & WORKSTATION SERVING                         │
│  Strict Grounding Prompt + Verified Inline Citations [1][2]                      │
│  → Groq LPU Inference (gpt-oss-20b/120b · Qwen 2.5 · LLaMA 3.3 70B cascade)     │
│  → FastAPI Server-Sent Events (SSE) Token Streaming                              │
│  → React 19 Frontend with Sidecar PDF Reader, Knowledge Vault & Projects Hub     │
│  → SQLite Multi-Session Chat & Workspace Persistence                             │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Core Features

### 1. 🧠 Hierarchical Multi-Document RAG Engine
- **Parent-Child Chunking**: Embeds granular 300-character child segments for high retrieval precision, then expands to 1500-character parent context blocks before sending to the LLM.
- **Two-Stage Hybrid RRF Retrieval**: Combines semantic embeddings with BM25 keyword matching via Reciprocal Rank Fusion, followed by deep attention cross-encoder re-ranking (`ms-marco-MiniLM-L-6-v2`).
- **Conversational Query Reformulation**: Resolves pronouns and references across multi-turn chat threads into standalone vector search queries.
- **Multi-Model Failover**: Automatic resilient fallback across high-speed LPUs (`gpt-oss-20b` → `gpt-oss-120b` → `qwen-27b` → `llama-3.3-70b`).

### 2. 🗄️ Linear-Grade Knowledge Vault
- **In-Header Column Sorting**: Interactive sorting arrows directly inside Document, Format, Size, Pages, and Vector Status table headers.
- **Mass Batch Operations**: Select multiple documents or select-all with a floating action bar for batch re-indexing, batch downloads, and batch deletion.
- **Full-Viewport Drag & Drop**: Drag documents anywhere over the browser window to instantly trigger multi-file ingestion.
- **Docked Metrics Ribbon**: Pinned bottom status ribbon displaying live corpus volume, vector count, cosine dimensions, and Qdrant health.

### 3. 📂 Research Projects & Workspace Partitions
- **Isolated Vector Namespaces**: Separate research materials into distinct project workspaces with dedicated vector partitions and isolated chat threads.
- **Workspace KPI Analytics**: Instant tracking of linked documents, research threads, creation dates, and color-tagged project identifiers.

### 4. 📖 Synchronized Sidecar PDF & Document Reader
- **Split-Screen Sidecar View**: Inspect cited source passages, verify highlighted evidence, and browse multi-page PDFs side-by-side with your active conversation.
- **Interactive Document Controls**: Multi-page pagination, smooth zoom scaling (50%–180%), one-click text copying, and grounded evidence verification chips.
- **Full-Screen Mobile Adaptation**: Automatically expands to a focused full-screen reader on mobile viewports.

### 5. 🎨 3D Differential Vortex & 12 Luxury Themes
- **3D Helical Vortex Loader**: Custom Canvas 3D particle loader featuring differential vortex velocity acceleration ($v \propto 1 + 0.7|\cos\phi|^{1.6}$), dual-sheath streamlines, and theme-synchronized chromatic rendering.
- **12 Curated Themes**: Complete design token coverage across Warm Editorial Light Palettes (Warm Cream, Matcha Linen, Tuscan Terracotta, Porcelain Minimal, Rose Quartz, Amber Ochre) and Dark Variants (Obsidian Charcoal, Ember Dark, Nordic Slate, Midnight Cobalt, Matcha Forest, Royal Plum).

---

## 📁 Repository Structure

```
Omni/
├── frontend/                  # React 19 + TypeScript + Vite + Tailwind CSS
│   ├── src/
│   │   ├── components/
│   │   │   ├── chat/          # ChatCanvas, ChatInput, MessageItem, Orb loaders
│   │   │   ├── common/        # OrbitingOrbLoader, FormatBadge, DocumentSquareTile
│   │   │   ├── layout/        # Sidebar, TopHeader, SidecarReader
│   │   │   ├── modals/        # SettingsModal, SearchModal, Toast
│   │   │   ├── projects/      # ProjectsView, workspace cards & creation modal
│   │   │   └── vault/         # KnowledgeVault, VaultDocList, VaultToolbar, VaultBottomRibbon, VaultMassActionsBar, VaultUploadModal
│   │   ├── context/           # ThemeContext, dynamic CSS variable injector
│   │   ├── hooks/             # useChat, useDocuments, useProjects
│   │   ├── services/          # api.ts (FastAPI client, SSE streaming, file ingestion)
│   │   └── types/             # chat, document, project, theme definitions
│   ├── package.json
│   └── vite.config.ts
├── src/                       # FastAPI Backend Engine
│   ├── api.py                 # REST endpoints & SSE streaming routes
│   ├── config.py              # Application settings & environment configuration
│   ├── database.py            # SQLite chat history & session persistence
│   ├── embeddings.py          # HuggingFace dense vector encoder
│   ├── evaluator.py           # Automated RAG benchmarking & evaluation suite
│   ├── generator.py           # Groq LPU inference & streaming generator
│   ├── models.py              # Pydantic data schemas
│   ├── parser.py              # PyMuPDF document extraction & parent-child chunker
│   ├── retriever.py           # Hybrid BM25 + Qdrant vector retrieval & RRF fusion
│   ├── vector_store.py        # Qdrant client & collection management
│   └── web_search.py          # DuckDuckGo fallback live search provider
├── requirements.txt           # Python dependencies
├── Dockerfile.backend         # Multi-stage backend container
├── docker-compose.yml         # Full-stack orchestrator
└── README.md
```

---

## 🚀 Quick Start Guide

### Prerequisites
- **Python 3.11+**
- **Node.js 18+** & **npm**
- **Groq API Key** (Free tier available at [groq.com](https://groq.com))

---

### Option A: Local Development

#### 1. Clone Repository
```bash
git clone https://github.com/Anurag-amrev-7557/Omni.git
cd Omni
```

#### 2. Backend Setup
```bash
# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
cat <<EOF > .env
GROQ_API_KEY=your_groq_api_key_here
QDRANT_HOST=localhost
QDRANT_PORT=6333
COLLECTION_NAME=omni_knowledge_vault
EOF

# Start FastAPI backend
PYTHONPATH=. uvicorn src.api:app --reload --port 8000
```

#### 3. Frontend Setup
```bash
# In a new terminal tab
cd frontend

# Install Node dependencies
npm install

# Start Vite development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

### Option B: Docker Compose

Deploy the entire stack (FastAPI Backend + Qdrant Vector Database + React Frontend) in a single command:

```bash
# Set your API key
export GROQ_API_KEY="your_groq_api_key_here"

# Spin up containers
docker-compose up -d --build
```

- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **FastAPI API Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Qdrant Dashboard**: [http://localhost:6333/dashboard](http://localhost:6333/dashboard)

### Render + Vercel + Qdrant Cloud

On Render, the checked-out application directory is ephemeral. Qdrant retains
embeddings, but it does not retain the original PDF/TXT/MD file required for
downloads, re-indexing, and the PDF sidecar. Attach a Render Persistent Disk
and set this backend environment variable to its mount path:

```text
UPLOADS_DIR=/var/data/uploaded_docs
```

Also configure `QDRANT_URL`, `QDRANT_API_KEY`, `COLLECTION_NAME`, and
`GROQ_API_KEY` on Render. The application now creates the required Qdrant
keyword indexes for `metadata.filename` at startup, so deletion works with
Qdrant Cloud. If a document was uploaded before the disk was attached, its
vectors remain usable and visible, but upload the original once more to restore
download, re-index, and PDF-reader functionality.

### Supabase authentication

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel. Set
`SUPABASE_URL` to the same project URL on Render. The publishable key belongs
only in the frontend; never expose a Supabase secret/service-role key there.
Set `CORS_ORIGINS` on Render to your exact Vercel origin, for example
`https://omni.vercel.app`.

---

## 📡 API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/chat/stream` | Multi-turn RAG chat stream with Server-Sent Events (SSE) |
| `POST` | `/api/upload` | Ingest and hierarchically chunk multi-page PDFs, Markdown, or text files |
| `GET` | `/api/documents` | Retrieve all documents, page counts, sizes, and indexing statuses |
| `GET` | `/api/documents/{filename}/content` | Retrieve parsed raw text content for Sidecar reader |
| `GET` | `/api/documents/{filename}/pdf-info` | Extract PDF page counts and structural metadata |
| `POST` | `/api/documents/{filename}/reindex` | Re-generate vector embeddings for a specific document |
| `DELETE`| `/api/documents/{filename}` | Remove document from filesystem and clear Qdrant vector index |
| `GET` | `/api/stats` | Return total chunk count, file count, and storage metrics |
| `POST` | `/api/collection/reset` | Clear all Qdrant vector collections and reinitialize index |

---

## 🧪 Automated RAG Evaluation

Omni includes an automated evaluation benchmark assessing retrieval precision, answer groundedness, and hallucination metrics:

```bash
python -m src.evaluator
```

Benchmark output is saved to `EVALUATION_REPORT.md` with metrics for:
- **Faithfulness**: Absence of hallucinations against retrieved context
- **Answer Relevance**: Semantic alignment with the user's intent
- **Context Precision**: Signal-to-noise ratio of retrieved parent chunks
- **End-to-End Latency**: Median time to first token & total generation time

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

<p align="center">
  Built with ❤️ for AI-native multi-document research.
</p>
