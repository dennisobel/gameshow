import pytest

from app.graph.board import build_board, check_board, difficulty_for, points_for
from app.graph.gate import check_format
from app.models import AnswerCluster


# ----------------------------------------------------------------- the gate

GOOD = [
    "Name something people forget when they leave the house.",
    "Name a reason someone might be late for work.",
    "Name something people do while waiting in a long queue.",
    "Name an item found in almost every kitchen.",
]


@pytest.mark.parametrize("prompt", GOOD)
def test_gate_accepts_well_formed_questions(prompt):
    assert check_format(prompt) is None, f"should have accepted: {prompt}"


BAD = [
    ("Short.", "too short"),
    ("What is the capital of Peru?", "trivia"),
    ("Is coffee better than tea.", "yes/no"),
    ("Name something you hide from your partner.", "second person"),
    ("How many people live in Nairobi.", "trivia"),
    ("Name something people do; then regret.", "punctuation"),
    ("Name something people forget", "no full stop"),
    ("Tell me something people forget.", "wrong opening"),
    ("Name something that reminds people of suicide.", "banned topic"),
    ("Name something people " + "really " * 30 + "forget.", "too long"),
]


@pytest.mark.parametrize("prompt,why", BAD)
def test_gate_rejects_bad_questions(prompt, why):
    reason = check_format(prompt)
    assert reason is not None, f"should have rejected ({why}): {prompt}"
    assert len(reason) > 10, "a rejection reason is fed back to the writer, so it must be useful"


def test_gate_does_not_trip_on_innocent_substrings():
    # "grapes" contains "rape"; the banned list is matched on word boundaries.
    assert check_format("Name something people put in a fruit salad with grapes.") is None
    assert check_format("Name something found in a classic family kitchen.") is None


# ---------------------------------------------------------------- the board

def board_of(*counts: int, panel: int = 60):
    clusters = [
        AnswerCluster(text=f"Answer {i}", count=c, variants=[f"answer {i}"])
        for i, c in enumerate(counts, start=1)
    ]
    return build_board(clusters, panel, board_size=5)


def test_build_board_measures_coverage_and_top_share():
    board = board_of(20, 12, 8, 6, 4, 3, 2, panel=60)
    assert len(board.answers) == 5
    assert board.coverage == pytest.approx(50 / 60, abs=0.01)
    assert board.top_share == pytest.approx(20 / 60, abs=0.01)


def test_board_rejects_scatter():
    # Sixty people, no agreement: a player could never hit this board.
    board = board_of(3, 3, 2, 2, 2, panel=60)
    reason = check_board(board, min_coverage=0.55, max_top_share=0.70, min_clusters=4)
    assert reason is not None and "scatter" in reason.lower()


def test_board_rejects_a_giveaway():
    # One answer owns the question: there is no game in it.
    board = board_of(50, 4, 3, 2, 1, panel=60)
    reason = check_board(board, min_coverage=0.55, max_top_share=0.70, min_clusters=4)
    assert reason is not None and "gives itself away" in reason


def test_board_rejects_too_few_answers():
    board = board_of(30, 20, panel=60)
    reason = check_board(board, min_coverage=0.55, max_top_share=0.70, min_clusters=4)
    assert reason is not None and "distinct answers" in reason


def test_board_rejects_a_tail_of_singletons():
    # Coverage passes, but three of the five slots rest on one person each.
    board = board_of(22, 14, 1, 1, 1, panel=40)
    reason = check_board(board, min_coverage=0.55, max_top_share=0.70, min_clusters=4)
    assert reason is not None and "one person gave" in reason


def test_board_accepts_a_healthy_spread():
    board = board_of(18, 13, 9, 7, 5, panel=60)
    assert check_board(board, min_coverage=0.55, max_top_share=0.70, min_clusters=4) is None


def test_points_state_how_many_people_said_it():
    cluster = AnswerCluster(text="Keys", count=31, variants=[])
    assert points_for(cluster, 100) == 31
    assert points_for(cluster, 60) == 52  # 31/60 expressed per hundred
    # Never zero: an answer on the board is always worth something.
    assert points_for(AnswerCluster(text="Rare", count=1, variants=[]), 500) == 1


def test_difficulty_tracks_the_spread():
    assert difficulty_for(board_of(30, 8, 6, 4, 2, panel=60)) == "easy"
    assert difficulty_for(board_of(18, 13, 9, 7, 5, panel=60)) == "medium"
    assert difficulty_for(board_of(10, 9, 9, 8, 8, panel=60)) in ("hard", "insane")
