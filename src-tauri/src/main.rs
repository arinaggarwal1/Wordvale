//! Wordvale — Tauri main entry point
//!
//! The Python backend sidecar process is managed from the frontend
//! using the @tauri-apps/api/shell Command API. This Rust side
//! primarily sets up the Tauri application with the correct permissions.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::fs;

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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_file_metadata])
        .run(tauri::generate_context!())
        .expect("error while running Wordvale");
}
