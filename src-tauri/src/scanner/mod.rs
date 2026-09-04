// Scanner module for file walking, metadata extraction, and cover storage
pub mod walker;
pub mod metadata;
pub mod cover_storage;
pub mod artist_parser;

pub use walker::scan_directory;
pub use metadata::extract_metadata;
pub use artist_parser::{split_artists, join_artists_for_display};