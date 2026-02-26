import json
import os
from typing import Optional

import httplib2
from google.oauth2 import service_account
from googleapiclient.discovery import build
from google_auth_httplib2 import AuthorizedHttp

SCOPES = [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive",
]

GOOGLE_HTTP_TIMEOUT_SECONDS = 20

def _get_credentials():
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not raw:
        raise RuntimeError("GOOGLE_SERVICE_ACCOUNT_JSON not set")

    try:
        info = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Invalid GOOGLE_SERVICE_ACCOUNT_JSON: {e}") from e

    return service_account.Credentials.from_service_account_info(info, scopes=SCOPES)


def create_google_doc_from_cutsheet(title: str, content: str) -> Optional[str]:
    """
    Create a Google Doc containing the cut sheet content and make it editable by anyone with the link.

    Returns the document URL, or None if creation fails.
    """
    creds = _get_credentials()
    http = AuthorizedHttp(creds, http=httplib2.Http(timeout=GOOGLE_HTTP_TIMEOUT_SECONDS))
    docs_service = build("docs", "v1", http=http, cache_discovery=False)
    drive_service = build("drive", "v3", http=http, cache_discovery=False)

    # 1) Create empty document
    doc = docs_service.documents().create(body={"title": title}).execute()
    doc_id = doc.get("documentId")
    if not doc_id:
        return None

    # 2) Insert content as plain text at start
    docs_service.documents().batchUpdate(
        documentId=doc_id,
        body={
            "requests": [
                {
                    "insertText": {
                        "location": {"index": 1},
                        "text": content,
                    }
                }
            ]
        },
    ).execute()

    # 3) Set permission: anyone with link can edit
    drive_service.permissions().create(
        fileId=doc_id,
        body={
            "role": "writer",
            "type": "anyone",
        },
    ).execute()

    return f"https://docs.google.com/document/d/{doc_id}/edit"

