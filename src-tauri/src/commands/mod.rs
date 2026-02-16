// Tauri IPC commands
pub mod activity;
pub mod covers;
pub mod library;
pub mod lyrics;
pub mod metadata;
pub mod network;
pub mod playlist;
pub mod plugin;

pub use activity::*;
pub use library::*;
pub use lyrics::*;
pub use metadata::*;
pub use network::*;
pub use playlist::*;
pub use plugin::*;
pub mod window;
pub use covers::*;
