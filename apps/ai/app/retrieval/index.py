"""The question index: hybrid search over the bank, for dedup and examples.

Dense and sparse candidates are fetched separately and fused with Reciprocal
Rank Fusion (ch. 6), which is the standard way to combine rankings from
retrievers whose scores are not comparable.

Everything here degrades rather than fails. If Qdrant is unreachable the
pipeline falls back to lexical dedup against the prompts it already has; a
vector store being down must not stop the show from getting new questions
(ARCHITECTURE §9).
"""

from __future__ import annotations

import logging
import uuid

from app.retrieval.embed import DenseEncoder, SparseEncoder, cosine

log = logging.getLogger(__name__)

RRF_K = 60  # the conventional constant; damps the influence of deep ranks

# Above this fused-rank-free cosine, two questions are the same question.
DUPLICATE_COSINE = 0.86


def rrf_fuse(rankings: list[list[str]], k: int = RRF_K) -> list[tuple[str, float]]:
    """Reciprocal Rank Fusion: score = sum over retrievers of 1 / (k + rank)."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda kv: -kv[1])


class QuestionIndex:
    """Qdrant-backed, with named dense and sparse vectors on one collection."""

    def __init__(self, url: str, collection: str = "questions"):
        self._url = url
        self._collection = collection
        self._dense = DenseEncoder()
        self._sparse = SparseEncoder()
        self._client = None
        self._ready = False

    async def _connect(self):
        if self._client is not None:
            return self._client
        from qdrant_client import AsyncQdrantClient

        self._client = AsyncQdrantClient(url=self._url, timeout=10)
        return self._client

    async def ensure(self) -> None:
        """Create the collection if it is missing. Safe to call repeatedly."""
        from qdrant_client import models

        client = await self._connect()
        existing = await client.get_collections()
        if any(c.name == self._collection for c in existing.collections):
            self._ready = True
            return

        await client.create_collection(
            collection_name=self._collection,
            vectors_config={
                "dense": models.VectorParams(size=self._dense.dim, distance=models.Distance.COSINE)
            },
            sparse_vectors_config={"lex": models.SparseVectorParams()},
        )
        # Payload index so category-filtered search stays fast as the bank grows.
        await client.create_payload_index(
            collection_name=self._collection,
            field_name="category",
            field_schema=models.PayloadSchemaType.KEYWORD,
        )
        self._ready = True
        log.info("created qdrant collection %s", self._collection)

    async def add(self, *, question_id: str, prompt: str, category: str, status: str = "approved") -> None:
        from qdrant_client import models

        client = await self._connect()
        if not self._ready:
            await self.ensure()
        indices, values = self._sparse.encode(prompt)
        await client.upsert(
            collection_name=self._collection,
            points=[
                models.PointStruct(
                    # Deterministic id, so re-indexing the same question updates
                    # rather than duplicating it.
                    id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"question:{question_id}")),
                    vector={
                        "dense": self._dense.encode(prompt),
                        "lex": models.SparseVector(indices=indices, values=values),
                    },
                    payload={
                        "question_id": question_id,
                        "prompt": prompt,
                        "category": category,
                        "status": status,
                    },
                )
            ],
        )

    async def search(self, prompt: str, *, category: str = "", limit: int = 10) -> list[dict]:
        """Hybrid search: dense and sparse candidates, fused with RRF."""
        from qdrant_client import models

        client = await self._connect()
        if not self._ready:
            await self.ensure()

        flt = None
        if category:
            flt = models.Filter(
                must=[models.FieldCondition(key="category", match=models.MatchValue(value=category))]
            )

        fetch = max(limit * 2, 20)
        dense_hits = await client.query_points(
            collection_name=self._collection,
            query=self._dense.encode(prompt),
            using="dense",
            limit=fetch,
            query_filter=flt,
            with_payload=True,
        )

        indices, values = self._sparse.encode(prompt)
        sparse_hits = None
        if indices:
            sparse_hits = await client.query_points(
                collection_name=self._collection,
                query=models.SparseVector(indices=indices, values=values),
                using="lex",
                limit=fetch,
                query_filter=flt,
                with_payload=True,
            )

        by_id: dict[str, dict] = {}
        rankings: list[list[str]] = []
        for hits in (dense_hits, sparse_hits):
            if hits is None:
                continue
            ranking: list[str] = []
            for point in hits.points:
                key = str(point.id)
                ranking.append(key)
                if key not in by_id:
                    payload = point.payload or {}
                    by_id[key] = {
                        "question_id": payload.get("question_id", ""),
                        "prompt": payload.get("prompt", ""),
                        "category": payload.get("category", ""),
                        "score": point.score,
                    }
            rankings.append(ranking)

        fused = rrf_fuse(rankings)
        out: list[dict] = []
        for key, score in fused[:limit]:
            item = dict(by_id[key])
            item["rrf"] = round(score, 6)
            out.append(item)
        return out

    async def find_duplicate(self, prompt: str, *, category: str = "") -> str | None:
        """Return the prompt of an existing question that is effectively this
        one, or None.

        RRF orders candidates; the accept/reject decision is made on raw cosine,
        because a rank says nothing about *how* similar the top hit is.
        """
        hits = await self.search(prompt, category=category, limit=5)
        if not hits:
            return None
        query_vector = self._dense.encode(prompt)
        for hit in hits:
            other = hit.get("prompt") or ""
            if not other:
                continue
            if cosine(query_vector, self._dense.encode(other)) >= DUPLICATE_COSINE:
                return other
        return None

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None
