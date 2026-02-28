#!/usr/bin/env bash
# launch_backend.sh
# Launcher script for the Wordvale Python backend.
# Activates the virtual environment and starts whisper_server.py.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

# Fix macOS SSL certificate issue for model downloads
export SSL_CERT_FILE="$(python3 -c 'import certifi; print(certifi.where())' 2>/dev/null || echo '')"
export REQUESTS_CA_BUNDLE="$SSL_CERT_FILE"

# Activate virtual environment if it exists
if [ -d "$VENV_DIR" ]; then
    source "$VENV_DIR/bin/activate"
fi

# Run the server
exec python3 "$SCRIPT_DIR/whisper_server.py"
