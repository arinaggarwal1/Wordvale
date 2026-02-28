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
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.request
from typing import Any, Dict, List, Optional

from model_registry import get_all_models, get_model_info, get_model_names, MODEL_REGISTRY

# Paths
if getattr(sys, 'frozen', False):
    # Running as compiled PyInstaller binary
    BUNDLE_DIR = os.path.dirname(sys.executable)
    # Resources: ../Resources/
    RESOURCES_DIR = os.path.join(BUNDLE_DIR, "../Resources")
    # CLI stashed in bundle_resources
    WHISPER_CLI = os.path.join(RESOURCES_DIR, "backend", "bundle_resources", "whisper-cli")
    
    # Models: User Data Directory (Writable)
    # ~/Library/Application Support/Wordvale/models
    app_support = os.path.expanduser("~/Library/Application Support/Wordvale")
    MODELS_DIR = os.path.join(app_support, "models")
else:
    # Running as script
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
    WHISPER_CPP_DIR = os.path.join(SCRIPT_DIR, "whisper.cpp")
    WHISPER_CLI = os.path.join(WHISPER_CPP_DIR, "build", "bin", "whisper-cli")
    MODELS_DIR = os.path.join(WHISPER_CPP_DIR, "models")

# Ensure models directory exists
os.makedirs(MODELS_DIR, exist_ok=True)



class WhisperServer:
    """JSON IPC server communicating over stdin/stdout."""

    def __init__(self):
        self._current_model: Optional[str] = None
        self._running = True
        self._output_lock = threading.Lock()
        self._active_process: Optional[subprocess.Popen] = None
        self._cancel_event = threading.Event()

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
        downloaded = []
        for name in get_model_names():
            if self._is_model_downloaded(name):
                downloaded.append(name)
        info["downloaded_models"] = downloaded

        return info

    def _convert_to_wav(self, input_path: str) -> str:
        """Convert any audio file to 16-bit WAV using ffmpeg."""
        wav_path = tempfile.mktemp(suffix=".wav")
        cmd = [
            "ffmpeg", "-y",
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

            # Step 2: Prepare output path for JSON
            output_base = tempfile.mktemp()

            # Step 3: Build whisper-cli command
            cmd = [
                WHISPER_CLI,
                "-m", model_path,
                "-f", wav_path,
                "-t", str(threads),
                "-oj",                           # output JSON (full)
                "-of", output_base,              # output file base name
                # "--no-prints",                   # suppress progress to stderr (COMMENTED OUT FOR DEBUGGING)
            ]

            if language and language != "auto" and language != "None":
                cmd.extend(["-l", language])
            else:
                cmd.extend(["-l", "auto"])

            if task == "translate":
                cmd.append("-tr")                # translate to English

            self._send_progress({
                "type": "progress",
                "stage": "transcribing",
                "file": os.path.basename(file_path),
                "percent": 20,
                "message": f"Transcribing with {model_name} on {self._detect_device().upper()}...",
            })

            # Step 4: Run whisper-cli
            self._active_process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,  # Line buffered
            )

            # Helper to read stream in a separate thread
            stderr_buffer = []
            stdout_buffer = []

            def read_stream(stream, buffer, prefix):
                try:
                    for line in iter(stream.readline, ''):
                        if not line: break
                        stripped = line.strip()
                        if stripped:
                            buffer.append(stripped)
                            sys.stderr.write(f"[{prefix}] {stripped}\n")
                            sys.stderr.flush()
                except Exception:
                    pass
            
            import threading
            stderr_thread = threading.Thread(target=read_stream, args=(self._active_process.stderr, stderr_buffer, "whisper-cli"))
            stderr_thread.daemon = True
            stderr_thread.start()

            stdout_thread = threading.Thread(target=read_stream, args=(self._active_process.stdout, stdout_buffer, "whisper-cli-out"))
            stdout_thread.daemon = True
            stdout_thread.start()

            # Monitor the process
            while self._active_process.poll() is None:
                if self._cancel_event.is_set():
                    self._active_process.terminate()
                    try:
                        self._active_process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        self._active_process.kill()
                    return {"status": "cancelled"}
                time.sleep(0.5)
            
            # Allow threads to finish
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

            # Step 5: Read the JSON output file
            json_output_path = output_base + ".json"
            if not os.path.exists(json_output_path):
                return {"status": "error", "error": "No JSON output file generated by whisper-cli"}

            with open(json_output_path, "r") as f:
                raw_output = json.load(f)

            elapsed = time.time() - start_time

            # Step 6: Parse whisper.cpp JSON output
            result = self._parse_output(raw_output, elapsed, file_path)

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
            for path in [wav_path, output_base + ".json" if 'output_base' in dir() else None]:
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

            segments.append({
                "id": i,
                "start": start_ms / 1000.0,
                "end": end_ms / 1000.0,
                "text": text,
                "speaker": "[Speaker]",
            })
            text_parts.append(text)

        full_text = " ".join(text_parts).strip()

        # Build SRT
        srt = self._build_srt(segments)

        # Language detection from raw output
        language = raw.get("result", {}).get("language", "unknown")

        return {
            "text": full_text,
            "srt": srt,
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
