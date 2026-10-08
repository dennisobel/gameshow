"""LangGraph wiring for the generation pipeline.

The graph is small on purpose. Its value is not branching complexity — it is
that every transition is a named node with recorded state, so a run can be
traced, resumed and explained afterwards (ARCHITECTURE §4).

    plan -> write -> (nothing drafted? -> end) -> evaluate
                 \\-> revise -> write        (at most once)

The revision edge is the reflection loop from ch. 6, bounded to one pass:
reflection materially improves output, and every extra turn multiplies cost and
compounds error.
"""

from __future__ import annotations

import logging

from langgraph.graph import END, StateGraph

from app.graph.pipeline import MAX_REVISIONS, Pipeline
from app.graph.state import GraphState, TraceEvent

log = logging.getLogger(__name__)


def build_graph(pipeline: Pipeline):
    graph = StateGraph(GraphState)

    graph.add_node("plan", pipeline.plan)
    graph.add_node("write", pipeline.write)
    graph.add_node("evaluate", pipeline.evaluate)
    graph.add_node("revise", _revise)

    graph.set_entry_point("plan")
    graph.add_edge("plan", "write")
    graph.add_conditional_edges("write", _after_write, {"evaluate": "evaluate", "end": END})
    graph.add_conditional_edges("evaluate", _after_evaluate, {"revise": "revise", "end": END})
    graph.add_edge("revise", "write")

    return graph.compile()


def _after_write(state: GraphState) -> str:
    return "evaluate" if state.get("drafts") else "end"


def _after_evaluate(state: GraphState) -> str:
    """Try once more only if the batch produced nothing usable.

    A partially successful batch is accepted as it stands: paying for a second
    round of writing to top up a batch that already works is not worth it.
    """
    results = state.get("results") or []
    kept = [r for r in results if r.status in ("approved", "review")]
    if kept:
        return "end"
    if state.get("revisions_used", 0) >= MAX_REVISIONS:
        return "end"
    return "revise"


async def _revise(state: GraphState) -> GraphState:
    """Feed the rejection reasons back to the writer for one more attempt.

    The writer is told what went wrong in the same words the gate and the judge
    used, which is the whole point of those components returning prose reasons.
    """
    results = state.get("results") or []
    reasons: list[str] = []
    for r in results[-6:]:
        if r.status == "rejected" and r.reject_reason:
            reasons.append(f'- "{r.prompt}" was rejected: {r.reject_reason}')

    feedback = ""
    if reasons:
        feedback = (
            "Your previous attempt produced nothing usable. Here is what went wrong:\n"
            + "\n".join(reasons)
            + "\n\nWrite different questions that avoid these problems."
        )

    events = list(state.get("events") or [])
    events.append(
        TraceEvent(node="revise", status="retry", detail={"reasons": len(reasons)})
    )
    log.info("revising after %d rejections", len(reasons))

    return {
        **state,
        "revision_feedback": feedback,
        "revisions_used": state.get("revisions_used", 0) + 1,
        "drafts": [],
        "events": events,
    }
