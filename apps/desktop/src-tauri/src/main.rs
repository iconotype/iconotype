// the extra attribute keeps a console window from appearing behind the app on Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    iconotype_lib::run()
}
