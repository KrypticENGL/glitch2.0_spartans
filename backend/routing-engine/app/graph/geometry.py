"""Spherical/planar helpers. Coordinates are (lon, lat) tuples."""
import math

EARTH_R = 6_371_008.8
DEG = math.pi / 180.0


def haversine(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1, p2 = lat1 * DEG, lat2 * DEG
    dp, dl = p2 - p1, (lon2 - lon1) * DEG
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(min(1.0, math.sqrt(h)))


def cumulative_lengths(coords) -> list[float]:
    cum = [0.0]
    for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
        cum.append(cum[-1] + haversine(x1, y1, x2, y2))
    return cum


def project_to_segment(px, py, ax, ay, bx, by):
    """Point-to-segment in a local tangent plane centred on P. Returns (distance_m, t in [0,1])."""
    k = math.cos(py * DEG) * EARTH_R * DEG
    m = EARTH_R * DEG
    ax_, ay_ = (ax - px) * k, (ay - py) * m
    bx_, by_ = (bx - px) * k, (by - py) * m
    dx, dy = bx_ - ax_, by_ - ay_
    seg2 = dx * dx + dy * dy
    t = 0.0 if seg2 == 0 else max(0.0, min(1.0, -(ax_ * dx + ay_ * dy) / seg2))
    qx, qy = ax_ + t * dx, ay_ + t * dy
    return math.hypot(qx, qy), t


def point_at(coords, cum, frac):
    """Point at length-fraction `frac` along a polyline; returns (lon, lat, segment_index)."""
    total = cum[-1]
    target = frac * total
    for i in range(len(coords) - 1):
        if cum[i + 1] >= target or i == len(coords) - 2:
            seg = cum[i + 1] - cum[i]
            t = 0.0 if seg == 0 else max(0.0, min(1.0, (target - cum[i]) / seg))
            (x1, y1), (x2, y2) = coords[i], coords[i + 1]
            return x1 + t * (x2 - x1), y1 + t * (y2 - y1), i
    return coords[-1][0], coords[-1][1], len(coords) - 2


def slice_polyline(coords, cum, a: float, b: float) -> list[tuple[float, float]]:
    """Sub-polyline between length fractions a and b (reversed when a > b)."""
    if a > b:
        return slice_polyline(coords, cum, b, a)[::-1]
    if a <= 0.0 and b >= 1.0:
        return list(coords)
    ax, ay, ia = point_at(coords, cum, a)
    bx, by, ib = point_at(coords, cum, b)
    out = [(ax, ay)] + [tuple(c) for c in coords[ia + 1: ib + 1]] + [(bx, by)]
    dedup = [out[0]]
    for p in out[1:]:
        if p != dedup[-1]:
            dedup.append(p)
    return dedup if len(dedup) > 1 else [dedup[0], dedup[0]]
