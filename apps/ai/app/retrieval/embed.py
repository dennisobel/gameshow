"""Vector encoders for the question index.

Two representations, because neither alone is enough (ARCHITECTURE §5):

* **dense** — a hashed character-n-gram projection. It is a *lexical* embedding,
  not a neural one: it places "something you forget leaving the house" near
  "things you forget when leaving home", but it will not place "car" near
  "automobile". It is deterministic, needs no provider, no key and no model
  download, and it is good enough for the job retrieval actually does here,
  which is catching near-duplicate questions.
* **sparse** — term weights, for exact rare-word overlap, which dense vectors
  smooth away.

`DenseEncoder` is the seam. Swapping in a neural encoder means implementing
`encode()` and changing `DIM`; nothing else in the pipeline changes.
"""

from __future__ import annotations

import hashlib
import math
from collections import Counter

from app.graph.text import content_tokens, normalize, singular

DIM = 256


def _bucket(token: str, dim: int) -> int:
    return int.from_bytes(hashlib.blake2b(token.encode("utf-8"), digest_size=4).digest(), "big") % dim


def _signed_bucket(token: str, dim: int) -> tuple[int, float]:
    """Hash into a bucket with a hash-derived sign, so unrelated tokens landing
    in the same bucket tend to cancel rather than accumulate."""
    digest = hashlib.blake2b(token.encode("utf-8"), digest_size=5).digest()
    index = int.from_bytes(digest[:4], "big") % dim
    sign = 1.0 if digest[4] & 1 else -1.0
    return index, sign


class DenseEncoder:
    """Hashed bag of character n-grams and words, L2-normalised."""

    dim = DIM

    def encode(self, text: str) -> list[float]:
        clean = normalize(text)
        vector = [0.0] * self.dim
        if not clean:
            return vector

        # Words carry most of the signal.
        for word in clean.split():
            index, sign = _signed_bucket("w:" + singular(word), self.dim)
            vector[index] += sign * 1.0

        # Character 4-grams make the encoder robust to typos and inflection.
        padded = f"  {clean}  "
        for i in range(len(padded) - 3):
            index, sign = _signed_bucket("c:" + padded[i : i + 4], self.dim)
            vector[index] += sign * 0.35

        norm = math.sqrt(sum(v * v for v in vector))
        if norm == 0:
            return vector
        return [v / norm for v in vector]


class SparseEncoder:
    """Term weights over a hashed vocabulary, for exact lexical overlap."""

    def encode(self, text: str) -> tuple[list[int], list[float]]:
        tokens = content_tokens(text)
        if not tokens:
            return [], []
        counts = Counter(tokens)
        indices: list[int] = []
        values: list[float] = []
        for token, count in counts.items():
            # Sublinear term frequency, and longer terms weighted up: a rare
            # multi-syllable word says more about a question than a short one.
            weight = (1.0 + math.log(count)) * (1.0 + min(len(token), 12) / 12.0)
            indices.append(_bucket("t:" + token, 1 << 20))
            values.append(round(weight, 4))
        return indices, values


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b, strict=False))
