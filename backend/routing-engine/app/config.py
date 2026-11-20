from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://postgres:postgres@127.0.0.1:5432/suraksha"
    db_connect_timeout_seconds: int = 5

    snap_max_meters: float = 400.0
    unknown_road_policy: Literal["penalize", "exclude"] = "penalize"
    restricted_policy: Literal["penalize", "exclude"] = "penalize"

    # Stage A edge cost = travel_time * (1 + alpha_flood*F/100 + alpha_access*A/100) * status multiplier
    alpha_flood: float = 2.0
    alpha_access: float = 1.0
    restricted_multiplier: float = 3.0
    unknown_multiplier: float = 1.5

    # Stage B: status penalty points added to the access factor A (length-weighted)
    restricted_access_points: float = 30.0
    unknown_access_points: float = 15.0

    # Stage B default weights (R = wF*F + wA*A + wD*D + wC*C + wP*P)
    weight_flood: float = 0.35
    weight_access: float = 0.25
    weight_distance: float = 0.15
    weight_capacity: float = 0.15
    weight_population: float = 0.10

    walking_speed_mps: float = 1.3
    accessible_walking_speed_mps: float = 1.0
    d_max_walking_meters: float = 6000.0
    d_max_driving_meters: float = 15000.0

    max_alternatives: int = 5
    candidate_shelters: int = 4          # top-N reachable shelters that get A* + Yen alternatives
    yen_paths_per_shelter: int = 6       # upper bound on Yen paths generated per shelter
    overlap_threshold: float = 0.7       # reject alternatives sharing > this fraction of their length
    excluded_roads_buffer_meters: float = 300.0
    excluded_roads_cap: int = 50
    routing_time_budget_seconds: float = 5.0  # alternatives generation stops once exceeded


@lru_cache
def get_settings() -> Settings:
    return Settings()
