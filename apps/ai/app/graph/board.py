"""Building a board from a tallied survey, and deciding whether it is playable.

The quality gates here are the part of the pipeline that no prompt could
replace. They are *measurements* of how the room actually answered, and they
reject two failure modes that read perfectly well on paper:

* **Scatter.** Sixty people give fifty different answers. The question is too
  open; a player cannot reasonably hit the board, and the game feels unfair.
* **A giveaway.** Fifty of the sixty say the same thing. There is no game in it.

Neither is visible in the question text. Both are obvious in the tally.
"""

from __future__ import annotations

from app.models import AnswerCluster, Board


def build_board(clusters: list[AnswerCluster], panel_size: int, board_size: int) -> Board:
    """Take the most popular answers and measure what the board captures."""
    top = clusters[:board_size]
    total = max(1, panel_size)
    coverage = sum(c.count for c in top) / total
    top_share = (top[0].count / total) if top else 0.0
    return Board(
        answers=top,
        panel_size=panel_size,
        coverage=round(coverage, 3),
        top_share=round(top_share, 3),
    )


def check_board(
    board: Board,
    *,
    min_coverage: float,
    max_top_share: float,
    min_clusters: int,
) -> str | None:
    """Return a reason to reject, or None if the board is playable."""
    if len(board.answers) < min_clusters:
        return (
            f"Only {len(board.answers)} distinct answers came back; "
            f"a board needs at least {min_clusters}."
        )
    if board.coverage < min_coverage:
        return (
            f"The board only captures {board.coverage:.0%} of what the panel said "
            f"(minimum {min_coverage:.0%}). The question is too open — answers scatter."
        )
    if board.top_share > max_top_share:
        return (
            f"One answer took {board.top_share:.0%} of the panel "
            f"(maximum {max_top_share:.0%}). The question gives itself away."
        )
    # A board whose tail is all singletons is really a two-answer board.
    if sum(1 for a in board.answers if a.count >= 2) < min_clusters:
        return "Too much of the board rests on answers only one person gave."
    return None


def points_for(cluster: AnswerCluster, panel_size: int) -> int:
    """Points are the share of the panel that said it, out of 100.

    This is why the scoring explains itself: an answer worth 31 is an answer 31
    people in 100 gave. Nothing here is invented.
    """
    return max(1, round(cluster.count / max(1, panel_size) * 100))


def difficulty_for(board: Board) -> str:
    """How hard this question will feel, inferred from the spread.

    A dominant top answer is easy to hit; a flat, wide board is hard. Used to
    order rounds so a game ramps toward its final question.
    """
    if board.top_share >= 0.40:
        return "easy"
    if board.top_share >= 0.28:
        return "medium"
    if board.coverage >= 0.65:
        return "hard"
    return "insane"
