//! GitHub token storage in the OS keychain, plus the two fallback token sources.

use std::process::Command;

const SERVICE: &str = "github-client";
const ACCOUNT: &str = "github-token";

fn entry() -> Result<keyring::Entry, String> {
  keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get() -> Result<Option<String>, String> {
  match entry()?.get_password() {
    Ok(token) => Ok(Some(token)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
pub fn secret_set(token: String) -> Result<(), String> {
  entry()?.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_clear() -> Result<(), String> {
  match entry()?.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(e) => Err(e.to_string()),
  }
}

/// `GITHUB_TOKEN` from the environment the app was started in.
#[tauri::command]
pub fn env_token() -> Option<String> {
  std::env::var("GITHUB_TOKEN").ok().filter(|t| !t.is_empty())
}

/// Token of the GitHub CLI. Apps started from a desktop launcher often lack the
/// user's shell PATH, so common install locations are tried as well.
#[tauri::command]
pub fn gh_token() -> Option<String> {
  let home = std::env::var("HOME").unwrap_or_default();
  let candidates = [
    "gh".to_string(),
    format!("{home}/.local/bin/gh"),
    "/opt/homebrew/bin/gh".to_string(),
    "/usr/local/bin/gh".to_string(),
    "/usr/bin/gh".to_string(),
  ];
  candidates.iter().find_map(|bin| {
    let output = Command::new(bin).args(["auth", "token"]).output().ok()?;
    let token = String::from_utf8(output.stdout).ok()?.trim().to_string();
    (output.status.success() && !token.is_empty()).then_some(token)
  })
}
