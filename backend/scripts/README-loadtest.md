# Load test: `load_test_pipeline.py`

Measures per-request latency for many virtual users against your API (local or deployed).

## Quick start (no LLM / no Rev beyond what smoke touches)

From the `backend` folder with the server running:

```bash
python scripts/load_test_pipeline.py --base-url http://127.0.0.1:8000 --users 25 --mode smoke
```

- **smoke** — `GET /health`, `GET /generate/models`, small upload, `POST /transcribe/import`, `POST /upload/premiere-xml`. Safe for 25+ parallel clients.
- **xml_only** — Writes `cutsheets/loadtest_fixture_cutsheet.json` under `--data-dir` (must match the server’s `DATA_DIR` if you test a remote box), then runs N concurrent `POST /generate/export-xml/loadtest_fixture_cutsheet`.
- **e2e** — Full path: upload → compress → Rev poll → cut sheet (Anthropic, costs $) → XML. Requires `TEST_AUDIO`, valid `REV_AI_TOKEN`, `ANTHROPIC_API_KEY`, and time.

## Environment variables

| Variable | Used in |
|----------|---------|
| `LOADTEST_BASE_URL` | Default `--base-url` |
| `DATA_DIR` | Default `--data-dir` (xml_only fixture path) |
| `TEST_AUDIO` | e2e: path to an audio file on this machine |
| `E2E_USERS` | e2e: number of sequential full runs (default `1`) |
| `E2E_MODEL` | e2e: Anthropic model id (default `claude-haiku-4-5`) |

## Output

- Console: p50/p95/min/max per step (successful requests only).
- `scripts/load_test_last_results.json`: raw rows (`user`, `step`, `ms`, `ok`, `status`).

## Remote `xml_only`

If the API runs on Render with `DATA_DIR=/data`, you cannot write the fixture from your laptop. Either:

- Run `xml_only` on a shell that shares that disk, or  
- Use **smoke** only against production, or  
- Deploy a one-off job that creates the fixture file.

## Example: local xml_only

```bash
python scripts/load_test_pipeline.py --mode xml_only --users 20 --data-dir .
```

(Assumes server uses the same backend directory as `DATA_DIR`.)
