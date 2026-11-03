import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from library import Library


class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.source = self.root / 'recording.wav'
        self.source.write_bytes(b'original audio')
        self.lib = Library(self.root)
        self.transcript = {'text': 'first', 'segments': [], 'srt': '', 'file': 'recording.wav', 'file_path': str(self.source), 'language': 'en', 'status': 'completed', 'duration_seconds': 1}

    def tearDown(self):
        self.temp.cleanup()

    def test_persists_link_and_replaces_transcript_without_touching_original(self):
        item = self.lib.create('Lecture', str(self.source), 'link', self.transcript)
        reopened = Library(self.root)
        self.assertEqual(reopened.get(item['id'])['transcript']['text'], 'first')
        replacement = {**self.transcript, 'text': 'new result'}
        self.assertEqual(reopened.set_transcript(item['id'], replacement)['transcript']['text'], 'new result')
        self.assertEqual(len(reopened.list()), 1)
        reopened.rename(item['id'], 'New title')
        reopened.delete(item['id'])
        self.assertEqual(self.source.read_bytes(), b'original audio')

    def test_copy_is_independent_and_removed_without_removing_original(self):
        item = self.lib.create('Copy', str(self.source), 'copy', None)
        copy = pathlib.Path(item['audio_path'])
        self.assertEqual(copy.read_bytes(), self.source.read_bytes())
        self.source.unlink()
        self.assertTrue(self.lib.get(item['id'])['audio_available'])
        self.lib.delete(item['id'])
        self.assertFalse(copy.exists())

    def test_missing_link_can_be_relinked_and_transcript_retained(self):
        item = self.lib.create('Linked', str(self.source), 'link', self.transcript)
        self.source.unlink()
        self.assertFalse(self.lib.get(item['id'])['audio_available'])
        self.assertEqual(self.lib.get(item['id'])['transcript']['text'], 'first')
        other = self.root / 'new.wav'; other.write_bytes(b'new')
        relinked = self.lib.set_audio(item['id'], str(other), 'link')
        self.assertTrue(relinked['audio_available'])
        self.assertEqual(relinked['transcript']['text'], 'first')
        self.lib.set_audio(item['id'])
        self.assertTrue(other.exists())

    def test_transcript_only_and_rejected_audio_leave_existing_data(self):
        item = self.lib.create('Text', transcript=self.transcript)
        with self.assertRaises((OSError, ValueError)):
            self.lib.set_audio(item['id'], str(self.root / 'missing.wav'), 'copy')
        self.assertEqual(self.lib.get(item['id'])['transcript']['text'], 'first')
        with self.assertRaises(ValueError): self.lib.create('Empty')
        with self.assertRaises(ValueError): self.lib.set_transcript('missing', self.transcript)

    def test_linking_to_existing_managed_copy_does_not_delete_it(self):
        item = self.lib.create('Copy', str(self.source), 'copy', None)
        managed = pathlib.Path(item['audio_path'])
        self.lib.set_audio(item['id'], str(managed), 'link')
        self.assertTrue(managed.exists())

if __name__ == '__main__': unittest.main()
