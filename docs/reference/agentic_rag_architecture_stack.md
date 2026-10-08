# System Architecture & Tech Stack Specification
## Production-Grade Agentic RAG System

---

## 1. Executive Summary & Architectural Philosophy

This architecture specifies a high-performance, enterprise-grade **Agentic Retrieval-Augmented Generation (RAG)** system. The design decouples **State Management & Agent Control Flow** from **Data Retrieval & Knowledge Ingestion**, resolving common failure modes where RAG engines become bloated or agent loops lose deterministic control.

### Core Architectural Principles
1. **Decoupled Control & Retrieval**: **LangGraph** manages the cyclic decision graph, state machine, and long-running execution; **LlamaIndex** acts purely as a specialized data indexing, query, and retrieval engine exposed to the agent as callable tools.
2. **Hybrid Search Supremacy**: Vector-only semantic search fails on domain-specific identifiers, tabular data, and exact-match keywords. The system enforces **Dense + Sparse (BM25) Hybrid Search** backed by cross-encoder reranking.
3. **Generative UI First**: The user interface isn't just text streaming—it dynamically renders active tool states, retrieval widgets, and rich metadata using the **Vercel AI SDK Data Stream Protocol**.
4. **Unified Storage Topology**: **MongoDB** serves as the primary application database, user profile repository, and thread-state checkpointer. **Qdrant** runs isolated in Docker as a dedicated hybrid vector search engine.
5. **Total Observability**: Every node transition, tool call payload, vector query, and user rating is captured in **LangSmith** for distributed tracing and continuous feedback evaluation.

---

## 2. Technology Stack Overview

| Domain | Technology / Tool | Role in Architecture |
| :--- | :--- | :--- |
| **Agent Orchestration** | **LangGraph** | Cyclic state graphs, multi-agent delegation, human-in-the-loop branching, execution loops. |
| **Frontend & Generative UI** | **Vercel AI SDK (Next.js)** | UI components, real-time Server-Sent Events (SSE) streaming, Generative UI tool widgets. |
| **RAG & Indexing Layer** | **LlamaIndex** | Document parsing orchestrator, node chunking, query engine abstractions, tool wrapper. |
| **Document Parsing** | **LlamaParse** | Layout-aware parsing for complex PDFs, structural tables, and multi-column documents into clean Markdown. |
| **Reranking Engine** | **Cohere Rerank v3** | Cross-encoder post-processing, filtering top candidate chunks to eliminate context noise. |
| **Vector Database** | **Qdrant (Docker)** | Self-hosted, gRPC-enabled hybrid vector engine (Dense + Sparse BM25) with payload filtering. |
| **Primary & State DB** | **MongoDB** | Application data, long-term user memory profiles, and thread checkpoint state (`MongoDBSaver`). |
| **Embeddings Engine** | **Hybrid (Dense + FastEmbed)** | Dense semantic vectors (`text-embedding-3-large` or `BGE-M3`) + Sparse lexical vectors (`FastEmbed BM25`). |
| **Observability & Tracing** | **LangSmith** | Distributed tracing, prompt latency tracking, agent execution graph inspection, end-user feedback loops. |

---

## 3. High-Level System Architecture Diagram

```
                                  +-------------------------------------------------------+
                                  |                 Observability Layer                   |
                                  |              LangSmith Distributed Trace              |
                                  +-------------------------------------------------------+
                                                              ^
                                                              | Traces, Metrics, Feedback
                                                              |
+------------------------+      HTTP / SSE       +----------------------------------------+
|   Next.js Frontend     | <-------------------> |            FastAPI Backend             |
|   (Vercel AI SDK)      |                       |       (LangGraph Agent Engine)         |
|                        |                       |                                        |
| - Generative UI Blocks |                       | - State Machine & Cyclic Loops         |
| - Streaming Text       |                       | - Node Transition & Routing            |
| - User Feedback (1/0)  |                       | - Tool Execution Manager               |
+------------------------+                       +-------------------+--------------------+
                                                                     |
                                           +-------------------------+-------------------------+
                                           |                                                   |
                                           v                                                   v
                        +------------------------------------+               +----------------------------------+
                        |        MongoDB Database            |               |      LlamaIndex RAG Engine       |
                        |                                    |               |         (Tool Wrapper)           |
                        | - App Data & Auth                  |               +-----------------+----------------+
                        | - Thread Checkpoints (MongoDBSaver)|                                 |
                        | - Long-Term User Memories          |                                 v
                        +------------------------------------+               +----------------------------------+
                                                                             |        Qdrant Vector DB         |
                                                                             |         (Docker Container)       |
                                                                             |                                  |
                                                                             | - Dense Embeddings (Semantic)    |
                                                                             | - Sparse Vectors (FastEmbed BM25)|
                                                                             | - Cohere Rerank v3 Postprocessor |
                                                                             +----------------------------------+
```

---

## 4. Subsystem Deep-Dives

### 4.1 Ingestion & Parsing Pipeline
Standard chunking mechanisms (e.g., recursive character splitters) destroy document layout structure, splitting tables, headers, and bullet points into disconnected chunks.

* **Parsing**: **LlamaParse** parses PDFs into structured, layout-preserved Markdown. Complex financial or technical tables are extracted as intact Markdown structures rather than fragmented strings.
* **Element-Aware Node Extraction**: LlamaIndex's `MarkdownElementNodeParser` isolates tables, headings, and text blocks into distinct node objects while preserving parent-child context linkages.
* **Dual Indexing**:
  * **Dense Representations**: High-dimensional semantic vectors capturing overall context and intent.
  * **Sparse Representations**: Inverted index term frequency (BM25) capturing exact keywords, names, part numbers, and code identifiers.

---

### 4.2 Retrieval & Reranking Architecture

To achieve sub-second retrieval with high signal-to-noise ratio, retrieval follows a two-stage pipeline:

```
[ Query ] ---> [ Stage 1: Broad Retrieval (Candidate Retrieval) ]
                   - Qdrant Hybrid Search (Dense + Sparse)
                   - Fetches Top 20 Candidates
                                 |
                                 v
               [ Stage 2: Context Compression & Reranking ]
                   - Cohere Rerank v3 (Cross-Encoder)
                   - Reranks Top 20 -> Filters down to Top 4
                                 |
                                 v
               [ Agent Context Window (Clean Data) ]
```

1. **Stage 1 (Candidate Retrieval)**: Qdrant executes parallel dense vector matching and sparse lexical search over the collection, merging candidate lists via **Reciprocal Rank Fusion (RRF)** to return the top 20 candidate chunks.
2. **Stage 2 (Cross-Encoder Reranking)**: The top 20 candidate chunks pass through **Cohere Rerank v3**. Cohere evaluates full attention across the query and document pairs, scoring relevance and discarding false positives. Only the top 4 highly relevant nodes enter the LLM's context window.

---

### 4.3 Long-Term & Short-Term Memory Architecture

Memory is separated into two distinct operational domains:

```
                                  +---------------------------------------+
                                  |            Memory Subsystem           |
                                  +-------------------+-------------------+
                                                      |
                         +----------------------------+----------------------------+
                         |                                                         |
                         v                                                         v
          +-----------------------------+                           +-----------------------------+
          |      Thread Memory          |                           |    Semantic Memory          |
          |  (Short-Term Session State) |                           |  (Long-Term User Profile)   |
          +-----------------------------+                           +-----------------------------+
          | - Active conversation graph  |                           | - Cross-session facts       |
          | - Intermediate tool state   |                           | - Explicit user preferences |
          | - Backed by MongoDB         |                           | - Domain context & history  |
          |   `MongoDBSaver`            |                           | - Backed by MongoDB/Qdrant  |
          +-----------------------------+                           +-----------------------------+
```

1. **Thread Memory (Session Level)**:
   * **Purpose**: Persists chat history, intermediate tool call executions, and graph state across multiple user interaction turns within a single thread.
   * **Storage**: **MongoDB Checkpointer** (`MongoDBSaver`). Allows the agent graph to pause, resume, or perform time-travel debugging without losing thread state.

2. **Semantic Memory (User / Cross-Session Level)**:
   * **Purpose**: Remembers background facts, explicit user preferences, and business rules across completely separate threads.
   * **Mechanism**: Dedicated background node in LangGraph monitors user messages for profile-worthy facts, extracting and storing them in MongoDB under a `user_memories` collection.

---

### 4.4 Agentic Execution & Generative UI Protocol

* **State Orchestrator**: LangGraph executes a bounded loop:
  1. Receive user message and hydrate state from MongoDB.
  2. Invoke Agent LLM bound to available tools (RAG search, memory updates).
  3. Conditional branching:
     * If tool call generated -> Execute Tool Node (e.g., LlamaIndex RAG Tool) -> Return output to Agent -> Re-evaluate.
     * If final answer generated -> Return stream to user.
* **Generative UI Integration**:
  * The backend FastAPI server formats graph events into the **Vercel AI SDK Data Stream Protocol**.
  * Tool calls generate structured Server-Sent Events (SSE).
  * The Next.js frontend intercepts tool events in real time, rendering specialized UI widgets (e.g., dynamic search indicators, expandable document citation blocks, table previews) rather than raw text.

---

### 4.5 Observability & Quality Control (LangSmith)

* **Distributed Tracing**: Every agent node transition, tool call payload, prompt template substitution, and vector store retrieval query is traced end-to-end.
* **Latency & Cost Profiling**: Tracks per-tool latency (e.g., measuring LlamaParse vs Qdrant lookup vs Cohere rerank overhead) and exact token expenditures.
* **Feedback Loop Integration**: The frontend includes a rating widget (thumbs up/down) bound to the unique LangSmith `run_id`. User scores are posted directly to LangSmith evaluation datasets to highlight poor retrieval or hallucinated responses.

---

## 5. Deployment & Containerization Topology

* **Application Layer**: Next.js (Vercel / Docker Container) communicating via REST/SSE with FastAPI (App Server Container).
* **Database Layer**:
  * **MongoDB Cluster**: Primary database running natively or via MongoDB Atlas.
  * **Qdrant Vector DB Container**: Self-hosted Docker container exposing REST (port `6333`) and gRPC (port `6334`) endpoints with persistent storage volume mounts.
* **Network Connectivity**: FastAPI server interacts with Qdrant over high-speed gRPC for low-latency vector fetching and payload filtering.

---

## 6. Key Architectural Advantages

1. **High Retrieval Precision**: Eliminates standard vector search blind spots by pairing LlamaParse table extraction with Hybrid Search and Cohere Reranking.
2. **Determinism & Safety**: LangGraph enforces structured state transitions, preventing agents from hallucinating endless execution loops.
3. **No Operational Bloat**: Uses existing MongoDB infrastructure for state checkpointing and application data while isolating high-throughput vector math inside a single, lightweight Qdrant Docker container.
4. **Rich User Experience**: Generative UI bridges the gap between text chat and rich graphical interfaces, rendering native React components during long RAG retrieval pipelines.
