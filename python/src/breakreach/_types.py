from __future__ import annotations


class NotGiven:
    """An argument left out: it isn't sent at all, while None is sent as null.

    PATCH calls change only the fields they send, so the difference matters:
    ``update_comment_dm_rule(rule_id, media_id=None)`` makes the rule watch
    every post, leaving ``media_id`` out keeps the post it watches.
    """

    def __bool__(self) -> bool:
        return False

    def __repr__(self) -> str:
        return "NOT_GIVEN"


NOT_GIVEN = NotGiven()
