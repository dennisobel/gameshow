"""Text normalisation and similarity, shared by clustering and dedup.

Deliberately dependency-free and deterministic: these functions decide whether
two questions are the same and whether two answers mean the same thing, and both
decisions need to be reproducible and testable without a model.
"""

from __future__ import annotations

import re
import unicodedata

_PUNCT = re.compile(r"[^\w\s]", flags=re.UNICODE)
_SPACE = re.compile(r"\s+")

# Dropped from the front of an answer: they carry no meaning for matching.
_LEADING = {"a", "an", "the", "my", "your", "their", "his", "her", "our", "some"}

# Dropped everywhere when comparing questions.
_STOPWORDS = {
    "a", "an", "the", "of", "to", "in", "on", "at", "for", "and", "or", "but",
    "is", "are", "was", "were", "be", "been", "do", "does", "did", "that",
    "this", "it", "its", "you", "your", "they", "their", "name", "something",
    "someone", "people", "would", "might", "could", "when", "what", "who",
}


def normalize(text: str) -> str:
    """Lowercase, strip accents and punctuation, collapse spaces, drop leading
    filler words."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    # Apostrophes are removed rather than split on, so "won't" and "wont" agree.
    # The Go matcher does the same; the two must not disagree.
    text = text.lower().replace("'", "").replace("’", "")
    text = _PUNCT.sub(" ", text)
    text = _SPACE.sub(" ", text).strip()
    return " ".join(strip_leading_filler(text).split())


def strip_leading_filler(text: str) -> str:
    """Drop leading filler words, keeping the rest exactly as written.

    Used for board labels: a survey answer typed as "my mobile" should appear on
    the board as "Mobile".
    """
    words = text.split()
    while len(words) > 1 and words[0].lower() in _LEADING:
        words = words[1:]
    return " ".join(words)


def singular(word: str) -> str:
    """Fold common English plurals. Mirrors the Go matcher so the two agree."""
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith(("ses", "xes", "zes", "ches", "shes")):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def canonical(text: str) -> str:
    """Normalised and singularised: the key two phrasings must share to be the
    same answer without any further judgement.

    Deliberately stops at plurals. Answer matching has to stay conservative —
    over-folding here would merge two distinct board slots.
    """
    return " ".join(singular(w) for w in normalize(text).split())


def stem(word: str) -> str:
    """Fold inflections, for *question* comparison only.

    More aggressive than `canonical` because the job is different: deciding that
    "...when they leave the house" and "...when leaving the house" are the same
    question. A false merge here costs one rejected draft; a missed one puts a
    near-duplicate in the bank.
    """
    word = singular(word)
    if len(word) > 5 and word.endswith("ing"):
        word = word[:-3]
    elif len(word) > 4 and word.endswith("ed"):
        word = word[:-2]
    if len(word) > 3 and word.endswith("e"):
        word = word[:-1]
    return word


def content_tokens(text: str) -> set[str]:
    """Meaning-bearing tokens of a question, for overlap-based dedup."""
    return {stem(w) for w in normalize(text).split() if w not in _STOPWORDS and len(w) > 2}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def edit_distance(a: str, b: str, limit: int = 3) -> int:
    """Levenshtein with an early exit once the limit is exceeded."""
    if a == b:
        return 0
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        cur = [i]
        best = i
        for j, cb in enumerate(b, start=1):
            cur.append(min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (ca != cb)))
            best = min(best, cur[j])
        if best > limit:
            return limit + 1
        prev = cur
    return prev[-1]


def near_duplicate(a: str, b: str) -> bool:
    """Whether two short answers are the same phrase in different clothes.

    Catches plurals, filler words and typos. It does not catch synonyms — "cell"
    and "phone" are not lexically similar — which is why clustering has a second,
    model-driven pass.
    """
    ca, cb = canonical(a), canonical(b)
    if ca == cb:
        return True
    if not ca or not cb:
        return False
    # One phrase wholly inside the other: "car keys" vs "keys".
    ta, tb = set(ca.split()), set(cb.split())
    if ta <= tb or tb <= ta:
        return True
    longest = max(len(ca), len(cb))
    tolerance = 2 if longest >= 9 else 1 if longest >= 5 else 0
    return tolerance > 0 and edit_distance(ca, cb, tolerance) <= tolerance
