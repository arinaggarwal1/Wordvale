//! Wordvale — Tauri main entry point
//!
//! The Python backend sidecar process is managed from the frontend
//! using the @tauri-apps/api/shell Command API. This Rust side
//! primarily sets up the Tauri application with the correct permissions.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::{fs, io::Write, path::Path, process::Command};
use tauri::Manager;

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
        .invoke_handler(tauri::generate_handler![get_file_metadata, allow_audio_playback, open_in_finder, save_transcript_copy, app_process_id])
        .run(tauri::generate_context!())
        .expect("error while running Wordvale");
}
