import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.routers import transcribe


class TestTranscribeRouter(unittest.IsolatedAsyncioTestCase):
    async def test_prepare_route_returns_service_response(self):
        payload = {"file_id": "abc123", "compression_skipped": True}
        with patch.object(
            transcribe, "prepare_audio_for_transcription", AsyncMock(return_value=payload)
        ):
            out = await transcribe.compress("abc123")
            self.assertEqual(out, payload)

    async def test_prepare_route_maps_file_not_found_to_404(self):
        with patch.object(
            transcribe,
            "prepare_audio_for_transcription",
            AsyncMock(side_effect=FileNotFoundError("missing")),
        ):
            with self.assertRaises(HTTPException) as ctx:
                await transcribe.compress("missing")
            self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
