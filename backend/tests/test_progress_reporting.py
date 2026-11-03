import os
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import whisper_server as module


class ProgressReportingTests(unittest.TestCase):
    def test_parse_cli_progress_without_accepting_unrelated_percentages(self):
        self.assertEqual(module.parse_whisper_progress('whisper_print_progress_callback: progress =  42%'), 42)
        self.assertEqual(module.parse_whisper_progress('progress = 100%'), 100)
        self.assertIsNone(module.parse_whisper_progress('loading model: 42%'))
        self.assertIsNone(module.parse_whisper_progress('progress = 101%'))

    def test_cli_progress_is_emitted_for_each_pass_without_fabricated_percent(self):
        with tempfile.TemporaryDirectory() as directory:
            cli = pathlib.Path(directory) / 'fake-whisper'
            cli.write_text('''#!/usr/bin/env python3
import json, sys
assert "-pp" in sys.argv
output = sys.argv[sys.argv.index("-of") + 1]
print("whisper_print_progress_callback: progress =  20%", file=sys.stderr, flush=True)
print("whisper_print_progress_callback: progress =  75%", file=sys.stderr, flush=True)
with open(output + ".json", "w") as f: json.dump({"transcription": []}, f)
''')
            os.chmod(cli, 0o755)
            server = module.WhisperServer()
            events = []
            server._send_progress = events.append
            with patch.object(module, 'WHISPER_CLI', str(cli)):
                result = server._run_whisper_cli(wav_path='audio.wav', model_path='model.bin', language='en', task='translate', threads=4, word_timestamps=False, progress_message='Translating…', file_name='audio.wav')
            self.assertEqual(result['status'], 'completed')
            self.assertEqual([event['percent'] for event in events], [None, 20, 75])
            self.assertTrue(all(event['stage'] == 'translating' for event in events))
            self.assertTrue(all(event['file'] == 'audio.wav' for event in events))

if __name__ == '__main__':
    unittest.main()
