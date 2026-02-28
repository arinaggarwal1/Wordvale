# Wordvale 🎙️

**Offline, secure, and unlimited transcription for macOS.**

Wordvale is a powerful desktop application that runs OpenAI's Whisper models entirely on your local machine. It allows you to transcribe audio and video files with high accuracy, privacy, and zero cost.

![Wordvale](/api/placeholder/800/400)

## ✨ Key Features

-   **🔒 100% Offline & Private**: Your audio files never leave your computer. No cloud, no API keys, no data tracking.
-   **🚀 Hardware Accelerated**: Optimized to use your Mac's CPU (and limited GPU support via Whisper implementation) for fast processing.
-   **📁 Batch Processing**: Drag and drop multiple files. The smart queue processes them sequentially to keep your system stable.
-   **📝 Native Export**: Save transcripts as Text (`.txt`), Time-stamped Text (`.txt`), Subtitles (`.srt`), or JSON (`.json`) using secure system dialogs.
-   **⚡ Live Preview**: Watch the transcription happen in real-time as the model processes your audio.
-   **🧠 Multiple Models**: Choose from `Tiny` (fastest) to `Large-v3` (most accurate) to balance speed and precision.

---

## 🤖 Model Specifications

Wordvale supports the full range of OpenAI Whisper models. Choose the one that fits your hardware and needs:

| Model | Parameters | Relative Speed | VRAM Required | Best Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **Tiny** | 39 M | ~32x | ~1 GB | Quick drafts, testing, clear English audio. |
| **Base** | 74 M | ~16x | ~1 GB | Good balance for simple dictation. |
| **Small** | 244 M | ~6x | ~2 GB | General purpose, reasonable accuracy. |
| **Medium** | 769 M | ~2x | ~5 GB | High quality, good for accents and fast speech. |
| **Large-v3** | 1550 M | 1x | ~10 GB | Professional grade, multilingual, subtle details. |
| **Turbo** | 809 M | ~8x | ~6 GB | Near-Large accuracy with much faster speed. |

> **Note**: "Relative Speed" is compared to the Large model. Actual speed depends on your specific hardware.

---

## 🛠️ How It Works

### Layman's Terms
Think of Wordvale as a professional translator living inside your computer.
1.  **Input**: You give it an audio file (like an MP3 or WAV).
2.  **Processing**: The app launches a dedicated "engine" (the Python backend) that listens to the audio.
3.  **Transcription**: Using advanced AI (OpenAI Whisper), it converts speech into text, understanding context, punctuation, and even multiple languages.
4.  **Output**: It types the text onto your screen in real-time and lets you save it to a file.

### Technical Architecture
Wordvale is a **hybrid desktop application** built with modern web and system technologies:

*   **Frontend**: Built with **React**, **TypeScript**, and **Tailwind CSS** for a responsive, beautiful user interface.
*   **Core**: Powered by **Tauri (Rust)**, which provides a secure, lightweight native wrapper and handles system interactions (files, dialogs, windows).
*   **AI Engine**: A dedicated **Python** subprocess runs `openai-whisper`.
    *   **IPC**: The React frontend communicates with the Rust backend, which spawns and manages the Python process securely.
    *   **Streaming**: Stdout from Python is streamed in real-time to the UI via Tauri events, ensuring instant feedback.

---

## 🚀 Installation & Development

### Prerequisites
*   **Node.js** (v18+)
*   **Rust** (latest stable)
*   **Python 3.10+** (ensure it's in your PATH)
*   **FFmpeg** (required for audio processing: `brew install ffmpeg`)

### Setup
1.  **Clone the repository**:
    ```bash
    git clone https://github.com/arinaggarwal1/Wordvale.git
    cd Wordvale
    ```

2.  **Install Frontend Dependencies**:
    ```bash
    npm install
    ```

3.  **Setup Python Backend**:
    *   Navigate to the backend folder: `cd backend`
    *   Create a virtual environment: `python3 -m venv venv`
    *   Activate it: `source venv/bin/activate`
    *   Install requirements: `pip install -r requirements.txt`

### Running the App
To run the app in development mode (with hot-reloading):

```bash
npm run tauri dev
```

This will:
1.  Start the Vite frontend server.
2.  Compile the Rust backend.
3.  Launch the Wordvale application window.

### Building for Production
To create a standalone application bundle (`.app` or `.dmg`) that includes the Python backend:

```bash
npm run build
```

The output will be located in `src-tauri/target/release/bundle/macos/`. This application is fully self-contained and can be distributed to other macOS machines (Apple Silicon).

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
