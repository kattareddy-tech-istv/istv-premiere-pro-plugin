#!/usr/bin/env python3
"""
Concurrent load test against the Inside Success TV API.

Modes:
  smoke (default) — health, models, small upload, transcript import, optional premiere-xml.
                    No Rev transcription loop, no LLM. Safe for 25+ parallel users.
  xml_only        — writes a fixture cutsheet JSON, then N concurrent POST export-xml.
  e2e             — 1 user (or E2E_USERS): full upload → compress → Rev → cut sheet (needs keys + time).

Usage:
  python scripts/load_test_pipeline.py --base-url http://127.0.0.1:8000 --users 25 --mode smoke
  python scripts/load_test_pipeline.py --base-url https://api.example.com --users 20 --mode xml_only

E2E (expensive):
  set TEST_AUDIO to a file path; optional REV_AI_TOKEN / keys in backend .env when hitting local server.
  E2E_USERS=1 python scripts/load_test_pipeline.py --mode e2e --base-url http://127.0.0.1:8000
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from pathlib import Path

import httpx

MINIMAL_FCP_XML = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="s1"><name>LoadTest</name>
    <rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate>
    <media><video>
      <format><samplecharacteristics><width>1920</width><height>1080</height></samplecharacteristics></format>
      <track><clipitem id="c1"><file id="f1">
        <name>A.mxf</name><pathurl>file:///test/A.mxf</pathurl><duration>1000</duration>
        <rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate>
        <media><video><samplecharacteristics>
          <rate><timebase>25</timebase><ntsc>FALSE</ntsc></rate>
          <width>1920</width><height>1080</height>
          <anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio>
          <fielddominance>none</fielddominance>
        </samplecharacteristics></video>
        <audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></audio>
        </media>
      </file></clipitem></track>
    </video></media>
  </sequence>
</xmeml>"""


def percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    k = (len(sorted_vals) - 1) * p / 100.0
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


def print_percentiles(name: str, durations_ms: list[float]) -> None:
    if not durations_ms:
        print(f"  {name}: (no samples)")
        return
    s = sorted(durations_ms)
    print(
        f"  {name}: n={len(s)}  p50={percentile(s, 50):.1f}ms  p95={percentile(s, 95):.1f}ms  "
        f"min={s[0]:.1f}ms  max={s[-1]:.1f}ms"
    )


async def smoke_user(client: httpx.AsyncClient, base: str, user_id: int, rows: list[dict]) -> None:
    api = f"{base.rstrip('/')}/api"

    async def mark(step: str, coro):
        t0 = time.perf_counter()
        try:
            r = await coro
            dt = (time.perf_counter() - t0) * 1000
            code = getattr(r, "status_code", 200)
            rows.append(
                {"user": user_id, "step": step, "ms": dt, "ok": code < 400, "status": code}
            )
            return r
        except Exception as exc:
            dt = (time.perf_counter() - t0) * 1000
            rows.append({"user": user_id, "step": step, "ms": dt, "ok": False, "error": str(exc)})
            return None

    if await mark("health", client.get(f"{api}/health")) is None:
        return
    if await mark("models", client.get(f"{api}/generate/models")) is None:
        return

    body = b"\x00" * 2048
    if (
        await mark(
            "upload",
            client.post(f"{api}/upload", files={"file": (f"lt_{user_id}.wav", body, "audio/wav")}),
        )
        is None
    ):
        return

    sample = [
        {"speaker": 0, "text": f"Load test line u{user_id}.", "start_ts": 0.0, "end_ts": 2.0},
    ]
    if (
        await mark(
            "import",
            client.post(f"{api}/transcribe/import", json={"transcript": sample}),
        )
        is None
    ):
        return

    await mark(
        "premiere_xml",
        client.post(
            f"{api}/upload/premiere-xml",
            files={"file": (f"lt_{user_id}.xml", MINIMAL_FCP_XML.encode(), "application/xml")},
        ),
    )


async def run_smoke(base: str, users: int) -> list[dict]:
    rows: list[dict] = []
    timeout = httpx.Timeout(120.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        await asyncio.gather(*(smoke_user(client, base, i, rows) for i in range(users)))
    return rows


def write_fixture_cutsheet(cutsheets_dir: Path, cs_id: str) -> None:
    cutsheets_dir.mkdir(parents=True, exist_ok=True)
    text = (
        "DOCUMENTARY CUT SHEET\n"
        "Subject: Load Test\n"
        "STORY SUMMARY\n"
        "1. HOOK — Test.\n"
        "HOOK\n"
        '[IP @ 00:00:00–00:00:05] "Hello load test."\n'
        "[TONE: neutral — low]\n"
    )
    data = {
        "cutsheet_id": cs_id,
        "cutsheet": text,
        "provider": "loadtest",
        "model": "none",
        "input_tokens": 1,
        "output_tokens": 1,
        "cost_usd": 0.0,
    }
    (cutsheets_dir / f"{cs_id}.json").write_text(json.dumps(data, indent=2), encoding="utf-8")


async def xml_only_user(client: httpx.AsyncClient, base: str, user_id: int, cs_id: str, rows: list[dict]) -> None:
    api = f"{base.rstrip('/')}/api"
    t0 = time.perf_counter()
    try:
        r = await client.post(
            f"{api}/generate/export-xml/{cs_id}",
            json={
                "sequence_name": f"LoadTest {user_id}",
                "timebase": 25,
                "width": 1920,
                "height": 1080,
            },
        )
        dt = (time.perf_counter() - t0) * 1000
        rows.append(
            {
                "user": user_id,
                "step": "export_xml",
                "ms": dt,
                "ok": r.status_code == 200,
                "status": r.status_code,
            }
        )
    except Exception as exc:
        dt = (time.perf_counter() - t0) * 1000
        rows.append({"user": user_id, "step": "export_xml", "ms": dt, "ok": False, "error": str(exc)})


async def run_xml_only(base: str, users: int, data_dir: Path) -> list[dict]:
    cs_id = "loadtest_fixture_cutsheet"
    write_fixture_cutsheet(data_dir / "cutsheets", cs_id)
    rows: list[dict] = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
        await asyncio.gather(*(xml_only_user(client, base, i, cs_id, rows) for i in range(users)))
    return rows


async def run_e2e(base: str, users: int) -> list[dict]:
    audio = os.getenv("TEST_AUDIO", "").strip()
    if not audio or not Path(audio).is_file():
        raise SystemExit("E2E mode requires TEST_AUDIO env var pointing to an existing audio file.")

    rows: list[dict] = []
    api = f"{base.rstrip('/')}/api"
    model = os.getenv("E2E_MODEL", "claude-haiku-4-5")

    async def one_user(uid: int) -> None:
        async with httpx.AsyncClient(timeout=httpx.Timeout(3600.0)) as client:

            def add(step: str, t0: float, ok: bool, status: int = 0, err: str | None = None) -> None:
                rows.append(
                    {
                        "user": uid,
                        "step": step,
                        "ms": (time.perf_counter() - t0) * 1000,
                        "ok": ok,
                        "status": status,
                        "error": err,
                    }
                )

            path = Path(audio)
            t0 = time.perf_counter()
            try:
                data = path.read_bytes()
                up = await client.post(
                    f"{api}/upload",
                    files={"file": (path.name, data, "application/octet-stream")},
                )
                add("upload_file", t0, up.status_code == 200, up.status_code)
                if up.status_code != 200:
                    return
                file_id = up.json()["file_id"]
            except Exception as exc:
                add("upload_file", t0, False, err=str(exc))
                return

            t0 = time.perf_counter()
            r_comp = await client.post(f"{api}/transcribe/compress/{file_id}")
            add("compress", t0, r_comp.status_code == 200, r_comp.status_code)
            if r_comp.status_code != 200:
                return
            cid = r_comp.json()["file_id"]

            t0 = time.perf_counter()
            r_rev = await client.post(f"{api}/transcribe/start/{cid}")
            add("rev_submit", t0, r_rev.status_code in (200, 201), r_rev.status_code)
            if r_rev.status_code not in (200, 201):
                return
            job_id = r_rev.json()["job_id"]

            t_poll = time.perf_counter()
            while True:
                await asyncio.sleep(3)
                st = await client.get(f"{api}/transcribe/status/{job_id}")
                if st.status_code != 200:
                    add("rev_poll", t_poll, False, st.status_code, st.text[:200])
                    return
                status = st.json().get("status", "")
                if status in ("transcribed", "completed"):
                    break
                if status == "failed":
                    add("rev_poll", t_poll, False, err="rev_failed")
                    return
            add("rev_poll_total", t_poll, True, 200)

            t0 = time.perf_counter()
            tr = await client.get(f"{api}/transcribe/result/{job_id}")
            add("transcript_fetch", t0, tr.status_code == 200, tr.status_code)
            if tr.status_code != 200:
                return

            t0 = time.perf_counter()
            cs = await client.post(
                f"{api}/generate/cutsheet",
                json={
                    "transcript_job_id": job_id,
                    "provider": "anthropic",
                    "model": model,
                },
            )
            add("cutsheet_llm", t0, cs.status_code == 200, cs.status_code)
            if cs.status_code != 200:
                return
            cs_id = cs.json().get("cutsheet_id")
            if not cs_id:
                return

            t0 = time.perf_counter()
            ex = await client.post(
                f"{api}/generate/export-xml/{cs_id}",
                json={"sequence_name": "E2E", "timebase": 25, "width": 1920, "height": 1080},
            )
            add("export_xml", t0, ex.status_code == 200, ex.status_code)

    for u in range(max(1, users)):
        await one_user(u)

    return rows


def summarize(rows: list[dict]) -> None:
    by_step: dict[str, list[float]] = {}
    for r in rows:
        if r.get("ok") and "ms" in r:
            by_step.setdefault(r["step"], []).append(float(r["ms"]))
    print("\n--- Summary (ms, successful requests only) ---")
    for step, vals in sorted(by_step.items()):
        print_percentiles(step, vals)

    failed = [r for r in rows if r.get("ok") is False]
    if failed:
        print(f"\n--- Failures: {len(failed)} ---")
        for r in failed[:20]:
            print(f"  user={r.get('user')} step={r.get('step')} err={r.get('error', r.get('status'))}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", default=os.getenv("LOADTEST_BASE_URL", "http://127.0.0.1:8000"))
    p.add_argument("--users", type=int, default=25)
    p.add_argument("--mode", choices=("smoke", "xml_only", "e2e"), default="smoke")
    p.add_argument(
        "--data-dir",
        default=os.getenv("DATA_DIR", str(Path(__file__).resolve().parent.parent)),
        help="Backend DATA_DIR (for xml_only fixture cutsheet path)",
    )
    args = p.parse_args()

    e2e_users = int(os.getenv("E2E_USERS", "1"))

    print(f"Base URL: {args.base_url}")
    print(f"Mode: {args.mode}  users: {args.users if args.mode != 'e2e' else e2e_users}")

    if args.mode == "smoke":
        rows = asyncio.run(run_smoke(args.base_url, args.users))
    elif args.mode == "xml_only":
        rows = asyncio.run(run_xml_only(args.base_url, args.users, Path(args.data_dir)))
    else:
        rows = asyncio.run(run_e2e(args.base_url, e2e_users))

    summarize(rows)

    out = Path(__file__).parent / "load_test_last_results.json"
    out.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(f"\nWrote raw rows to {out}")


if __name__ == "__main__":
    main()
