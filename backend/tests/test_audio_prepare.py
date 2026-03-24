import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.services import audio


class TestPrepareAudioForTranscription(unittest.IsolatedAsyncioTestCase):
    async def test_skips_compression_when_under_threshold(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "src.mp3"
            dst_dir = Path(tmp) / "compressed"
            dst_dir.mkdir(parents=True, exist_ok=True)
            src.write_bytes(b"a" * 1024)

            with patch.object(audio, "_find_file", return_value=src), patch.object(
                audio, "COMPRESSED_DIR", dst_dir
            ), patch.object(audio, "COMPRESS_AUDIO_THRESHOLD_BYTES", 10_000), patch.object(
                audio, "COMPRESS_AUDIO_ABOVE_MB", 0.01
            ):
                result = await audio.prepare_audio_for_transcription("file123")

            self.assertTrue(result["compression_skipped"])
            self.assertEqual(result["original_size"], 1024)
            self.assertEqual(result["compressed_size"], 1024)
            self.assertEqual(result["compression_ratio"], 1.0)
            copied = list(dst_dir.iterdir())
            self.assertEqual(len(copied), 1)
            self.assertEqual(copied[0].read_bytes(), src.read_bytes())

    async def test_compresses_when_over_threshold(self):
        with patch.object(audio, "_find_file", return_value=Path("dummy.wav")), patch.object(
            audio, "COMPRESS_AUDIO_THRESHOLD_BYTES", 100
        ), patch("pathlib.Path.stat") as stat_mock:
            stat_mock.return_value.st_size = 101
            with patch.object(
                audio,
                "compress_audio",
                AsyncMock(return_value={"compression_skipped": False, "file_id": "abc"}),
            ) as compress_mock:
                result = await audio.prepare_audio_for_transcription("file999")
                compress_mock.assert_awaited_once_with("file999")
                self.assertFalse(result["compression_skipped"])


if __name__ == "__main__":
    unittest.main()
