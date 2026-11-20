from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Point(Camel):
    latitude: float     # range-checked in the service -> 422 INVALID_COORDINATES
    longitude: float


class Population(Camel):
    children: int = Field(0, ge=0)
    elderly: int = Field(0, ge=0)
    disabled: int = Field(0, ge=0)
    medical_needs: bool = False


class Weights(Camel):
    flood: float | None = None
    access: float | None = None
    distance: float | None = None
    capacity: float | None = None
    population: float | None = None


class ShelterIn(Camel):
    id: str
    code: str
    name: str
    longitude: float
    latitude: float
    total_capacity: int = Field(ge=0)
    available_capacity: int
    status: str
    accessible: bool = False


class EvaluateRequest(Camel):
    graph_version: int | None = None
    origin: Point
    people_count: int = Field(ge=1, le=10_000)
    travel_mode: Literal["walking", "driving"]
    needs_accessible_route: bool = False
    max_alternatives: int = Field(3, ge=0, le=5)
    population: Population = Population()
    weights: Weights | None = None
    shelters: list[ShelterIn] = Field(default_factory=list, max_length=500)


class ReloadRequest(Camel):
    expected_version: int | None = None
