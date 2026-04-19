// Database module for SQLite operations
pub mod queries;
pub mod schema;

use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct Database {
    pub conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(app_dir: &PathBuf) -> Result<Self, rusqlite::Error> {
        let db_path = app_dir.join("rlist.db");
        let conn = Connection::open(&db_path)?;

        // Enable WAL mode for better concurrency and resilience to corruption
        // Use execute_batch because these PRAGMAs return results which execute() doesn't like
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;

        // Initialize schema
        schema::init_schema(&conn)?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };

        // Run integrity check in background to avoid blocking startup
        db.check_integrity_async();

        Ok(db)
    }

    fn check_integrity_async(&self) {
        let conn = self.conn.clone();
        std::thread::spawn(move || {
            // Delay integrity check to allow initial library load to complete
            std::thread::sleep(std::time::Duration::from_secs(30));

            let guard = match conn.lock() {
                Ok(g) => g,
                Err(_) => {
                    return;
                }
            };
            match guard.query_row("PRAGMA integrity_check;", [], |row| row.get::<_, String>(0)) {
                Ok(status) if status != "ok" => {
                    log::warn!("[DB] Integrity check failed: {}", status);
                }
                Err(e) => {
                    log::warn!("[DB] Could not run integrity check: {}", e);
                }
                _ => {
                    log::info!("[DB] Integrity check passed");
                }
            }
        });
    }
}
