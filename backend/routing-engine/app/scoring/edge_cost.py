"""Stage A edge eligibility and cost (used to build the routing graph)."""
from app.config import Settings


def exclusion_reason(e, mode: str, accessible: bool, s: Settings) -> str | None:
    if e.status == "blocked":
        return "blocked"                       # never penalised, always removed
    if mode not in e.travel_modes:
        return f"not_allowed_for_{mode}"
    if accessible and not e.wheelchair_ok:
        return "not_wheelchair_accessible"
    if e.status == "restricted" and (accessible or s.restricted_policy == "exclude"):
        return "restricted_excluded"
    if e.status == "unknown" and s.unknown_road_policy == "exclude":
        return "unknown_excluded"
    return None


def base_speed(e, mode: str, accessible: bool, s: Settings) -> float:
    if mode == "walking":
        return s.accessible_walking_speed_mps if accessible else s.walking_speed_mps
    return e.length / e.travel_time


def stage_a_cost(e, mode: str, accessible: bool, s: Settings) -> float:
    """Stage A: travel time x hazard multiplier x status multiplier (all multipliers >= 1 by default)."""
    tt = e.length / base_speed(e, mode, accessible, s)
    mult = 1.0 + s.alpha_flood * e.flood_risk / 100.0 + s.alpha_access * e.access_risk / 100.0
    if e.status == "restricted":
        mult *= s.restricted_multiplier
    elif e.status == "unknown":
        mult *= s.unknown_multiplier
    return tt * mult


def is_admissible_config(s: Settings) -> bool:
    """Haversine/max_speed is admissible iff every cost multiplier is >= 1."""
    return (s.alpha_flood >= 0 and s.alpha_access >= 0
            and s.restricted_multiplier >= 1.0 and s.unknown_multiplier >= 1.0)


