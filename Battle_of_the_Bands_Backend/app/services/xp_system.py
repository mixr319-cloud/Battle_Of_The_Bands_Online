def xp_to_next_level(level: int) -> int:
    return 500 + level * 150

def apply_xp(current_xp: int, current_level: int, amount: int):
    xp = current_xp + amount
    level = current_level
    xp_to_next = xp_to_next_level(level)
    while xp >= xp_to_next:
        xp -= xp_to_next
        level += 1
        xp_to_next = xp_to_next_level(level)
    return xp, level, xp_to_next

RANK_THRESHOLDS = [
    (1, "Fresh Noise"),
    (5, "Rhythm Rider"),
    (10, "Loop Wizard"),
    (20, "Beat Architect"),
    (35, "Sound Sovereign"),
    (50, "Band Legend"),
]

def get_rank(level: int) -> str:
    rank = RANK_THRESHOLDS[0][1]
    for lvl, r in RANK_THRESHOLDS:
        if level >= lvl:
            rank = r
    return rank

COLORS = ["#a855f7","#22d3ee","#f472b6","#34d399","#fb923c","#818cf8","#f87171","#4ade80"]
