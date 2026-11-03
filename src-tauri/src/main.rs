//! Wordvale — Tauri main entry point
//!
//! The Python backend sidecar process is managed from the frontend
//! using the @tauri-apps/api/shell Command API. This Rust side
//! primarily sets up the Tauri application with the correct permissions.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::{fs, io::{Write, BufRead, BufReader}, path::Path, process::{Command, Stdio, Child}, sync::{Mutex, Arc}};
use tauri::Manager;

struct RecordingState(Arc<Mutex<Option<(Child, std::path::PathBuf, bool, bool)>>>);

fn recorder_executable() -> std::path::PathBuf {
    std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.join("wordvale-recorder"))).filter(|p| p.is_file()).unwrap_or_else(|| std::path::PathBuf::from("binaries/wordvale-recorder-aarch64-apple-darwin"))
}

#[tauri::command]
async fn recording_permissions() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = Command::new(recorder_executable()).arg("--permissions").output().map_err(|e| e.to_string())?;
        if !output.status.success() { return Err("Could not check recording permissions.".into()); }
        serde_json::from_slice(&output.stdout).map_err(|e| format!("Could not check recording permissions: {e}"))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn recording_request_system() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = Command::new(recorder_executable()).arg("--request-system").output().map_err(|e| e.to_string())?;
        if !output.status.success() { return Err("Could not request computer audio access.".into()); }
        Ok(String::from_utf8_lossy(&output.stdout).trim() == "granted")
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn recording_open_settings(source: String) -> Result<(), String> {
    let pane = match source.as_str() {
        "mic" => "Privacy_Microphone",
        "system" => "Privacy_ScreenCapture",
        _ => return Err("Unknown audio source".into()),
    };
    Command::new("/usr/bin/open").arg(format!("x-apple.systempreferences:com.apple.preference.security?{pane}")).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn recording_start(app: tauri::AppHandle, state: tauri::State<'_, RecordingState>, mic: bool, system: bool, name: Option<String>) -> Result<(), String> {
    let state = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || recording_start_blocking(app, state, mic, system, name)).await.map_err(|e| e.to_string())?
}

fn recording_start_blocking(app: tauri::AppHandle, state: Arc<Mutex<Option<(Child, std::path::PathBuf, bool, bool)>>>, mic: bool, system: bool, name: Option<String>) -> Result<(), String> {
    if !mic && !system { return Err("Choose at least one audio source.".into()); }
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if guard.is_some() { return Err("A recording is already running.".into()); }
    let root = app.path_resolver().app_data_dir().ok_or("Missing app data directory")?.join("recordings");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let folder = root.join(format!("meeting-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis()));
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    fs::write(folder.join("draft.json"), serde_json::json!({"name": name.unwrap_or_else(|| "Meeting".into())}).to_string()).map_err(|e| e.to_string())?;
    let mut child = Command::new(recorder_executable()).arg(&folder).arg(if mic { "1" } else { "0" }).arg(if system { "1" } else { "0" }).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let mut line = String::new();
    let mut output = BufReader::new(child.stdout.take().ok_or("Missing recorder output")?);
    output.read_line(&mut line).map_err(|e| e.to_string())?;
    if !line.starts_with("READY") { return Err(if line.trim().is_empty() { "Recorder could not start. Check microphone and screen recording permissions.".into() } else { line.trim().trim_start_matches("ERROR ").to_string() }); }
    std::thread::spawn(move || {
        for line in output.lines().flatten() {
            let mut parts = line.split_whitespace();
            if parts.next() != Some("LEVEL") { continue; }
            let source = match parts.next() { Some("mic") => "mic", Some("system") => "system", _ => continue };
            if let Some(level) = parts.next().and_then(|value| value.parse::<f32>().ok()) {
                let _ = app.emit_all("recording-level", serde_json::json!({"source": source, "level": level.clamp(0.0, 1.0)}));
            }
        }
    });
    *guard = Some((child, folder, mic, system));
    Ok(())
}

#[tauri::command]
fn recording_mute(state: tauri::State<RecordingState>, source: String, muted: bool) -> Result<(), String> {
    if source != "mic" && source != "system" { return Err("Unknown audio source".into()); }
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let (child, _, _, _) = guard.as_mut().ok_or("No recording is running")?;
    writeln!(child.stdin.as_mut().ok_or("Recorder disconnected")?, "MUTE {} {}", source, if muted { 1 } else { 0 }).map_err(|e| e.to_string())
}

#[tauri::command]
fn recording_pause(state: tauri::State<RecordingState>, paused: bool) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let (child, _, _, _) = guard.as_mut().ok_or("No recording is running")?;
    writeln!(child.stdin.as_mut().ok_or("Recorder disconnected")?, "PAUSE {}", if paused { 1 } else { 0 }).map_err(|e| e.to_string())
}

#[tauri::command]
async fn recording_stop(state: tauri::State<'_, RecordingState>) -> Result<String, String> {
    let state = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || recording_stop_blocking(state)).await.map_err(|e| e.to_string())?
}

fn recording_stop_blocking(state: Arc<Mutex<Option<(Child, std::path::PathBuf, bool, bool)>>>) -> Result<String, String> {
    let (mut child, folder, mic, system) = state.lock().map_err(|e| e.to_string())?.take().ok_or("No recording is running")?;
    if let Some(stdin) = child.stdin.as_mut() { let _ = writeln!(stdin, "STOP"); }
    child.wait().map_err(|e| e.to_string())?;
    finalize_recording(&folder, mic, system)
}

fn finalize_recording(folder: &Path, mic: bool, system: bool) -> Result<String, String> {
    let output = folder.join("meeting.wav");
    let bundled_ffmpeg = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.join("../Resources/_up_/backend/bundle_resources/ffmpeg")));
    let ffmpeg = bundled_ffmpeg.filter(|p| p.is_file()).unwrap_or_else(|| ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].iter().map(std::path::PathBuf::from).find(|p| p.is_file()).unwrap_or_else(|| std::path::PathBuf::from("ffmpeg")));
    let mut command = Command::new(ffmpeg); command.arg("-y");
    if mic { command.arg("-i").arg(folder.join("mic.caf")); }
    if system { command.arg("-i").arg(folder.join("system.caf")); }
    if mic && system { command.args(["-filter_complex", "amix=inputs=2:duration=longest:normalize=1"]); }
    let result = command.args(["-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"]).arg(&output).output().map_err(|e| e.to_string())?;
    if !result.status.success() { return Err(format!("Could not finalize recording: {}", String::from_utf8_lossy(&result.stderr))); }
    fs::write(folder.join("pending-library"), b"").map_err(|e| e.to_string())?;
    Ok(output.to_string_lossy().into_owned())
}

#[tauri::command]
fn recording_recoverable(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let root = app.path_resolver().app_data_dir().ok_or("Missing app data directory")?.join("recordings");
    if !root.exists() { return Ok(Vec::new()); }
    let mut folders = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let folder = entry.map_err(|e| e.to_string())?.path();
        if folder.is_dir() && (folder.join("pending-library").exists() || (!folder.join("meeting.wav").exists() && (folder.join("mic.caf").exists() || folder.join("system.caf").exists()))) {
            let metadata = fs::read(folder.join("draft.json")).ok().and_then(|data| serde_json::from_slice::<serde_json::Value>(&data).ok());
            let created_at = folder.file_name().and_then(|name| name.to_str()).and_then(|name| name.strip_prefix("meeting-")).and_then(|value| value.parse::<u64>().ok()).unwrap_or(0);
            folders.push(serde_json::json!({
                "folder": folder.to_string_lossy(),
                "name": metadata.as_ref().and_then(|value| value.get("name")).and_then(|name| name.as_str()).unwrap_or("Meeting"),
                "created_at": created_at,
                "interrupted": !folder.join("meeting.wav").exists()
            }));
        }
    }
    folders.sort_by_key(|draft| std::cmp::Reverse(draft["created_at"].as_u64().unwrap_or(0)));
    Ok(folders)
}

#[tauri::command]
fn recording_recover(app: tauri::AppHandle, folder: String) -> Result<String, String> {
    let root = app.path_resolver().app_data_dir().ok_or("Missing app data directory")?.join("recordings");
    let path = fs::canonicalize(folder).map_err(|e| e.to_string())?;
    if path.parent() != Some(fs::canonicalize(root).map_err(|e| e.to_string())?.as_path()) { return Err("Invalid recording location".into()); }
    if path.join("meeting.wav").exists() { return Ok(path.join("meeting.wav").to_string_lossy().into_owned()); }
    finalize_recording(&path, path.join("mic.caf").exists(), path.join("system.caf").exists())
}

#[tauri::command]
fn recording_ack(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let root = fs::canonicalize(app.path_resolver().app_data_dir().ok_or("Missing app data directory")?.join("recordings")).map_err(|e| e.to_string())?;
    let audio = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let folder = audio.parent().ok_or("Invalid recording")?;
    if folder.parent() != Some(root.as_path()) || audio.file_name().and_then(|n| n.to_str()) != Some("meeting.wav") { return Err("Invalid recording location".into()); }
    let _ = fs::remove_file(folder.join("pending-library"));
    Ok(())
}

fn draft_folder(root: &Path, folder: &Path) -> Result<std::path::PathBuf, String> {
    if fs::symlink_metadata(folder).map_err(|e| e.to_string())?.file_type().is_symlink() { return Err("Invalid draft location".into()); }
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let folder = fs::canonicalize(folder).map_err(|e| e.to_string())?;
    if folder.parent() != Some(root.as_path()) || !folder.is_dir() { return Err("Invalid draft location".into()); }
    if !(folder.join("pending-library").is_file() || (!folder.join("meeting.wav").exists() && (folder.join("mic.caf").is_file() || folder.join("system.caf").is_file()))) {
        return Err("This recording is no longer a draft. Refresh the list and try again.".into());
    }
    Ok(folder)
}

#[cfg(test)]
mod draft_tests {
    use super::*;

    #[test]
    fn manages_only_unsaved_drafts_inside_the_recordings_folder() {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let base = std::env::temp_dir().join(format!("wordvale-drafts-{}-{unique}", std::process::id()));
        let root = base.join("recordings");
        let draft = root.join("meeting-1");
        fs::create_dir_all(&draft).unwrap();
        fs::write(draft.join("mic.caf"), b"captured audio").unwrap();
        assert!(draft_folder(&root, &draft).is_ok(), "interrupted audio is a draft");
        fs::write(draft.join("meeting.wav"), b"completed audio").unwrap();
        fs::write(draft.join("pending-library"), b"").unwrap();
        assert!(draft_folder(&root, &draft).is_ok(), "completed unsaved audio is a draft");
        fs::remove_file(draft.join("pending-library")).unwrap();
        assert!(draft_folder(&root, &draft).is_err(), "acknowledged recordings are protected");
        let outside = base.join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("pending-library"), b"").unwrap();
        assert!(draft_folder(&root, &outside).is_err());
        assert!(draft_folder(&root, &root).is_err());
        #[cfg(unix)]
        {
            let link = root.join("linked-draft");
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            assert!(draft_folder(&root, &link).is_err(), "symlinks cannot target external folders");
        }
        fs::remove_dir_all(base).unwrap();
    }
}

#[tauri::command]
fn recording_rename_draft(app: tauri::AppHandle, state: tauri::State<RecordingState>, folder: String, name: String) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() { return Err("Finish recording before managing drafts.".into()); }
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 200 { return Err("Use a name between 1 and 200 characters.".into()); }
    let root = app.path_resolver().app_data_dir().ok_or("Missing app data directory")?.join("recordings");
    let folder = draft_folder(&root, Path::new(&folder))?;
    let temporary = folder.join("draft.json.tmp");
    fs::write(&temporary, serde_json::json!({"name": name}).to_string()).map_err(|e| e.to_string())?;
    fs::rename(temporary, folder.join("draft.json")).map_err(|e| e.to_string())
}

#[tauri::command]
fn recording_delete_draft(app: tauri::AppHandle, state: tauri::State<RecordingState>, folder: String) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() { return Err("Finish recording before managing drafts.".into()); }
    let root = app.path_resolver().app_data_dir().ok_or("Missing app data directory")?.join("recordings");
    let folder = draft_folder(&root, Path::new(&folder))?;
    fs::remove_dir_all(folder).map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(unexpected_cfgs)]
fn set_theme_dock_icon(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let bytes: &'static [u8] = match theme.as_str() {
            "reading" => include_bytes!("../icons/themes/reading.png"),
            "paper" => include_bytes!("../icons/themes/paper.png"),
            "graphite" => include_bytes!("../icons/themes/graphite.png"),
            "midnight" => include_bytes!("../icons/themes/midnight.png"),
            "dusk" => include_bytes!("../icons/themes/dusk.png"),
            "light" => include_bytes!("../icons/themes/light.png"),
            "dark" => include_bytes!("../icons/themes/dark.png"),
            "amber" => include_bytes!("../icons/themes/amber.png"),
            _ => return Err("Unknown theme".into()),
        };
        app.run_on_main_thread(move || unsafe {
            use objc::{class, msg_send, sel, sel_impl};
            use objc::runtime::Object;
            let data: *mut Object = msg_send![class!(NSData), dataWithBytes:bytes.as_ptr() length:bytes.len()];
            let image: *mut Object = msg_send![class!(NSImage), alloc];
            let image: *mut Object = msg_send![image, initWithData:data];
            if !image.is_null() {
                let application: *mut Object = msg_send![class!(NSApplication), sharedApplication];
                let _: () = msg_send![application, setApplicationIconImage:image];
                let _: () = msg_send![image, release];
            }
        }).map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, theme);
    Ok(())
}

#[derive(serde::Serialize)]
struct FileMetadata {
    size: u64,
    is_file: bool,
}

#[tauri::command]
fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok(FileMetadata {
        size: metadata.len(),
        is_file: metadata.is_file(),
    })
}

#[tauri::command]
fn allow_audio_playback(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !path.is_file() {
        return Err("Recording is not a file".into());
    }
    app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_in_finder(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg(&path).status()
    } else if cfg!(target_os = "windows") {
        Command::new("explorer").arg(&path).status()
    } else {
        Command::new("xdg-open").arg(&path).status()
    }
    .map_err(|e| e.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("Failed to open path: {}", path))
    }
}

#[tauri::command]
fn save_transcript_copy(directory: String, filename: String, content: String) -> Result<String, String> {
    let dir = Path::new(&directory);
    if !dir.is_dir() || Path::new(&filename).file_name().and_then(|v| v.to_str()) != Some(filename.as_str()) {
        return Err("Invalid output folder or file name".into());
    }
    let file = Path::new(&filename);
    let extension = file.extension().and_then(|v| v.to_str()).unwrap_or("");
    if !["txt", "srt", "json", "ass"].contains(&extension) {
        return Err("Unsupported transcript format".into());
    }
    let stem = file.file_stem().and_then(|v| v.to_str()).filter(|v| !v.is_empty()).ok_or("Invalid file name")?;
    for index in 0..10000 {
        let name = if index == 0 { format!("{stem}.{extension}") } else { format!("{stem} ({index}).{extension}") };
        let path = dir.join(name);
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(error) = file.write_all(content.as_bytes()) {
                    drop(file);
                    let _ = fs::remove_file(&path);
                    return Err(error.to_string());
                }
                return Ok(path.to_string_lossy().into_owned());
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Too many files with this name".into())
}

#[tauri::command]
fn app_process_id() -> u32 { std::process::id() }

#[cfg(test)]
mod tests {
    use super::save_transcript_copy;
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};

    #[test]
    fn transcript_exports_preserve_existing_files_and_extensions() {
        let folder = std::env::temp_dir().join(format!("wordvale-export-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&folder).unwrap();
        let dir = folder.to_string_lossy().into_owned();
        let first = save_transcript_copy(dir.clone(), "talk.srt".into(), "first".into()).unwrap();
        let second = save_transcript_copy(dir.clone(), "talk.srt".into(), "second".into()).unwrap();
        assert!(second.ends_with("talk (1).srt"));
        assert_eq!(fs::read_to_string(first).unwrap(), "first");
        assert_eq!(fs::read_to_string(second).unwrap(), "second");
        assert!(save_transcript_copy(dir.clone(), "../escape.txt".into(), "bad".into()).is_err());
        assert!(save_transcript_copy(dir, "bad.exe".into(), "bad".into()).is_err());
        fs::remove_dir_all(folder).unwrap();
    }
}

fn main() {
    // An older updater may have relaunched us with its PyInstaller extraction
    // state. Never pass that stale state to a new backend sidecar.
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("_PYI_") {
            std::env::remove_var(key);
        }
    }
    tauri::Builder::default()
        .manage(RecordingState(Arc::new(Mutex::new(None))))
        .invoke_handler(tauri::generate_handler![get_file_metadata, allow_audio_playback, open_in_finder, save_transcript_copy, app_process_id, google_browser_sign_in, set_theme_dock_icon, recording_permissions, recording_request_system, recording_open_settings, recording_start, recording_mute, recording_pause, recording_stop, recording_recoverable, recording_recover, recording_ack, recording_rename_draft, recording_delete_draft])
        .run(tauri::generate_context!())
        .expect("error while running Wordvale");
}

// Google rejects OAuth inside the app's embedded WebView. This short-lived
// loopback listener lets the system browser return a Google ID token instead.
#[tauri::command]
async fn google_browser_sign_in() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<String, String> {
        use std::io::{BufRead, BufReader, Read, Write};
        use std::net::TcpListener;
        use std::time::{Duration, Instant};
        let mut bytes = [0u8; 32];
        std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut bytes)).map_err(|e| e.to_string())?;
        let secret: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let url = format!("http://localhost:{port}/{secret}");
        std::process::Command::new("open").arg(&url).spawn().map_err(|e| e.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(180);
        while Instant::now() < deadline {
            let (mut stream, _) = match listener.accept() {
                Ok(v) => v,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => { std::thread::sleep(Duration::from_millis(100)); continue; }
                Err(e) => return Err(e.to_string()),
            };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() { continue; }
            let expected_get = format!("GET /{secret} HTTP/1.1\r\n");
            let expected_post = format!("POST /{secret} HTTP/1.1\r\n");
            let is_get = line == expected_get;
            let is_post = line == expected_post;
            let mut length = 0usize;
            let mut origin_ok = false;
            loop {
                line.clear();
                if reader.read_line(&mut line).is_err() || line == "\r\n" || line.is_empty() { break; }
                if line.len() > 8192 { break; }
                if let Some((key, value)) = line.trim().split_once(':') {
                    if key.eq_ignore_ascii_case("content-length") { length = value.trim().parse().unwrap_or(0); }
                    if key.eq_ignore_ascii_case("origin") { origin_ok = value.trim() == format!("http://localhost:{port}"); }
                }
            }
            if is_get {
                let body = r#"<!doctype html><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width"><title>Sign in to Wordvale</title><style>body{font:16px system-ui;background:#faf8f3;color:#253d3b;display:grid;place-items:center;height:100vh;margin:0}main{max-width:360px;padding:32px}button{background:#426c59;color:white;border:0;border-radius:8px;padding:14px 24px;cursor:pointer}p{line-height:1.5}</style><main><h1>Sign in to Wordvale</h1><p>Continue with Google, then return to the app.</p><button id="sign">Continue with Google</button><p id="status" role="status"></p></main><script type="module">import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';import {getAuth,GoogleAuthProvider,signInWithPopup,setPersistence,inMemoryPersistence} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';const app=initializeApp({apiKey:'AIzaSyDaRU6FS8GEH0wvE9r3L0XyF-UjW34peDk',authDomain:'wordvale-auth-20261103.firebaseapp.com',projectId:'wordvale-auth-20261103',appId:'1:195423666593:web:a68875e6b05bf8b4550be0'});document.querySelector('#sign').onclick=async()=>{let b=document.querySelector('#sign'),s=document.querySelector('#status');b.disabled=true;try{await setPersistence(getAuth(app),inMemoryPersistence);const result=await signInWithPopup(getAuth(app),new GoogleAuthProvider());const token=GoogleAuthProvider.credentialFromResult(result).idToken;if(!token)throw Error('Missing Google credential');const response=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'text/plain'},body:token});if(!response.ok)throw Error('Could not return to Wordvale');s.textContent='Signed in. You can close this tab and return to Wordvale.';b.remove()}catch(e){s.textContent='Sign-in could not be completed. Please try again.';b.disabled=false}};</script>"#;
                let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                let _ = stream.write_all(response.as_bytes());
            } else if is_post && origin_ok && (1..=16384).contains(&length) {
                let mut body = vec![0; length];
                if reader.read_exact(&mut body).is_err() { continue; }
                let token = String::from_utf8(body).map_err(|e| e.to_string())?;
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK");
                return Ok(token);
            } else { let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); }
        }
        Err("Google sign-in timed out. Please try again.".into())
    }).await.map_err(|e| e.to_string())?
}
