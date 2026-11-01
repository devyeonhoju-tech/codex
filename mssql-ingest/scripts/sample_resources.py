#!/usr/bin/env python3
"""Sample service CPU/RSS and SQL container stats until the process exits."""

import argparse
import csv
import os
import subprocess
import time


def read_cpu_rss(pid: int) -> tuple[int, int]:
    with open(f"/proc/{pid}/stat", encoding="utf-8") as handle:
        data = handle.read()
    end = data.rfind(")")
    rest = data[end + 2 :].split()
    # utime and stime are the 14th and 15th stat fields.
    ticks = int(rest[11]) + int(rest[12])
    rss = int(rest[21]) * os.sysconf("SC_PAGE_SIZE")
    return ticks, rss


def docker_stats(name: str) -> tuple[str, str]:
    if not name:
        return "", ""
    try:
        out = subprocess.check_output(
            ["docker", "stats", "--no-stream", "--format", "{{.CPUPerc}}\t{{.MemUsage}}", name],
            text=True,
            timeout=8,
        ).strip()
        cpu, mem = out.split("\t", 1)
        return cpu, mem.split("/")[0].strip()
    except (subprocess.SubprocessError, OSError, ValueError) as exc:
        return "unavailable", str(exc).splitlines()[0][:120]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--sql-container", default="")
    parser.add_argument("--out", required=True)
    parser.add_argument("--interval", type=float, default=1.0)
    args = parser.parse_args()
    clk = os.sysconf("SC_CLK_TCK")
    prev_ticks, _ = read_cpu_rss(args.pid)
    prev_wall = time.monotonic()
    with open(args.out, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["ts", "service_cpu_pct", "service_rss_bytes", "sql_cpu", "sql_mem"])
        while True:
            time.sleep(args.interval)
            try:
                ticks, rss = read_cpu_rss(args.pid)
            except FileNotFoundError:
                break
            wall = time.monotonic()
            dt = wall - prev_wall
            cpu = ((ticks - prev_ticks) / clk) / dt * 100 if dt > 0 else 0.0
            prev_ticks, prev_wall = ticks, wall
            sql_cpu, sql_mem = docker_stats(args.sql_container)
            writer.writerow([f"{time.time():.3f}", f"{cpu:.1f}", rss, sql_cpu, sql_mem])
            handle.flush()


if __name__ == "__main__":
    main()
