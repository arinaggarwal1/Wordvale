//! Wordvale — Tauri main entry point
//!
//! The Python backend sidecar process is managed from the frontend
//! using the @tauri-apps/api/shell Command API. This Rust side
//! primarily sets up the Tauri application with the correct permissions.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::{fs, path::Path, process::Command};

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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_file_metadata, open_in_finder])
        .run(tauri::generate_context!())
        .expect("error while running Wordvale");
}
