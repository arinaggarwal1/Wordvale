import pathlib
import sys
import tempfile
import unittest
import wave
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import whisper_server as module


class TranscriptionInfoTests(unittest.TestCase):
    def test_records_audio_duration_model_and_full_translation_time(self):
        with tempfile.TemporaryDirectory() as directory:
            audio_file = pathlib.Path(directory) / 'source.mp3'
            audio_file.touch()
            wav_file = pathlib.Path(directory) / 'converted.wav'
            with wave.open(str(wav_file), 'wb') as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(16000)
                audio.writeframes(b'\0\0' * 40000)
            server = module.WhisperServer()
            server._current_model = 'small'
            server._send_progress = lambda _data: None
            server._is_model_downloaded = lambda _model: True
            server._convert_to_wav = lambda _path: str(wav_file)
            raw = {'result': {'language': 'hi'}, 'transcription': []}
            with patch.object(module.time, 'monotonic', side_effect=[10, 17.5]), patch.object(server, '_run_whisper_cli', return_value={'status': 'completed', 'raw_output': raw}) as run:
                result = server._transcribe_file({'file_path': str(audio_file), 'language': 'hi', 'task': 'translate', 'threads': 4})
            self.assertEqual(result['status'], 'completed')
            self.assertEqual(result['model_used'], 'small')
            self.assertEqual(result['audio_duration_seconds'], 2.5)
            self.assertEqual(result['duration_seconds'], 7.5)
            self.assertEqual(run.call_count, 2)


if __name__ == '__main__':
    unittest.main()
