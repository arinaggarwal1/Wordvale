import io
import os
import pathlib
import ssl
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import whisper_server as module


class FakeResponse(io.BytesIO):
    def __init__(self, content, declared=None, on_read=None):
        super().__init__(content)
        self.headers = {"Content-Length": str(declared if declared is not None else len(content))}
        self.on_read = on_read

    def read(self, *args):
        value = super().read(*args)
        if self.on_read:
            self.on_read()
        return value


class ModelDownloadTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        patcher = patch.object(module, "MODELS_DIR", self.temp.name)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.server = module.WhisperServer()
        self.server._send_response = lambda response: None
        self.content = b"lmgg" + b"a" * 2048

    def run_download(self, response):
        with patch.object(module.urllib.request, "urlopen", return_value=response):
            return self.server._download_model("tiny")

    def test_success_publishes_model_only_after_complete_download(self):
        result = self.run_download(FakeResponse(self.content))
        self.assertEqual(result["status"], "downloaded")
        self.assertEqual(pathlib.Path(self.temp.name, "ggml-tiny.bin").read_bytes(), self.content)
        self.assertEqual(len(os.listdir(self.temp.name)), 1)

    def test_download_uses_bundled_roots_with_certificate_verification(self):
        # Simulate a recipient with no usable system/OpenSSL certificate paths.
        with patch.dict(os.environ, {"SSL_CERT_FILE": "/missing/cert.pem", "SSL_CERT_DIR": "/missing/certs"}):
            with patch.object(module.urllib.request, "urlopen", return_value=FakeResponse(self.content)) as request:
                result = self.server._download_model("tiny")
        self.assertEqual(result["status"], "downloaded")
        context = request.call_args.kwargs["context"]
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)
        self.assertGreater(context.cert_store_stats()["x509_ca"], 0)

    def test_truncated_and_invalid_files_are_not_installed(self):
        for response in [FakeResponse(self.content, declared=len(self.content) + 1), FakeResponse(b"html" + b"x" * 2048)]:
            with self.subTest(response=response):
                self.assertEqual(self.run_download(response)["status"], "error")
                self.assertEqual(os.listdir(self.temp.name), [])

    def test_cancel_discards_partial_file(self):
        response = FakeResponse(self.content, on_read=self.server._download_cancel.set)
        self.assertEqual(self.run_download(response)["status"], "cancelled")
        self.assertEqual(os.listdir(self.temp.name), [])

    def test_unknown_model_is_rejected(self):
        self.assertEqual(self.server._download_model("../unknown")["status"], "error")


if __name__ == "__main__":
    unittest.main()
