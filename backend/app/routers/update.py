"""
Plugin auto-update router.

GET /api/plugin/version  — returns the current backend/plugin version
GET /api/plugin/update   — returns all updatable plugin file contents as JSON

How it works:
  1. The Premiere plugin checks /api/plugin/version on startup.
  2. If the version differs from what the plugin last stored in localStorage,
     it shows an "Update available" banner.
  3. The editor clicks "Update Now" — the plugin fetches /api/plugin/update,
     gets every file's content, and writes them to disk via ExtendScript.
  4. The editor reloads the panel (F5 or close/reopen) to apply the new code.

To push an update to editors: bump APP_VERSION in config.py (or set the
APP_VERSION env var on your server), then redeploy. That's it.
"""

import asyncio

import aiofiles

from fastapi import APIRouter

from ..config import APP_VERSION, REPO_ROOT

router = APIRouter(prefix="/api/plugin", tags=["update"])

# Files that the auto-updater will overwrite on editor machines.
# host.jsx and CSXS/manifest.xml are included — they are text files and safe
# to replace while the panel is running (changes apply on next panel reload).
_UPDATABLE = [
    "js/main.js",
    "js/api.js",
    "css/styles.css",
    "index.html",
    "jsx/host.jsx",
    "CSXS/manifest.xml",
]

_PLUGIN_DIR = REPO_ROOT / "premiere-plugin"


@router.get("/version")
async def plugin_version():
    """Return the current plugin version deployed on this backend."""
    return {"version": APP_VERSION}


@router.get("/update")
async def get_plugin_update():
    """
    Return all updatable plugin files as a JSON object.

    Response: { "version": "...", "files": { "js/main.js": "...", ... } }
    """
    files: dict[str, str] = {}
    for rel in _UPDATABLE:
        path = _PLUGIN_DIR.joinpath(*rel.split("/"))
        if path.exists():
            try:
                async with aiofiles.open(path, encoding="utf-8") as f:
                    files[rel] = await f.read()
            except OSError:
                pass  # Skip unreadable files silently
    return {"version": APP_VERSION, "files": files}
