// Prevents an additional console window on Windows in release builds; the
// graphical window is created by the Tauri runtime itself.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mehr_life_os_lib::run()
}
