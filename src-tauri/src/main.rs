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
    let stem = filename.strip_suffix(".txt").unwrap_or(&filename);
    for index in 0..10000 {
        let name = if index == 0 { format!("{stem}.txt") } else { format!("{stem} ({index}).txt") };
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

fn main() {
    // An older updater may have relaunched us with its PyInstaller extraction
    // state. Never pass that stale state to a new backend sidecar.
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("_PYI_") {
            std::env::remove_var(key);
        }
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_file_metadata, open_in_finder, save_transcript_copy, app_process_id])
        .run(tauri::generate_context!())
        .expect("error while running Wordvale");
}
