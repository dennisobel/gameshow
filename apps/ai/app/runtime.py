"""Event-loop setup.

psycopg's async mode cannot run on Windows' default ProactorEventLoop. The
service itself runs on Linux in Docker, where this is moot, but the CLI is meant
to be usable on a developer's machine, so pick a compatible loop there.
"""

from __future__ import annotations

import asyncio
import selectors
import sys
from collections.abc import Coroutine
from typing import Any, TypeVar

T = TypeVar("T")


def run(coro: Coroutine[Any, Any, T]) -> T:
    """asyncio.run, with a selector loop on Windows."""
    if sys.platform != "win32":
        return asyncio.run(coro)

    def loop_factory() -> asyncio.AbstractEventLoop:
        return asyncio.SelectorEventLoop(selectors.SelectSelector())

    try:
        return asyncio.run(coro, loop_factory=loop_factory)
    except TypeError:
        # Python < 3.12 has no loop_factory argument.
        loop = loop_factory()
        try:
            asyncio.set_event_loop(loop)
            return loop.run_until_complete(coro)
        finally:
            asyncio.set_event_loop(None)
            loop.close()
