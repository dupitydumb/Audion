// Tauri IPC commands
pub mod activity;
pub mod covers;
pub mod library;
pub mod listenbrainz;
pub mod lyrics;
pub mod applelyrics;
pub mod metadata;
pub mod musicbrainz;
pub mod network;
pub mod playlist;
pub mod plugin;
pub mod sync;

pub use activity::*;
pub use library::*;
pub use listenbrainz::*;
pub use lyrics::*;
pub use applelyrics::*;
pub use metadata::*;
pub use musicbrainz::*;
pub use network::*;
pub use playlist::*;
pub use plugin::*;
pub mod window;
pub use covers::*;
pub use sync::*;
