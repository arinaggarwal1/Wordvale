<p align="center"><img src="docs/wordvale-banner.svg" alt="Wordvale — Your recordings. Your words. Your Mac." width="100%"></p>

<p align="center"><strong>Offline transcription, made at home on your Mac.</strong><br>Turn recordings into readable, searchable text without sending your audio to a transcription service.</p>

<p align="center"><a href="#get-started">Get started</a> · <a href="#what-you-can-do">Features</a> · <a href="#run-from-source">Run from source</a> · <a href="#github-releases">Releases</a> · <a href="https://buymeacoffee.com/Arin11a">Buy me a coffee</a></p>

<p align="center"><a href="https://github.com/arinaggarwal1/Wordvale/releases/tag/v0.3.0-alpha.1"><strong>Download Wordvale 0.3.0-alpha.1 for macOS (Apple silicon)</strong></a></p>

---

## From recording to words

**01 · Bring your audio** — Drop in a recording or video, or choose files from Finder. Queue several at once.

**02 · Choose your model** — Pick the balance of speed, accuracy, and storage. Download a model once; use it offline afterward.

**03 · Make it useful** — Review the transcript, save it to your local library, and export it in the format you need.

## What you can do

| | |
| :--- | :--- |
| **Private by design** | Audio processing and transcription run locally. A Firebase account is used to sign in. |
| **A model for the job** | Compare multilingual and English-only Whisper models, download them, and switch between them. |
| **A queue that works for you** | Import multiple recordings, track progress, reorder pending items, and cancel processing. |
| **Your library, on your Mac** | Save, revisit, search, and organize transcripts and linked or locally copied recordings. |
| **Export your way** | Save plain text, timed text, SRT, JSON, or karaoke ASS when reliable word timestamps are available. |
| **Made for your workspace** | Choose a curated theme and keep your last used model and appearance. |

## Get started

Download the latest macOS DMG from the project's Releases page, open it, and drag Wordvale into Applications. The packaged build targets **Apple silicon** Macs. Open the app, sign in or create an account with email and password or Google, select a recording, and start transcription. Sign-in requires an internet connection. The local library is shared by accounts using the same Mac user profile; signing in does not isolate or sync its files.

The first time you use a model, it needs an internet connection to download. Afterward, the model runs locally. Checking for app updates also uses the internet.

## Run from source

With Node.js, Rust, Python, and the project's macOS runtime dependencies installed:

```bash
npm install
npm run tauri dev
```

To package a local Apple silicon DMG:

```bash
npm run dist:mac
```

The script builds the app and copies the DMG to `~/Downloads`. For frontend-only work, `npm run dev` runs the interface in a browser with a mock backend; use the Tauri command for real transcription.

<details>
<summary><strong>How it works under the hood</strong></summary>

## How It Works, In Normal People Terms

Think of Wordvale as a desktop app with a built-in transcription worker.

1. You drop in an audio or video file.
2. The app checks the file and puts it into a queue.
3. When you start, it loads the Whisper model you selected. If that model is not already on your computer, the app downloads it once and keeps it for later.
4. The backend converts your file into a format Whisper likes best.
5. Whisper turns the speech into text on your machine.
6. The app shows progress while the job runs, then lets you copy or save the result.

Nothing in the normal app flow needs a remote transcription API. Signing in requires an internet connection; model downloads and update checks also use the network.

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

## Manage models

Open **Manage models** in the transcription view to compare the available models, download them for offline use, select the active model, and remove downloaded files. Downloads run in the background while you navigate the app; the Models page shows progress and allows cancellation. Incomplete downloads are discarded. Removing a model does not delete recordings or transcripts.

Large v3 Turbo is intended for transcription and is not trained for speech translation. Choose a model with translation support when using Translate to English.

## Record meetings

Open **Record** from the sidebar, choose Microphone, Computer audio, or both, and start recording. Each source can be muted independently, and recording can be paused and resumed. Stop to review and play back your recording. **Transcribe** starts this recording using your current settings; **Adjust transcription settings** in the recording actions menu adds it to the queue without starting. Saving to Library is optional, before or after transcription. Unsaved recordings appear in **Draft recordings** with their name and date. Choose **Open recording** to review completed audio; **Restore audio** is only shown for interrupted sessions that need their captured audio rebuilt. Draft row menus offer Rename, Show in Finder, and Delete draft. Deleting requires confirmation and is blocked for recordings in the queue or Library. Recording requires macOS 13 or later and the relevant macOS microphone or screen recording permissions.

## Library

Open **Library** from the transcription sidebar to keep recordings and transcripts between sessions. Save one or more queue items to the library, add a recording, or import a TXT, SRT, or Wordvale JSON transcript. Library item names are separate from the names of original files. You can attach or remove a recording or transcript, relink missing recordings, and export saved transcripts.

When saving audio, **Link to original** leaves the recording in place and requires that the file remain available. **Copy into library** stores a separate managed copy. Removing a linked recording never deletes the original; removing a managed recording deletes its library copy. The local database and any managed recordings are stored under `~/Library/Application Support/Wordvale/library`.

Use **Add to queue** on a library recording to transcribe it again. A successful run replaces the item's saved transcript, including any previous translation; a cancelled or failed run leaves the existing transcript intact. Clearing the queue does not remove library items.

</details>

## GitHub Releases

The workflow at `.github/workflows/release-dmg.yml` builds an Apple silicon macOS DMG when a version tag is pushed. It publishes prerelease tags such as `v0.1.0-alpha` as GitHub prereleases. Set the same version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` before tagging.

```bash
git tag v0.1.0-alpha
git push origin v0.1.0-alpha
```

The release must include an asset named `Wordvale-macOS-arm64.dmg`. GitHub must report its `sha256:` digest and size in the release API; the app checks these before staging an update. The updater checks published stable releases and prereleases, orders semantic versions (including alpha, beta and release candidates), and ignores drafts. Version numbers in the package, Tauri configuration, Cargo manifest, and release tag must match.

Wordvale checks for updates at startup and every six hours while open. A dismissible notice links to **Settings → Updates**; dismissal lasts for that release. In Settings, download an available update, then choose **Install and restart** after saving your transcripts and finishing active work. The updater supports the packaged Apple silicon app in a writable location, stages the verified app beside the existing bundle, and keeps the previous bundle in the staging folder for recovery. Development builds can check but cannot install updates. If replacement or relaunch fails, it attempts to restore the previous app.

Install the first release containing the updater manually from its DMG; older versions cannot install updates themselves. The DMG and app are currently unsigned and unnotarized. The checksum verifies the artifact against GitHub’s release metadata; it is not an independent code-signing signature.

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

### Firebase client configuration

The API key in `src/firebase.ts` is Firebase client configuration distributed with the app, not a server credential. Its Google Cloud API restrictions allow only `identitytoolkit.googleapis.com` and `securetoken.googleapis.com`. Do not broaden this key to AI, billing, or other Google APIs; use separate credentials for additional services. See [Firebase API key guidance](https://firebase.google.com/docs/projects/api-keys).
