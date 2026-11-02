import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from whisper_server import _clean_word_tokens, generate_ass


def token(text, start, end, p=0.9):
    return {"text": text, "offsets": {"from": start, "to": end}, "p": p}


class WordTimestampTests(unittest.TestCase):
    def test_merges_subwords_and_possessives(self):
        words = _clean_word_tokens([
            token("[_BEG_]", 0, 0), token(" Pri", 80, 340), token("y", 340, 450),
            token("anka", 450, 900), token("'s", 1100, 1120),
            token(" presentation", 1140, 2490), token(".", 2490, 2490),
        ])
        self.assertEqual([word["word"] for word in words], ["Priyanka's", "presentation."])
        self.assertEqual((words[0]["start"], words[0]["end"]), (0.08, 1.12))
        self.assertEqual((words[1]["start"], words[1]["end"]), (1.14, 2.49))

    def test_spaces_and_multiple_words_in_token(self):
        words = _clean_word_tokens([token(" hello world", 0, 100), token(" again", 100, 200)])
        self.assertEqual([word["word"] for word in words], ["hello", "world", "again"])

    def test_unusable_timing_is_marked_and_not_used_for_karaoke(self):
        words = _clean_word_tokens([token(" hello", 200, 200), token(" world", 200, 300)])
        self.assertTrue(words[0]["timing_unreliable"])
        self.assertFalse(words[1].get("timing_unreliable", False))
        self.assertEqual(generate_ass({"segments": [{"words": words}]}), "")

    def test_utf8_fragments_are_reassembled_across_tokens(self):
        encoded = "हिंदी".encode("utf-8")
        pieces = [b" " + encoded[:2], encoded[2:5], encoded[5:8], encoded[8:]]
        tokens = [token(part.decode("utf-8", "surrogateescape"), i * 100, (i + 1) * 100) for i, part in enumerate(pieces)]
        words = _clean_word_tokens(tokens)
        self.assertEqual([word["word"] for word in words], ["हिंदी"])
        self.assertEqual((words[0]["start"], words[0]["end"]), (0, 0.4))

    def test_whitespace_continuations_and_unicode(self):
        words = _clean_word_tokens([token(" प्रि", 100, 200), token("य", 200, 300), token("ंका", 300, 400), token(" का", 500, 600)])
        self.assertEqual([word["word"] for word in words], ["प्रियंका", "का"])


if __name__ == "__main__": unittest.main()
