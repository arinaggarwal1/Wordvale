# Wordvale

Offline transcription for macOS, built with React, Tauri, and a bundled Python backend around `whisper.cpp`.

Wordvale lets you drop in audio or video files, choose a Whisper model, and run transcription locally on your own machine. It is designed for privacy-first desktop use: no cloud upload, no API key, and no usage caps.

## At a Glance

- Runs transcription fully on-device
- Supports multiple Whisper models, including multilingual and English-only variants
- Queues multiple files and processes them one at a time
- Exports transcripts as plain text, timestamped text, SRT, or JSON
- Packages the Python backend as a Tauri sidecar for distribution
- Stores downloaded models outside the app bundle so app updates stay small

## How It Works, In Normal People Terms

Think of Wordvale as a desktop app with a built-in transcription worker.

1. You drop in an audio or video file.
2. The app checks the file and puts it into a queue.
3. When you start, it loads the Whisper model you selected. If that model is not already on your computer, the app downloads it once and keeps it for later.
4. The backend converts your file into a format Whisper likes best.
5. Whisper turns the speech into text on your machine.
6. The app shows progress while the job runs, then lets you copy or save the result.

Nothing in the normal app flow needs a remote transcription API. The only network use is model download the first time you choose a model that is not already installed locally.

## What The App Actually Does Today

Current implemented behavior in this repo includes:

- File selection through drag-and-drop or native macOS file dialogs
- Sequential queue processing for multiple files
- Model selection with auto-download on first use
- Language selection or auto-detect
- Two tasks:
  - `transcribe`
  - `translate to English`
- Optional word-level timestamps
- Transcript viewing in text, JSON, and timestamp-oriented views
- Model storage management, including delete-one and delete-all
- Backend debug log panel

Notes about the current implementation:

- The packaged runtime in this repo is currently focused on Apple Silicon macOS (`backend/runtime/macos-arm64`).
- The UI can run in a browser-like dev mode with a mock backend, but real transcription happens through Tauri and the Python sidecar.
- Models are stored in `~/Library/Application Support/Wordvale/models`, not inside the app bundle.

## Deep Technical Breakdown

### 1. High-Level Architecture

Wordvale is a three-layer desktop application:

- Frontend: React + TypeScript + Vite
- Native shell: Tauri + Rust
- Transcription engine: Python subprocess using `whisper.cpp`'s `whisper-cli`

The layers are connected like this:

```text
React UI
  -> Tauri shell APIs
  -> spawn backend process
  -> JSON commands over stdin/stdout
  -> Python server
  -> ffmpeg conversion
  -> whisper-cli transcription
  -> JSON results back to UI
```

### 2. Frontend Responsibilities

The frontend lives under `src/`.

Its main jobs are:

- Render the desktop UI
- Manage queue state and selected transcript state
- Start, stop, and monitor backend work
- Show model/system info
- Save exported output through Tauri file APIs

Important files:

- `src/App.tsx`
  - Root layout and app-level coordination
- `src/hooks/useWhisper.ts`
  - Main orchestration hook for backend startup, command sending, queue processing, and result state
- `src/components/*`
  - Focused UI panels for queueing, exporting, model management, and debug output

The frontend does not do transcription itself. It is an orchestration and presentation layer.

### 3. Tauri / Rust Layer

The Rust layer in `src-tauri/src/main.rs` is intentionally small.

It mainly:

- Registers a few native commands such as file metadata lookup and opening folders in Finder
- Hosts the Tauri app shell
- Enables the frontend to spawn the backend sidecar through Tauri shell APIs

This is a thin native bridge, not the main transcription engine.

### 4. Python Backend

The backend lives under `backend/`, primarily in `backend/whisper_server.py`.

It behaves like a simple JSON command server:

- reads one JSON command per line from `stdin`
- performs the requested action
- writes JSON responses and progress events to `stdout`

Supported command categories include:

- system info
- model metadata and storage info
- model download / deletion
- transcription
- cancellation
- shutdown

This keeps the integration simple and language-agnostic: the frontend does not need to know Python internals, and the backend does not need an HTTP server.

### 5. Transcription Pipeline

For a real transcription run, the backend does roughly this:

1. Receive `transcribe_file` with file path and options.
2. Verify the input file exists.
3. Ensure the selected model exists locally; download it if missing.
4. Convert the source media into mono 16 kHz WAV using `ffmpeg`.
5. Run `whisper-cli` with the selected model.
6. Read the generated JSON output from `whisper-cli`.
7. Normalize that output into the app's result format.
8. Send the final result back to the frontend.

If the selected task is translation, the backend performs:

1. a transcription pass
2. then a translation-to-English pass
3. then returns both original and English transcript variants

### 6. Why `ffmpeg` Is Involved

Whisper works best when the input audio is normalized into a known format.

This app converts incoming media to:

- WAV
- 16 kHz sample rate
- mono
- 16-bit PCM

That conversion step is handled in the backend before `whisper-cli` runs.

The backend resolves `ffmpeg` from a few places:

- `FFMPEG_PATH` if set
- `imageio-ffmpeg`'s packaged executable
- system PATH
- common macOS install locations such as `/opt/homebrew/bin/ffmpeg`

### 7. Model Handling

Model metadata is defined in `backend/model_registry.py`.

That registry includes:

- display names
- parameter counts
- estimated VRAM usage
- relative speed
- multilingual support
- translation support
- GGML file name

When you load a model in the UI:

- the frontend sends `load_model`
- the backend remembers that selection
- if the model file is missing, it downloads it from Hugging Face
- future runs reuse the local copy

Models are stored in:

```text
~/Library/Application Support/Wordvale/models
```

This is an important packaging decision: the app bundle stays smaller, and users do not need to re-download the whole app just because they want different models.

### 8. Queueing and Progress

The queue is managed in the React layer.

Each queue item tracks:

- file path
- file name
- file size
- status
- progress
- result or error

The queue processor:

- finds the next pending item
- marks it as processing
- waits for the backend to finish
- records success or failure
- continues until the queue is empty or cancelled

Progress is event-driven. The Python backend emits progress updates such as:

- model download progress
- audio conversion started
- transcription started
- translation started
- completion

### 9. Export System

Once a transcript is complete, the app can save it as:

- `.txt`
- `.srt`
- `.json`

Export uses native Tauri dialogs and file writing APIs, so the save flow feels like a real desktop app rather than a browser download.

### 10. Packaging and Distribution

This repo does more than run locally; it also includes packaging logic.

#### Backend packaging

`backend/package_backend.sh`:

- activates the backend virtualenv
- installs Python requirements if needed
- builds `whisper_server.py` into a one-file executable using PyInstaller
- stages that executable as a Tauri sidecar
- copies only the runtime assets needed by `whisper-cli`
- explicitly refuses to package model files into the app bundle

#### App packaging

`scripts/dist-mac.sh`:

- builds the Tauri app bundle
- verifies model files were not accidentally bundled
- creates a DMG
- copies the finished DMG to `~/Downloads`

This separation is one of the more important implementation details in the project. It keeps the shipped app practical while still bundling the core runtime.

### 11. Development Mode vs Production Mode

The app starts the backend differently depending on environment.

#### Development

- Tauri launches `backend/launch_backend.sh`
- that script activates `backend/venv` if present
- then runs `python3 backend/whisper_server.py`

This makes backend iteration faster because you do not need to rebuild the sidecar on every Python change.

#### Production

- Tauri launches the packaged sidecar binary
- the sidecar binary was produced from the Python backend with PyInstaller
- runtime resources are shipped alongside the app

### 12. Repo Layout

```text
src/                    React UI
src/components/         UI panels and controls
src/hooks/              Frontend orchestration hook
src-tauri/              Tauri config and Rust entry point
backend/                Python backend, model registry, packaging scripts
backend/runtime/        Vendored whisper runtime assets
scripts/                Release helper scripts
```

## Development Setup

### Prerequisites

- Node.js 18+
- Rust toolchain
- Python 3.10+
- macOS
- FFmpeg available locally is recommended, though the app also attempts packaged/runtime resolution

### Install frontend dependencies

```bash
npm install
```

### Create the backend virtual environment

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
```

### Run in development

```bash
npm run tauri dev
```

That starts:

- the Vite dev server
- the Tauri shell
- the Python backend through `backend/launch_backend.sh`

## Build and Package

### Build the frontend and backend artifacts

```bash
npm run build
```

This does two things:

- packages the backend sidecar
- builds the frontend app

### Create a distributable macOS bundle / DMG

```bash
npm run dist:mac
```

## GitHub Releases

The workflow at `.github/workflows/release-dmg.yml` builds an Apple silicon macOS DMG when a version tag is pushed. It publishes prerelease tags such as `v0.1.0-alpha` as GitHub prereleases. Set the same version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` before tagging.

```bash
git tag v0.1.0-alpha
git push origin v0.1.0-alpha
```

The release must include an asset named `Wordvale-macOS-arm64.dmg` for the Settings update check to find it. The check includes prereleases and compares version tags numerically. It opens the GitHub release page; download the DMG and drag the app to Applications to upgrade. Existing installations without the update check need this manual upgrade first. The DMG is currently unsigned and unnotarized.

## Design Choices

Some decisions in this repo are deliberate and worth calling out:

- Python backend instead of putting transcription directly in Rust:
  - faster iteration on the Whisper integration
  - easier subprocess and model-management scripting
- Tauri instead of Electron:
  - smaller desktop shell
  - native APIs without a full Chromium-heavy runtime
- JSON over stdin/stdout instead of HTTP:
  - simpler local IPC
  - no port management
  - easy progress streaming
- Models outside the app bundle:
  - much smaller distributable builds
  - users download only what they need

## Current Constraints

A few practical constraints are worth knowing up front:

- The bundled runtime in this repo is macOS Apple Silicon-focused
- There is currently no automated test suite in the repo
- The browser/mock mode is for UI development only, not real transcription
- First-time model load may take a while because the model is downloaded on demand

## If You Are Reading This As A Developer

The best files to start with are:

- `src/hooks/useWhisper.ts`
- `backend/whisper_server.py`
- `backend/model_registry.py`
- `backend/package_backend.sh`
- `src-tauri/tauri.conf.json`

Those files explain most of the real architecture faster than reading the UI components first.
