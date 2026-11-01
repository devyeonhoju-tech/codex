#!/usr/bin/env python3
"""Bucket a k6 CSV into the step-test stages and report achieved rps and errors."""

import argparse
import csv
import json
from pathlib import Path

STAGES = [
    ("200", 0, 15, 200),
    ("500", 15, 30, 500),
    ("1000", 30, 50, 1000),
    ("1500", 50, 70, 1500),
    ("2000", 70, 90, 2000),
    ("3000", 90, 110, 3000),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    rows = list(csv.DictReader(Path(args.csv).open(encoding="utf-8")))
    if not rows:
        Path(args.out).write_text("[]\n", encoding="utf-8")
        return
    # k6 csv uses metric_name/timestamp/metric_value plus a status column.
    time_key = "timestamp" if "timestamp" in rows[0] else next(iter(rows[0]))
    start = min(float(row[time_key]) for row in rows if row.get("metric_name") == "http_reqs")
    buckets = []
    for label, begin, end, target in STAGES:
        sent = 0
        failed = 0
        for row in rows:
            if row.get("metric_name") != "http_reqs":
                continue
            offset = float(row[time_key]) - start
            if begin <= offset < end:
                sent += 1
                status = row.get("status") or ""
                if status not in ("202", "200"):
                    failed += 1
        seconds = end - begin
        achieved = sent / seconds if seconds else 0
        buckets.append(
            {
                "target_rps": target,
                "window_s": seconds,
                "requests": sent,
                "achieved_rps": round(achieved, 1),
                "non_202": failed,
                "held": achieved >= target * 0.95 and failed / sent < 0.01 if sent else False,
            }
        )
    Path(args.out).write_text(json.dumps(buckets, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(buckets, indent=2))


if __name__ == "__main__":
    main()
