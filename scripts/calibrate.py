"""Fit the travel-time model against published Citi Bike trip history.

The app estimates riding time from straight-line distance rather than calling a
routing engine, because the planner evaluates thousands of candidate edges per
trip. That estimate has to come from somewhere defensible, and Citi Bike
publishes every trip it has ever carried: start and end coordinates, and the
exact billed duration.

Usage:
    py scripts/calibrate.py --month 202604
    py scripts/calibrate.py --month 202604 --quantile 0.85

Writes src/planner/travel-model.json.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import random
import statistics
import sys
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "cache"
OUTPUT = ROOT / "src" / "planner" / "travel-model.json"
SOURCE = "https://s3.amazonaws.com/tripdata"

EARTH_RADIUS_M = 6_371_008.8

# A ride under two minutes is usually someone changing their mind at the dock,
# and one over two hours is a bike that was left somewhere. Neither describes
# the trips this app plans.
MIN_SECONDS, MAX_SECONDS = 120, 7_200
MIN_METERS, MAX_METERS = 200, 15_000

# Wide enough that every bin holds thousands of rides, narrow enough that the
# quantile is still local.
BIN_METERS = 250
MIN_PER_BIN = 200

# The fit covers the distances the planner actually emits. A leg is capped at
# 25 or 35 minutes, which is roughly 3 to 5 km, and letting 9 km commutes into
# the fit bends the line away from that range. Coverage is still reported over
# the full spread so the extrapolation stays visible.
FIT_MIN_METERS = 300
FIT_MAX_METERS = 6_000


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


@dataclass
class Ride:
    meters: float
    seconds: float


def download(month: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    name = f"{month}-citibike-tripdata.zip"
    path = CACHE / name
    if path.exists():
        print(f"using cached {path.relative_to(ROOT)} ({path.stat().st_size / 1e6:.0f} MB)")
        return path

    print(f"downloading {name}, this is a few hundred MB")
    urllib.request.urlretrieve(f"{SOURCE}/{name}", path)
    return path


def parse_time(value: str) -> datetime | None:
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def iter_csv_members(archive: zipfile.ZipFile):
    """Yield every CSV in the archive, including any nested zip."""
    for info in archive.infolist():
        if info.is_dir() or "__MACOSX" in info.filename:
            continue
        lower = info.filename.lower()
        if lower.endswith(".csv"):
            yield info.filename, archive.open(info)
        elif lower.endswith(".zip"):
            nested = zipfile.ZipFile(io.BytesIO(archive.read(info)))
            yield from iter_csv_members(nested)


def load_rides(path: Path, sample_rate: float) -> tuple[list[Ride], dict[str, int]]:
    """Classic-bike rides with a usable distance and duration."""
    rides: list[Ride] = []
    counts = {"rows": 0, "electric": 0, "bad_coords": 0, "out_of_range": 0, "kept": 0}
    random.seed(20260904)

    with zipfile.ZipFile(path) as archive:
        for name, handle in iter_csv_members(archive):
            print(f"  reading {name}")
            reader = csv.DictReader(io.TextIOWrapper(handle, encoding="utf-8", errors="replace"))

            for row in reader:
                counts["rows"] += 1

                # Ebikes bill per minute regardless, so they are a different
                # product and a different speed distribution.
                if row.get("rideable_type") != "classic_bike":
                    counts["electric"] += 1
                    continue
                if sample_rate < 1.0 and random.random() > sample_rate:
                    continue

                try:
                    lat1 = float(row["start_lat"])
                    lon1 = float(row["start_lng"])
                    lat2 = float(row["end_lat"])
                    lon2 = float(row["end_lng"])
                except (TypeError, ValueError, KeyError):
                    counts["bad_coords"] += 1
                    continue

                started = parse_time(row.get("started_at", ""))
                ended = parse_time(row.get("ended_at", ""))
                if started is None or ended is None:
                    counts["bad_coords"] += 1
                    continue

                seconds = (ended - started).total_seconds()
                meters = haversine(lat1, lon1, lat2, lon2)

                if not (MIN_SECONDS <= seconds <= MAX_SECONDS) or not (
                    MIN_METERS <= meters <= MAX_METERS
                ):
                    counts["out_of_range"] += 1
                    continue

                rides.append(Ride(meters, seconds))
                counts["kept"] += 1

    return rides, counts


def fit_quantile_line(rides: list[Ride], quantile: float) -> tuple[float, float]:
    """Least-squares line through the per-distance-bin quantile of duration.

    Fitting the quantile of each distance bin, rather than the mean of
    everything, gives the frontier most riders come in under. Bins are weighted
    by ride count so a thinly populated long-distance bin cannot swing the fit.
    """
    bins: dict[int, list[float]] = {}
    for ride in rides:
        if not (FIT_MIN_METERS <= ride.meters <= FIT_MAX_METERS):
            continue
        bins.setdefault(int(ride.meters // BIN_METERS), []).append(ride.seconds)

    points: list[tuple[float, float, int]] = []
    for index, durations in sorted(bins.items()):
        if len(durations) < MIN_PER_BIN:
            continue
        centre = (index + 0.5) * BIN_METERS
        points.append((centre, quantile_of(durations, quantile), len(durations)))

    if len(points) < 4:
        raise SystemExit("not enough distance bins to fit; try a larger sample")

    total = sum(weight for _, _, weight in points)
    mean_x = sum(x * w for x, _, w in points) / total
    mean_y = sum(y * w for _, y, w in points) / total

    covariance = sum(w * (x - mean_x) * (y - mean_y) for x, y, w in points)
    variance = sum(w * (x - mean_x) ** 2 for x, _, w in points)
    slope = covariance / variance
    intercept = mean_y - slope * mean_x

    print(f"\n  fitted over {len(points)} distance bins ({total:,} rides)")
    return intercept, slope


def quantile_of(values: list[float], q: float) -> float:
    ordered = sorted(values)
    position = q * (len(ordered) - 1)
    low = int(math.floor(position))
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def evaluate(rides: list[Ride], intercept: float, slope: float) -> dict[str, float]:
    """Held-out accuracy.

    Absolute error is reported but is not the number that matters: the estimate
    deliberately sits above most rides, so it is large by construction. Coverage
    is the real score, and it has to hold at every distance rather than only on
    average. A line that over-predicts short trips and under-predicts long ones
    can post a perfect overall figure while failing the riders it strands.
    """
    errors, slack = [], []
    covered = 0
    for ride in rides:
        estimate = intercept + ride.meters * slope
        errors.append(abs(estimate - ride.seconds))
        slack.append(estimate - ride.seconds)
        if ride.seconds <= estimate:
            covered += 1

    return {
        "medianAbsErrorSeconds": round(statistics.median(errors), 1),
        "medianSlackSeconds": round(statistics.median(slack), 1),
        "withinEstimateShare": round(covered / len(rides), 4),
    }


def coverage_by_distance(rides: list[Ride], intercept: float, slope: float) -> None:
    """Coverage in 1 km bands, to check the linear form holds end to end."""
    bands: dict[int, list[bool]] = {}
    for ride in rides:
        band = int(ride.meters // 1000)
        bands.setdefault(band, []).append(ride.seconds <= intercept + ride.meters * slope)

    print("\n  coverage by distance (target is the fitted quantile):")
    for band, hits in sorted(bands.items()):
        if len(hits) < 500:
            continue
        share = sum(hits) / len(hits)
        bar = "#" * round(share * 40)
        print(f"    {band}-{band + 1} km  {share * 100:5.1f}%  {bar}  n={len(hits):,}")


def compare_models(rides: list[Ride]) -> None:
    """Does a fitted model beat a flat rate where it counts?

    Estimate error is the wrong scoreboard. What matters is how often a rider
    is charged, and a leg is only planned if the model believes it fits, so the
    test is: among legs a model would accept, how many actually run past the
    fee threshold. The gap between the target leg and that threshold absorbs
    most estimate error, which turns out to be the whole story.
    """
    in_range = [r for r in rides if FIT_MIN_METERS <= r.meters <= FIT_MAX_METERS]
    print(f"\n{len(in_range):,} rides in the planner's operating range")

    models = {
        "flat rate only (0.45 s/m, no intercept)": lambda m: 0.45 * m,
        "reasonable guess (8 mph, detour, 15% pad)": lambda m: (45 + m * 1.3 / 3.6) * 1.15,
        "fitted to trip history": lambda m: 152.6 + 0.44435 * m,
    }

    for label, target_min, limit_min in (("member", 35, 45), ("day pass", 25, 30)):
        target, limit = target_min * 60, limit_min * 60
        print(f"\n  {label}: legs planned under {target_min} min, charged past {limit_min} min")
        print(f"  {'model':44}{'legs kept':>11}{'charged':>10}")

        for name, estimate in models.items():
            kept = [r for r in in_range if estimate(r.meters) <= target]
            if not kept:
                continue
            charged = sum(1 for r in kept if r.seconds > limit)
            print(f"  {name:44}{len(kept):>11,}{charged / len(kept) * 100:>9.2f}%")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--month", default="202604", help="YYYYMM of the trip file")
    parser.add_argument("--quantile", type=float, default=0.85)
    parser.add_argument(
        "--sample", type=float, default=1.0, help="fraction of classic rides to read"
    )
    parser.add_argument(
        "--compare",
        action="store_true",
        help="score a flat rate against the fitted model on charge rate, and write nothing",
    )
    args = parser.parse_args()

    path = download(args.month)
    print("parsing trips")
    rides, counts = load_rides(path, args.sample)

    print(f"\n  {counts['rows']:,} rows")
    print(f"  {counts['electric']:,} ebike rides skipped")
    print(f"  {counts['out_of_range']:,} outside the distance or duration window")
    print(f"  {counts['bad_coords']:,} unparseable")
    print(f"  {counts['kept']:,} classic rides kept")

    if counts["kept"] < 5_000:
        raise SystemExit("too few usable rides to fit a model")

    if args.compare:
        compare_models(rides)
        return

    # Hold out a fifth so the reported error is not measured on the fit itself.
    random.seed(11)
    random.shuffle(rides)
    split = int(len(rides) * 0.8)
    train, test = rides[:split], rides[split:]

    intercept, slope = fit_quantile_line(train, args.quantile)

    # Scored over the same range it is fitted for, which is the range the app
    # will ask it about.
    in_range = [r for r in test if FIT_MIN_METERS <= r.meters <= FIT_MAX_METERS]
    scores = evaluate(in_range, intercept, slope)

    implied_speed = 1 / slope
    print(f"  fixedSeconds    {intercept:.1f}")
    print(f"  secondsPerMeter {slope:.4f}  ({implied_speed:.2f} m/s straight-line, {implied_speed * 2.237:.1f} mph)")
    print(f"\n  held-out rides finishing inside the estimate: {scores['withinEstimateShare'] * 100:.1f}%")
    print(f"  median slack {scores['medianSlackSeconds'] / 60:.1f} min, median absolute error {scores['medianAbsErrorSeconds']:.0f} s")

    coverage_by_distance(test, intercept, slope)

    model = {
        "fixedSeconds": round(intercept, 1),
        "secondsPerMeter": round(slope, 5),
        "quantile": args.quantile,
        "calibration": {
            "source": f"Citi Bike {args.month} trip history",
            "trips": counts["kept"],
            "medianAbsErrorSeconds": scores["medianAbsErrorSeconds"],
            "withinEstimateShare": scores["withinEstimateShare"],
            "fittedAt": datetime.now().strftime("%Y-%m-%d"),
        },
    }

    OUTPUT.write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
