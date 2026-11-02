#!/usr/bin/env python3
"""Turn a k6 summary, resource samples, and SQL counts into one result record."""

import argparse
import csv
import json
import statistics
from pathlib import Path


def metric_values(metrics: dict, prefix: str, phase: str | None) -> dict:
    best = {}
    for name, metric in metrics.items():
        if not name.startswith(prefix):
            continue
        if phase and f"phase:{phase}" not in name:
            continue
        values = metric.get("values") or {}
        if not best or values.get("count", 0) >= best.get("count", 0):
            best = values
    if best or phase is None:
        return best
    return metric_values(metrics, prefix, None)


def counter_sum(metrics: dict, prefix: str, phase: str | None) -> float:
    total = 0.0
    matched = False
    for name, metric in metrics.items():
        if not name.startswith(prefix):
            continue
        if phase and f"phase:{phase}" not in name:
            continue
        total += float((metric.get("values") or {}).get("count", 0))
        matched = True
    if matched or phase is None:
        return total
    return counter_sum(metrics, prefix, None)


def parse_cpu(value: str) -> float | None:
    text = value.strip().rstrip("%")
    if not text or text == "unavailable":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_mem_bytes(value: str) -> float | None:
    text = value.strip()
    if not text or text == "unavailable":
        return None
    number = ""
    unit = ""
    for char in text:
        if char.isdigit() or char == ".":
            number += char
        elif char.isalpha():
            unit += char
    if not number:
        return None
    scale = {
        "B": 1,
        "KB": 1e3,
        "MB": 1e6,
        "GB": 1e9,
        "KIB": 1024,
        "MIB": 1024**2,
        "GIB": 1024**3,
        "KI": 1024,
        "MI": 1024**2,
        "GI": 1024**3,
    }.get(unit.upper(), 1)
    return float(number) * scale


def mean(values: list[float]) -> float | None:
    return statistics.fmean(values) if values else None


def peak(values: list[float]) -> float | None:
    return max(values) if values else None


def fmt(value: float | None, digits: int = 1) -> str:
    if value is None:
        return "n/a"
    return f"{value:.{digits}f}"


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * fraction
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    weight = rank - low
    return ordered[low] * (1 - weight) + ordered[high] * weight


def from_k6_csv(path: Path, phase: str) -> dict:
    """k6's end summary folds every scenario together. The CSV keeps the scenario name."""
    durations: list[float] = []
    phase_requests = 0
    phase_non_202 = 0
    accepted = 0
    rejected = 0
    other = 0
    with path.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row.get("metric_name") != "http_reqs" and row.get("metric_name") != "http_req_duration":
                continue
            scenario = row.get("scenario") or ""
            status = row.get("status") or ""
            in_phase = scenario == phase
            if row["metric_name"] == "http_reqs":
                if status == "202":
                    accepted += 1
                elif status in {"429", "503"}:
                    rejected += 1
                else:
                    other += 1
                if in_phase:
                    phase_requests += 1
                    if status != "202":
                        phase_non_202 += 1
            elif in_phase:
                durations.append(float(row["metric_value"]))
    return {
        "durations": durations,
        "phase_requests": phase_requests,
        "phase_non_202": phase_non_202,
        "accepted": accepted,
        "rejected": rejected,
        "other": other,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--summary", required=True)
    parser.add_argument("--samples", required=True)
    parser.add_argument("--csv", required=True)
    parser.add_argument("--meta", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    summary = json.loads(Path(args.summary).read_text(encoding="utf-8"))
    meta = json.loads(Path(args.meta).read_text(encoding="utf-8"))
    metrics = summary.get("metrics") or {}
    phase = meta.get("phase") or "sustain"
    duration = float(meta["duration_seconds"])
    target = float(meta["target_rps"])
    observed = from_k6_csv(Path(args.csv), phase)
    durations = observed["durations"]
    sustain_count = float(observed["phase_requests"])
    achieved = sustain_count / duration if duration else 0.0
    accepted = float(observed["accepted"])
    rejected = float(observed["rejected"])
    other = float(observed["other"])
    dropped = counter_sum(metrics, "dropped_iterations", None)
    error_rate = (observed["phase_non_202"] / sustain_count) if sustain_count else 0.0
    reqs = {"rate": achieved, "count": sustain_count}
    failed = {"rate": error_rate}

    service_cpu: list[float] = []
    service_rss: list[float] = []
    sql_cpu: list[float] = []
    sql_mem: list[float] = []
    with Path(args.samples).open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            service_cpu.append(float(row["service_cpu_pct"]))
            service_rss.append(float(row["service_rss_bytes"]))
            cpu = parse_cpu(row["sql_cpu"])
            mem = parse_mem_bytes(row["sql_mem"])
            if cpu is not None:
                sql_cpu.append(cpu)
            if mem is not None:
                sql_mem.append(mem)

    rows = int(meta["rows"])
    distinct_ids = int(meta["distinct_ids"])
    resend_ratio = float(meta.get("resend_ratio") or 0)
    duplicate_rows = rows - distinct_ids
    if resend_ratio > 0:
        # A resend of a committed vantr is another 202 and not another row.
        count_ok = duplicate_rows == 0 and accepted >= rows and rows > 0
    else:
        count_ok = rows == int(accepted) and distinct_ids == rows
    expected = target * duration
    arrival_ok = expected <= 0 or sustain_count >= expected * 0.99
    sustained = (
        meta.get("profile") == "sustain"
        and arrival_ok
        and error_rate < 0.01
        and dropped < max(1.0, sustain_count * 0.01)
    )
    batches = meta.get("batches") or 0
    result = {
        "service": meta["service"],
        "mode": meta["mode"],
        "profile": meta["profile"],
        "target_rps": target,
        "duration_seconds": duration,
        "achieved_rps": round(achieved, 1),
        "k6_reported_rps": reqs.get("rate"),
        "sustain_requests": sustain_count,
        "accepted_total": accepted,
        "accepted_phase": sustain_count - observed["phase_non_202"],
        "rejected": rejected,
        "other_status": other,
        "dropped_iterations": dropped,
        "error_rate": error_rate,
        "p50_ms": percentile(durations, 0.50),
        "p95_ms": percentile(durations, 0.95),
        "p99_ms": percentile(durations, 0.99),
        "avg_ms": mean(durations),
        "max_ms": peak(durations),
        "avg_batch_rows": (rows / batches) if batches else None,
        "rows": rows,
        "distinct_ids": distinct_ids,
        "duplicate_rows": duplicate_rows,
        "resend_ratio": resend_ratio,
        "count_matches_accepted": count_ok,
        "sustained_target": sustained,
        "batch_size": meta.get("batch_size"),
        "flush_interval_ms": meta.get("flush_interval_ms"),
        "writers": meta.get("writers"),
        "batches": meta.get("batches"),
        "service_cpu_avg_pct": mean(service_cpu),
        "service_cpu_peak_pct": peak(service_cpu),
        "service_rss_peak_bytes": peak(service_rss),
        "sql_cpu_avg_pct": mean(sql_cpu),
        "sql_cpu_peak_pct": peak(sql_cpu),
        "sql_mem_peak_bytes": peak(sql_mem),
        "payload_bytes": meta.get("payload_bytes"),
        "recovery_model": meta.get("recovery_model"),
        "delayed_durability": meta.get("delayed_durability"),
        "host": meta.get("host"),
        "cpus": meta.get("cpus"),
        "note": "indicative measurement from a single cloud VM",
    }
    Path(args.out).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    if meta.get("strict") and not (count_ok and error_rate < 0.01 and achieved >= target * 0.8):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
