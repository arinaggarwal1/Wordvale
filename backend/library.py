"""Local library metadata and transcripts, with optional managed recording copies."""
import json
import os
import shutil
import sqlite3
import tempfile
import time
import uuid
from pathlib import Path


class Library:
    def __init__(self, root):
        self.root = Path(root) / "library"
        self.audio_dir = self.root / "audio"
        self.root.mkdir(parents=True, exist_ok=True)
        self.audio_dir.mkdir(exist_ok=True)
        self.db = self.root / "library.sqlite3"
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS items (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at REAL NOT NULL,
                updated_at REAL NOT NULL, audio_path TEXT, audio_mode TEXT,
                audio_name TEXT, transcript TEXT
            )""")
            db.execute("PRAGMA user_version = 1")

    def connect(self):
        db = sqlite3.connect(self.db, timeout=30)
        db.row_factory = sqlite3.Row
        return db

    def _item(self, row):
        if row is None:
            raise ValueError("Library item not found.")
        item = dict(row)
        item["transcript"] = json.loads(item["transcript"]) if item["transcript"] else None
        item["audio_available"] = bool(item["audio_path"] and Path(item["audio_path"]).is_file())
        return item

    def get(self, item_id):
        with self.connect() as db:
            return self._item(db.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone())

    def list(self):
        with self.connect() as db:
            return [self._item(row) for row in db.execute("SELECT * FROM items ORDER BY updated_at DESC")]

    def _prepare_audio(self, path, mode):
        if mode not in ("link", "copy"):
            raise ValueError("Choose whether to link or copy the recording.")
        source = Path(path).expanduser().resolve(strict=True)
        if not source.is_file():
            raise ValueError("The recording is not a file.")
        if mode == "link":
            return str(source), source.name
        ext = source.suffix.lower()
        if len(ext) > 12 or not ext[1:].isalnum():
            ext = ""
        target = self.audio_dir / (uuid.uuid4().hex + ext)
        fd, temporary = tempfile.mkstemp(prefix=".copy-", dir=self.audio_dir)
        os.close(fd)
        try:
            shutil.copyfile(source, temporary)
            os.replace(temporary, target)
        except Exception:
            Path(temporary).unlink(missing_ok=True)
            raise
        return str(target), source.name

    def _remove_copy(self, path, mode):
        if mode == "copy" and path:
            candidate = Path(path)
            if candidate.parent.resolve() == self.audio_dir.resolve() and candidate.is_file():
                candidate.unlink()

    def create(self, name, audio_path=None, audio_mode=None, transcript=None):
        name = str(name or "").strip()
        if not name: raise ValueError("Enter a name for this library item.")
        if not audio_path and not transcript: raise ValueError("Choose a recording, transcript, or both.")
        if transcript is not None and not isinstance(transcript, dict): raise ValueError("Invalid transcript.")
        item_id = uuid.uuid4().hex
        prepared = None
        if audio_path:
            prepared = self._prepare_audio(audio_path, audio_mode)
        now = time.time()
        try:
            with self.connect() as db:
                db.execute("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (item_id, name, now, now, prepared[0] if prepared else None, audio_mode if prepared else None, prepared[1] if prepared else None, json.dumps(transcript, ensure_ascii=False) if transcript else None))
        except Exception:
            if prepared: self._remove_copy(prepared[0], audio_mode)
            raise
        return self.get(item_id)

    def rename(self, item_id, name):
        name = str(name or "").strip()
        if not name: raise ValueError("Enter a name for this library item.")
        with self.connect() as db:
            if not db.execute("UPDATE items SET name = ?, updated_at = ? WHERE id = ?", (name, time.time(), item_id)).rowcount: raise ValueError("Library item not found.")
        return self.get(item_id)

    def set_transcript(self, item_id, transcript):
        if transcript is not None and not isinstance(transcript, dict): raise ValueError("Invalid transcript.")
        with self.connect() as db:
            if not db.execute("UPDATE items SET transcript = ?, updated_at = ? WHERE id = ?", (json.dumps(transcript, ensure_ascii=False) if transcript else None, time.time(), item_id)).rowcount: raise ValueError("Library item not found.")
        return self.get(item_id)

    def set_audio(self, item_id, path=None, mode=None):
        old = self.get(item_id)
        prepared = self._prepare_audio(path, mode) if path else None
        try:
            with self.connect() as db:
                if not db.execute("UPDATE items SET audio_path = ?, audio_mode = ?, audio_name = ?, updated_at = ? WHERE id = ?", (prepared[0] if prepared else None, mode if prepared else None, prepared[1] if prepared else None, time.time(), item_id)).rowcount: raise ValueError("Library item not found.")
        except Exception:
            if prepared: self._remove_copy(prepared[0], mode)
            raise
        if not prepared or not old["audio_path"] or Path(old["audio_path"]).resolve() != Path(prepared[0]).resolve():
            self._remove_copy(old["audio_path"], old["audio_mode"])
        return self.get(item_id)

    def delete(self, item_id):
        item = self.get(item_id)
        with self.connect() as db:
            db.execute("DELETE FROM items WHERE id = ?", (item_id,))
        self._remove_copy(item["audio_path"], item["audio_mode"])
