from app.graph.text import canonical, content_tokens, edit_distance, jaccard, near_duplicate, normalize


def test_normalize():
    assert normalize("  The Keys!  ") == "keys"
    assert normalize("My Phone") == "phone"
    assert normalize("ICE-CREAM") == "ice cream"
    assert normalize("Won't") == "wont"
    assert normalize("Café") == "cafe"
    assert normalize("...") == ""
    # Never reduce a single filler word to nothing.
    assert normalize("the") == "the"


def test_canonical_folds_plurals():
    assert canonical("keys") == canonical("Key")
    assert canonical("my phones") == canonical("phone")
    assert canonical("glasses") == "glass"
    # Not plurals: these must survive.
    assert canonical("bus") == "bus"
    assert canonical("status") == "status"


def test_near_duplicate():
    assert near_duplicate("keys", "my keys")
    assert near_duplicate("car keys", "keys")
    assert near_duplicate("phone", "phones")
    assert near_duplicate("smartphone", "smartphnoe")  # typo
    assert not near_duplicate("tea", "coffee")
    assert not near_duplicate("milk", "eggs")


def test_near_duplicate_does_not_merge_short_distinct_words():
    # One edit apart, but different answers. Merging them would silently
    # destroy a board slot.
    assert not near_duplicate("cat", "car")
    assert not near_duplicate("tea", "sea")


def test_content_tokens_drops_boilerplate():
    tokens = content_tokens("Name something people forget when they leave the house.")
    # Tokens are stemmed, so "house"/"houses" and "leave"/"leaving" agree.
    assert "forget" in tokens
    assert "hous" in tokens
    assert "leav" in tokens
    # "name", "something" and "people" appear in nearly every question, so they
    # carry no signal for dedup.
    assert "name" not in tokens
    assert "something" not in tokens
    assert "people" not in tokens


def test_stem_folds_inflections_without_destroying_short_words():
    from app.graph.text import stem

    assert stem("leaving") == stem("leave")
    assert stem("houses") == stem("house")
    assert stem("forgot") == "forgot"
    # Short words must survive, or they stop matching anything.
    assert stem("thing") == "thing"
    assert stem("bring") == "bring"


def test_jaccard_detects_rephrasing():
    a = content_tokens("Name something people forget when they leave the house.")
    b = content_tokens("Name something people forget when leaving their house.")
    c = content_tokens("Name a food you would find in a refrigerator.")
    assert jaccard(a, b) > 0.6
    assert jaccard(a, c) < 0.2
    assert jaccard(set(), a) == 0.0


def test_edit_distance_early_exit():
    assert edit_distance("abc", "abc") == 0
    assert edit_distance("abc", "abd") == 1
    assert edit_distance("abcdefghij", "z", 2) > 2
