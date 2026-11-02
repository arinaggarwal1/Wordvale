"""
whisper_server.py
JSON IPC server for Wordvale backend.
Reads JSON commands from stdin and writes JSON responses to stdout.

Uses whisper.cpp's whisper-cli binary for transcription.
Audio files are first converted to 16-bit WAV via ffmpeg,
then fed to whisper-cli which runs with Metal GPU acceleration.

Commands:
  - get_system_info: Return system hardware info (Metal/CPU)
  - get_model_info: Return metadata for a specified model
  - get_all_models: Return list of all available models
  - load_model: Store model name for next transcription
  - download_model: Download a GGML model if not present
  - transcribe_file: Run whisper-cli on an audio file
  - cancel_transcription: Cancel active transcription
  - shutdown: Gracefully stop the server
"""

import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.request
from typing import Any, Dict, List, Optional

import imageio_ffmpeg

from model_registry import get_all_models, get_model_info, get_model_names, MODEL_REGISTRY

# Shared user data directory
APP_SUPPORT_DIR = os.path.expanduser("~/Library/Application Support/Wordvale")
MODELS_DIR = os.path.join(APP_SUPPORT_DIR, "models")

# Paths
if getattr(sys, 'frozen', False):
    # Running as compiled PyInstaller binary (Tauri sidecar)
    BUNDLE_DIR = os.path.dirname(sys.executable)
    # Resources: ../Resources/ (Tauri uses _up_ prefix for parent-relative resources)
    RESOURCES_DIR = os.path.join(BUNDLE_DIR, "..", "Resources")

    # Try Tauri's bundle path first (_up_/backend/bundle_resources/),
    # then fallback to direct path
    _candidates = [
        os.path.join(RESOURCES_DIR, "_up_", "backend", "bundle_resources", "whisper-cli"),
        os.path.join(RESOURCES_DIR, "backend", "bundle_resources", "whisper-cli"),
        os.path.join(BUNDLE_DIR, "whisper-cli"),
    ]
    WHISPER_CLI = next((p for p in _candidates if os.path.exists(p)), _candidates[0])

    # Metal shader — same search pattern
    _metal_candidates = [
        os.path.join(RESOURCES_DIR, "_up_", "backend", "bundle_resources", "ggml-metal.metal"),
        os.path.join(RESOURCES_DIR, "backend", "bundle_resources", "ggml-metal.metal"),
    ]
    METAL_SHADER = next((p for p in _metal_candidates if os.path.exists(p)), _metal_candidates[0])

else:
    # Running as script
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
    _dev_candidates = [
        os.path.join(SCRIPT_DIR, "runtime", "macos-arm64", "whisper-cli"),
        os.path.join(SCRIPT_DIR, "bundle_resources", "whisper-cli"),
        os.path.join(SCRIPT_DIR, "whisper.cpp", "build", "bin", "whisper-cli"),
    ]
    WHISPER_CLI = next((p for p in _dev_candidates if os.path.exists(p)), _dev_candidates[0])

# Ensure models directory exists
os.makedirs(MODELS_DIR, exist_ok=True)

ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,0,0,1,2,0,2,10,10,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

SPECIAL_TOKEN_RE = re.compile(r"^\[(?:_?[A-Z]+(?:_[A-Z]+)?_?(?:\d+)?)\]$")
PUNCT_ONLY_RE = re.compile(r"^[.,!?;:]+$")
SENTENCE_END_RE = re.compile(r"[.?!]+[\"')\]]*$")


def _is_special_token(token_text: str) -> bool:
    text = token_text.strip()
    if not text:
        return True
    return bool(SPECIAL_TOKEN_RE.match(text))


def _clean_word_tokens(tokens: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    words: List[Dict[str, Any]] = []

    for token in tokens or []:
        token_offsets = token.get("offsets", {})
        token_start_ms = token_offsets.get("from")
        token_end_ms = token_offsets.get("to")
        token_text = str(token.get("text", "")).strip()

        if token_start_ms is None or token_end_ms is None:
            continue
        if not token_text or _is_special_token(token_text):
            continue

        token_start = token_start_ms / 1000.0
        token_end = token_end_ms / 1000.0
        probability = float(token.get("p", 0.0))

        if PUNCT_ONLY_RE.match(token_text):
            if words:
                words[-1]["word"] += token_text
                words[-1]["end"] = max(words[-1]["end"], token_end)
            continue

        if words and re.match(r"^[’'\-][A-Za-z0-9].*$", token_text):
            words[-1]["word"] += token_text
            words[-1]["end"] = max(words[-1]["end"], token_end)
            continue

        words.append({
            "word": token_text,
            "start": token_start,
            "end": token_end,
            "probability": probability,
        })

    return words


def _escape_ass_text(text: str) -> str:
    return text.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")


def to_ass_time(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    cs = int((t - int(t)) * 100)
    return f"{h}:{m:02}:{s:02}.{cs:02}"


def generate_ass(transcript: Dict[str, Any]) -> str:
    groups: List[List[Dict[str, Any]]] = []

    for segment in transcript.get("segments", []) or []:
        words = [word for word in segment.get("words", []) or [] if word.get("word")]
        if not words:
            continue

        current_group: List[Dict[str, Any]] = []

        for index, word in enumerate(words):
            current_group.append(word)
            next_word = words[index + 1] if index + 1 < len(words) else None
            pause_to_next = (
                max(0.0, float(next_word.get("start", 0.0)) - float(word.get("end", word.get("start", 0.0))))
                if next_word
                else 0.0
            )

            if (
                next_word is None
                or SENTENCE_END_RE.search(str(word.get("word", "")))
                or pause_to_next > 0.4
            ):
                groups.append(current_group)
                current_group = []

    dialogue_lines: List[str] = []

    for group in groups:
        if not group:
            continue

        start = float(group[0].get("start", 0.0))
        end = max(float(group[-1].get("end", start)), start + 0.05)
        karaoke_parts: List[str] = []

        for index, word in enumerate(group):
            current_start = float(word.get("start", 0.0))
            current_end = float(word.get("end", current_start))

            if index + 1 < len(group):
                next_start = float(group[index + 1].get("start", current_end))
                duration = next_start - current_start
            else:
                duration = current_end - current_start

            if duration <= 0:
                duration = max(current_end - current_start, 0.05)

            k_value = max(5, min(200, int(round(duration * 100))))
            karaoke_parts.append(r"{\k" + str(k_value) + "}" + _escape_ass_text(str(word.get("word", "")).strip()))

        karaoke_text = " ".join(part for part in karaoke_parts if part)
        if not karaoke_text:
            continue

        dialogue_lines.append(
            f"Dialogue: 0,{to_ass_time(start)},{to_ass_time(end)},Default,,0,0,0,,{karaoke_text}"
        )

    if not dialogue_lines:
        return ASS_HEADER

    return ASS_HEADER + "\n".join(dialogue_lines) + "\n"



class WhisperServer:
    """JSON IPC server communicating over stdin/stdout."""

    def __init__(self):
        self._current_model: Optional[str] = None
        self._running = True
        self._output_lock = threading.Lock()
        self._active_process: Optional[subprocess.Popen] = None
        self._cancel_event = threading.Event()
        self._ffmpeg_path = self._resolve_ffmpeg_path()

    def _send_response(self, response: Dict[str, Any]) -> None:
        """Send a JSON response line to stdout."""
        with self._output_lock:
            line = json.dumps(response, ensure_ascii=False)
            sys.stdout.write(line + "\n")
            sys.stdout.flush()

    def _send_progress(self, data: Dict[str, Any]) -> None:
        """Send a progress update to the frontend."""
        self._send_response({"type": "progress", "data": data})

    def _detect_device(self) -> str:
        """Detect if Metal is available (Apple Silicon)."""
        if platform.system() == "Darwin" and platform.machine() == "arm64":
            return "metal"
        return "cpu"

    def _get_model_path(self, model_name: str) -> str:
        """Get the full path to a GGML model file."""
        info = MODEL_REGISTRY.get(model_name, {})
        filename = info.get("ggml_filename", f"ggml-{model_name}.bin")
        return os.path.join(MODELS_DIR, filename)

    def _get_downloaded_models_info(self) -> List[Dict[str, Any]]:
        """Return detailed info for downloaded models."""
        downloaded: List[Dict[str, Any]] = []

        for name, metadata in MODEL_REGISTRY.items():
            path = self._get_model_path(name)
            if not os.path.exists(path):
                continue

            size_bytes = os.path.getsize(path)
            downloaded.append({
                "name": name,
                "display_name": metadata.get("display_name", name),
                "path": path,
                "size_bytes": size_bytes,
                "size_mb": round(size_bytes / (1024 * 1024), 2),
                "recommended_use_case": metadata.get("recommended_use_case", ""),
            })

        downloaded.sort(key=lambda item: item["display_name"].lower())
        return downloaded

    def _is_model_downloaded(self, model_name: str) -> bool:
        """Check if a model file exists on disk."""
        return os.path.exists(self._get_model_path(model_name))

    def _download_model(self, model_name: str) -> Dict[str, Any]:
        """Download a GGML model from Hugging Face."""
        if self._is_model_downloaded(model_name):
            return {"status": "already_exists", "model": model_name}

        target_path = self._get_model_path(model_name)
        url = f"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model_name}.bin"
        
        self._send_progress({
            "type": "progress",
            "stage": "downloading_model",
            "percent": 0,
            "message": f"Downloading model {model_name}...",
        })

        try:
            def report_progress(count, block_size, total_size):
                percent = int(count * block_size * 100 / total_size)
                # Throttle updates to avoid flooding
                if percent % 5 == 0:
                     self._send_progress({
                        "type": "progress",
                        "stage": "downloading_model",
                        "percent": percent,
                        "message": f"Downloading {model_name} ({percent}%)...",
                    })

            urllib.request.urlretrieve(url, target_path, reporthook=report_progress)

            if self._is_model_downloaded(model_name):
                return {"status": "downloaded", "model": model_name, "path": target_path}
            else:
                return {"status": "error", "error": "Download completed but file missing"}

        except Exception as e:
            if os.path.exists(target_path):
                os.unlink(target_path)
            return {"status": "error", "error": str(e)}

    def _get_system_info(self) -> Dict[str, Any]:
        """Return system hardware information."""
        device = self._detect_device()
        info: Dict[str, Any] = {
            "device": device,
            "gpu_available": device == "metal",
            "gpu_name": "Apple Silicon (Metal)" if device == "metal" else None,
            "gpu_vram_total_gb": 0,
            "force_cpu": False,
            "current_model": self._current_model,
            "model_loaded": self._current_model is not None,
            "whisper_cli_available": os.path.exists(WHISPER_CLI),
            "ffmpeg_available": self._ffmpeg_path is not None,
            "ffmpeg_path": self._ffmpeg_path,
        }

        try:
            import psutil
            info["cpu_count"] = psutil.cpu_count(logical=True)
            info["ram_total_gb"] = round(psutil.virtual_memory().total / (1024**3), 2)
            info["ram_available_gb"] = round(
                psutil.virtual_memory().available / (1024**3), 2
            )
            if device == "metal":
                # Metal shares system RAM
                info["gpu_vram_total_gb"] = info["ram_total_gb"]
        except ImportError:
            info["cpu_count"] = os.cpu_count() or 1
            info["ram_total_gb"] = 0
            info["ram_available_gb"] = 0

        # List downloaded models
        downloaded_models_info = self._get_downloaded_models_info()
        info["downloaded_models"] = [item["name"] for item in downloaded_models_info]
        info["downloaded_models_info"] = downloaded_models_info
        info["models_dir"] = MODELS_DIR

        return info

    def _get_model_storage(self) -> Dict[str, Any]:
        """Return model storage summary for the frontend model manager."""
        downloaded_models = self._get_downloaded_models_info()
        total_size_bytes = sum(item["size_bytes"] for item in downloaded_models)
        return {
            "models_dir": MODELS_DIR,
            "downloaded_models": downloaded_models,
            "downloaded_count": len(downloaded_models),
            "total_size_bytes": total_size_bytes,
            "total_size_mb": round(total_size_bytes / (1024 * 1024), 2),
            "active_model": self._current_model,
        }

    def _delete_model(self, model_name: str) -> Dict[str, Any]:
        """Delete a downloaded model file."""
        if model_name not in MODEL_REGISTRY:
            return {"status": "error", "error": f"Unknown model: {model_name}"}

        if self._active_process is not None:
            return {"status": "error", "error": "Cannot delete models while transcription is in progress."}

        path = self._get_model_path(model_name)
        if not os.path.exists(path):
            return {"status": "not_found", "model": model_name}

        try:
            os.unlink(path)
            if self._current_model == model_name:
                self._current_model = None
            return {"status": "deleted", "model": model_name}
        except Exception as exc:
            return {"status": "error", "error": str(exc), "model": model_name}

    def _delete_all_models(self) -> Dict[str, Any]:
        """Delete all downloaded models from disk."""
        if self._active_process is not None:
            return {"status": "error", "error": "Cannot delete models while transcription is in progress."}

        deleted: List[str] = []
        errors: List[Dict[str, str]] = []

        for model_name in get_model_names():
            path = self._get_model_path(model_name)
            if not os.path.exists(path):
                continue

            try:
                os.unlink(path)
                deleted.append(model_name)
            except Exception as exc:
                errors.append({"model": model_name, "error": str(exc)})

        if self._current_model in deleted:
            self._current_model = None

        return {
            "status": "deleted_all" if not errors else "partial",
            "deleted_models": deleted,
            "errors": errors,
        }

    def _resolve_ffmpeg_path(self) -> Optional[str]:
        """Find ffmpeg even when the app is launched outside a shell PATH."""
        env_candidate = os.environ.get("FFMPEG_PATH")
        candidates: List[str] = []

        if env_candidate:
            candidates.append(env_candidate)

        try:
            packaged_candidate = imageio_ffmpeg.get_ffmpeg_exe()
            if packaged_candidate:
                candidates.append(packaged_candidate)
        except Exception:
            packaged_candidate = None

        which_candidate = shutil.which("ffmpeg")
        if which_candidate:
            candidates.append(which_candidate)

        candidates.extend([
            "/opt/homebrew/bin/ffmpeg",
            "/usr/local/bin/ffmpeg",
            "/usr/bin/ffmpeg",
        ])

        if getattr(sys, "frozen", False):
            candidates.extend([
                os.path.join(BUNDLE_DIR, "ffmpeg"),
                os.path.join(RESOURCES_DIR, "_up_", "backend", "bundle_resources", "ffmpeg"),
                os.path.join(RESOURCES_DIR, "backend", "bundle_resources", "ffmpeg"),
            ])

        seen = set()
        for candidate in candidates:
            if not candidate or candidate in seen:
                continue
            seen.add(candidate)
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate

        return None

    def _convert_to_wav(self, input_path: str) -> str:
        """Convert any audio file to 16-bit WAV using ffmpeg."""
        if not self._ffmpeg_path:
            raise RuntimeError(
                "ffmpeg not found. Install ffmpeg with Homebrew (`brew install ffmpeg`) "
                "or set FFMPEG_PATH to the full ffmpeg binary path."
            )

        wav_path = tempfile.mktemp(suffix=".wav")
        cmd = [
            self._ffmpeg_path, "-y",
            "-i", input_path,
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            wav_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg conversion failed: {result.stderr.strip()}")
        return wav_path

    def _run_whisper_cli(
        self,
        *,
        wav_path: str,
        model_path: str,
        language: Optional[str],
        task: str,
        threads: int,
        word_timestamps: bool,
        progress_percent: int,
        progress_message: str,
        file_name: str,
    ) -> Dict[str, Any]:
        """Run whisper-cli once and return its raw JSON output."""
        output_base = tempfile.mktemp()

        cmd = [
            WHISPER_CLI,
            "-m", model_path,
            "-f", wav_path,
            "-t", str(threads),
            "-ojf" if word_timestamps else "-oj",
            "-of", output_base,
        ]

        if word_timestamps:
            cmd.extend(["-ml", "1"])

        if language and language != "auto" and language != "None":
            cmd.extend(["-l", language])
        else:
            cmd.extend(["-l", "auto"])

        if task == "translate":
            cmd.append("-tr")

        self._send_progress({
            "type": "progress",
            "stage": "transcribing" if task == "transcribe" else "translating",
            "file": file_name,
            "percent": progress_percent,
            "message": progress_message,
        })

        try:
            self._active_process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )

            stderr_buffer = []
            stdout_buffer = []

            def read_stream(stream, buffer, prefix):
                try:
                    for line in iter(stream.readline, ''):
                        if not line:
                            break
                        stripped = line.strip()
                        if stripped:
                            buffer.append(stripped)
                            sys.stderr.write(f"[{prefix}] {stripped}\n")
                            sys.stderr.flush()
                except Exception:
                    pass

            stderr_thread = threading.Thread(
                target=read_stream,
                args=(self._active_process.stderr, stderr_buffer, "whisper-cli"),
            )
            stderr_thread.daemon = True
            stderr_thread.start()

            stdout_thread = threading.Thread(
                target=read_stream,
                args=(self._active_process.stdout, stdout_buffer, "whisper-cli-out"),
            )
            stdout_thread.daemon = True
            stdout_thread.start()

            while self._active_process.poll() is None:
                if self._cancel_event.is_set():
                    self._active_process.terminate()
                    try:
                        self._active_process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        self._active_process.kill()
                    return {"status": "cancelled"}
                time.sleep(0.5)

            stderr_thread.join(timeout=1.0)
            stdout_thread.join(timeout=1.0)

            returncode = self._active_process.returncode
            stderr_output = "\n".join(stderr_buffer)
            self._active_process = None

            if returncode != 0:
                return {
                    "status": "error",
                    "error": f"whisper-cli failed (exit code {returncode}): {stderr_output[-1000:]}",
                }

            json_output_path = output_base + ".json"
            if not os.path.exists(json_output_path):
                return {"status": "error", "error": "No JSON output file generated by whisper-cli"}

            with open(json_output_path, "r") as f:
                return {"status": "completed", "raw_output": json.load(f)}
        finally:
            json_output_path = output_base + ".json"
            try:
                if os.path.exists(json_output_path):
                    os.unlink(json_output_path)
            except Exception:
                pass

    def _transcribe_file(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Transcribe an audio file using whisper-cli.
        1. Convert audio to 16-bit WAV via ffmpeg
        2. Run whisper-cli with --output-json-full
        3. Parse JSON output
        """
        file_path = params.get("file_path", "")
        language = params.get("language", None)
        task = params.get("task", "transcribe")
        threads = params.get("threads", max(1, (os.cpu_count() or 4) // 2))
        word_timestamps = bool(params.get("word_timestamps", False))

        # Model name — use stored model or default
        model_name = self._current_model or "base.en"

        # Validate file exists
        if not os.path.exists(file_path):
            return {"status": "error", "error": f"File not found: {file_path}"}

        # Validate whisper-cli exists
        if not os.path.exists(WHISPER_CLI):
            return {"status": "error", "error": "whisper-cli not found. whisper.cpp may not be built."}

        # Check if model is downloaded, auto-download if not
        if not self._is_model_downloaded(model_name):
            self._send_progress({
                "type": "progress",
                "stage": "downloading_model",
                "percent": 5,
                "message": f"Model {model_name} not found, downloading...",
            })
            dl_result = self._download_model(model_name)
            if dl_result.get("status") == "error":
                return dl_result

        model_path = self._get_model_path(model_name)
        self._cancel_event.clear()
        start_time = time.time()
        wav_path = None

        try:
            # Step 1: Convert to WAV
            self._send_progress({
                "type": "progress",
                "stage": "converting_audio",
                "file": os.path.basename(file_path),
                "percent": 10,
                "message": "Converting audio to WAV format...",
            })
            wav_path = self._convert_to_wav(file_path)

            if self._cancel_event.is_set():
                return {"status": "cancelled"}

            file_name = os.path.basename(file_path)
            original_run = self._run_whisper_cli(
                wav_path=wav_path,
                model_path=model_path,
                language=language,
                task="transcribe",
                threads=threads,
                word_timestamps=word_timestamps,
                progress_percent=20,
                progress_message=f"Transcribing original audio with {model_name} on {self._detect_device().upper()}...",
                file_name=file_name,
            )
            if original_run.get("status") != "completed":
                return original_run

            original_result = self._parse_output(original_run["raw_output"], 0, file_path)
            elapsed = time.time() - start_time

            if task == "translate":
                translated_run = self._run_whisper_cli(
                    wav_path=wav_path,
                    model_path=model_path,
                    language=language,
                    task="translate",
                    threads=threads,
                    word_timestamps=word_timestamps,
                    progress_percent=65,
                    progress_message="Translating transcript to English...",
                    file_name=file_name,
                )
                if translated_run.get("status") != "completed":
                    return translated_run

                translated_result = self._parse_output(translated_run["raw_output"], 0, file_path)
                result = {
                    "text": translated_result["text"],
                    "srt": translated_result["srt"],
                    "ass": translated_result["ass"],
                    "segments": translated_result["segments"],
                    "language": translated_result["language"],
                    "duration_seconds": round(elapsed, 2),
                    "file": os.path.basename(file_path),
                    "file_path": file_path,
                    "task": "translate",
                    "original": {
                        "text": original_result["text"],
                        "srt": original_result["srt"],
                        "ass": original_result["ass"],
                        "segments": original_result["segments"],
                        "language": original_result["language"],
                    },
                    "english": {
                        "text": translated_result["text"],
                        "srt": translated_result["srt"],
                        "ass": translated_result["ass"],
                        "segments": translated_result["segments"],
                        "language": translated_result["language"],
                    },
                }
            else:
                result = {
                    **original_result,
                    "duration_seconds": round(elapsed, 2),
                    "task": "transcribe",
                }

            self._send_progress({
                "type": "progress",
                "stage": "complete",
                "percent": 100,
                "message": f"Transcription complete! ({elapsed:.1f}s)",
            })

            result["status"] = "completed"
            return result

        except Exception as e:
            return {
                "status": "error",
                "error": str(e),
                "traceback": traceback.format_exc(),
            }
        finally:
            # Cleanup temp files
            for path in [wav_path]:
                try:
                    if path and os.path.exists(path):
                        os.unlink(path)
                except Exception:
                    pass

    def _parse_output(
        self, raw: Any, elapsed: float, file_path: str
    ) -> Dict[str, Any]:
        """
        Parse whisper.cpp JSON output into our standard format.

        whisper.cpp -oj outputs:
        {
          "transcription": [
            {
              "timestamps": {"from": "00:00:00,000", "to": "00:00:05,000"},
              "offsets": {"from": 0, "to": 5000},
              "text": " And so my fellow Americans..."
            },
            ...
          ]
        }
        """
        transcription = raw.get("transcription", [])

        # Build segments and full text
        segments: List[Dict[str, Any]] = []
        text_parts: List[str] = []

        for i, entry in enumerate(transcription):
            offsets = entry.get("offsets", {})
            start_ms = offsets.get("from", 0)
            end_ms = offsets.get("to", 0)
            text = entry.get("text", "").strip()
            words = _clean_word_tokens(entry.get("tokens", []) or [])

            segment: Dict[str, Any] = {
                "id": i,
                "start": start_ms / 1000.0,
                "end": end_ms / 1000.0,
                "text": text,
                "speaker": "[Speaker]",
            }
            if words:
                segment["words"] = words

            segments.append(segment)
            text_parts.append(text)

        full_text = " ".join(text_parts).strip()

        # Build SRT
        srt = self._build_srt(segments)
        ass = generate_ass({"segments": segments})

        # Language detection from raw output
        language = raw.get("result", {}).get("language", "unknown")

        return {
            "text": full_text,
            "srt": srt,
            "ass": ass,
            "segments": segments,
            "language": language,
            "duration_seconds": round(elapsed, 2),
            "file": os.path.basename(file_path),
            "file_path": file_path,
        }

    def _build_srt(self, segments: list) -> str:
        """Build SRT formatted subtitle string."""
        srt_lines = []
        for i, seg in enumerate(segments, 1):
            start = self._format_timestamp_srt(seg.get("start", 0))
            end = self._format_timestamp_srt(seg.get("end", 0))
            text = seg.get("text", "").strip()
            srt_lines.append(f"{i}\n{start} --> {end}\n{text}\n")
        return "\n".join(srt_lines)

    @staticmethod
    def _format_timestamp_srt(seconds: float) -> str:
        """Format seconds to SRT timestamp (HH:MM:SS,mmm)."""
        hrs = int(seconds // 3600)
        mins = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds % 1) * 1000)
        return f"{hrs:02d}:{mins:02d}:{secs:02d},{millis:03d}"

    def _handle_command(self, command: Dict[str, Any]) -> Dict[str, Any]:
        """Route and execute a command."""
        cmd = command.get("command", "")
        params = command.get("params", {})
        request_id = command.get("id", None)

        try:
            if cmd == "get_system_info":
                result = self._get_system_info()

            elif cmd == "get_model_info":
                model_name = params.get("model", "")
                result = get_model_info(model_name)

            elif cmd == "get_all_models":
                result = {"models": get_all_models(), "names": get_model_names()}

            elif cmd == "get_model_storage":
                result = self._get_model_storage()

            elif cmd == "load_model":
                model_name = params.get("model", "base.en")
                self._current_model = model_name

                # Auto-download if needed
                if not self._is_model_downloaded(model_name):
                    dl = self._download_model(model_name)
                    if dl.get("status") == "error":
                        result = dl
                    else:
                        result = {
                            "status": "loaded",
                            "model": model_name,
                            "device": self._detect_device(),
                            "downloaded": True,
                        }
                else:
                    result = {
                        "status": "loaded",
                        "model": model_name,
                        "device": self._detect_device(),
                        "downloaded": False,
                    }

            elif cmd == "download_model":
                model_name = params.get("model", "")
                result = self._download_model(model_name)

            elif cmd == "delete_model":
                model_name = params.get("model", "")
                result = self._delete_model(model_name)

            elif cmd == "delete_all_models":
                result = self._delete_all_models()

            elif cmd == "transcribe_file":
                result = self._transcribe_file(params)

            elif cmd == "cancel_transcription":
                self._cancel_event.set()
                if self._active_process:
                    try:
                        self._active_process.terminate()
                    except Exception:
                        pass
                result = {"status": "cancelling"}

            elif cmd == "shutdown":
                self._running = False
                result = {"status": "shutting_down"}

            else:
                result = {"status": "error", "error": f"Unknown command: {cmd}"}

        except Exception as e:
            result = {
                "status": "error",
                "error": str(e),
                "traceback": traceback.format_exc(),
            }

        response: Dict[str, Any] = {"type": "response", "data": result}
        if request_id is not None:
            response["id"] = request_id
        return response

    def run(self) -> None:
        """Main server loop — read commands from stdin, write responses to stdout."""
        # Send ready signal
        self._send_response({"type": "ready", "data": {"status": "server_ready"}})

        while self._running:
            try:
                line = sys.stdin.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue

                try:
                    command = json.loads(line)
                except json.JSONDecodeError as e:
                    self._send_response({
                        "type": "error",
                        "data": {"error": f"Invalid JSON: {e}"},
                    })
                    continue

                response = self._handle_command(command)
                self._send_response(response)

            except KeyboardInterrupt:
                break
            except Exception as e:
                self._send_response({
                    "type": "error",
                    "data": {
                        "error": str(e),
                        "traceback": traceback.format_exc(),
                    },
                })


if __name__ == "__main__":
    server = WhisperServer()
    server.run()
