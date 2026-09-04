//! dual_track::open_gated_track is a blocking, synchronous call
//! it does file I/O and decode setup on whatever thread calls it
//! worker.rs's existing pipeline never blocks the audio command thread on that:
//! dispatch_open sends an OpenTask to a dedicated background thread and gets an OpenResult back over a channel
//! so play()/preload() return immediately regardless of how slow the file open is
//!
//! the same Task => background thread => Result over channel shape as OpenTask/ OpenResult,
//! just producing a (GatedSource<ReadySource>, GatedTrackHandle) pair instead of a ReadySource for the append only queue

use std::num::NonZero;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crossbeam::channel::{unbounded, Receiver, Sender};

use super::dual_track::{open_gated_track, GatedTrackHandle};
use super::gated::{GatedSource, SharedClock};
use super::mod_types::{AudioEvent, ReadySource};

/// mirrors worker::OpenTask's shape and fields
/// difference is 'clock' (this pipeline's shared sample clock, not needed by the queue based path)
/// in place of seek_rx/repeat_one_rx/is_preload/crossfade_seconds, which open_gated_track doesn't take
/// see dual_track.rs's module docs
pub struct GatedOpenTask {
    pub path: String,
    pub replay_gain_db: Option<f32>,
    pub generation: u64,
    pub volume: Arc<AtomicU32>,
    pub replay_gain_enabled: Arc<AtomicBool>,
    pub device_sample_rate: NonZero<u32>,
    pub device_channels: NonZero<u16>,
    pub initial_seek: Option<Duration>,
    pub event_tx: Sender<AudioEvent>,
    pub clock: Arc<SharedClock>,
    /// checked both before and after the decode/open work, same as OpenTask::abort .
    /// lets a superseding play()/preload() (new path chosen before this one finished opening)
    /// discard a stale result instead of it landing after the fact
    pub abort: Arc<AtomicBool>,
}

pub struct GatedOpenResult {
    pub generation: u64,
    pub result: Result<(GatedSource<ReadySource>, GatedTrackHandle), String>,
}

/// spawns the background thread and returns the task sender / result receiver pair
/// call once per AudioEngine lifetim
/// not once per task
pub fn spawn_gated_open_worker() -> (Sender<GatedOpenTask>, Receiver<GatedOpenResult>) {
    let (task_tx, task_rx) = unbounded::<GatedOpenTask>();
    let (result_tx, result_rx) = unbounded::<GatedOpenResult>();

    std::thread::spawn(move || {
        while let Ok(task) = task_rx.recv() {
            if task.abort.load(Ordering::Relaxed) {
                continue; // superseded before we even started => same early exit OpenTask uses
            }

            let generation = task.generation;
            let result = open_gated_track(
                &task.path,
                task.replay_gain_db,
                task.generation,
                task.volume,
                task.replay_gain_enabled,
                task.device_sample_rate,
                task.device_channels,
                task.initial_seek,
                task.event_tx,
                task.clock,
            );

            if task.abort.load(Ordering::Relaxed) {
                continue; // superseded while we were opening => discard, same as OpenTask
            }

            let _ = result_tx.send(GatedOpenResult { generation, result });
        }
    });

    (task_tx, result_rx)
}

// =============================================================================
// tests => real decode pipeline via open_gated_track, exercised through an actual spawned thread and channel round trip
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_test_wav(value: f32, n_samples: u32, sample_rate: u32) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "audion_gated_worker_test_{}_{}.wav",
            std::process::id(),
            {
                use std::sync::atomic::AtomicU64;
                static COUNTER: AtomicU64 = AtomicU64::new(0);
                COUNTER.fetch_add(1, Ordering::Relaxed)
            }
        ));
        let sample_i16 = (value.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        let data_bytes = n_samples * 2;
        let byte_rate = sample_rate * 2;
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(b"RIFF").unwrap();
        f.write_all(&(36 + data_bytes).to_le_bytes()).unwrap();
        f.write_all(b"WAVE").unwrap();
        f.write_all(b"fmt ").unwrap();
        f.write_all(&16u32.to_le_bytes()).unwrap();
        f.write_all(&1u16.to_le_bytes()).unwrap();
        f.write_all(&1u16.to_le_bytes()).unwrap();
        f.write_all(&sample_rate.to_le_bytes()).unwrap();
        f.write_all(&byte_rate.to_le_bytes()).unwrap();
        f.write_all(&2u16.to_le_bytes()).unwrap();
        f.write_all(&16u16.to_le_bytes()).unwrap();
        f.write_all(b"data").unwrap();
        f.write_all(&data_bytes.to_le_bytes()).unwrap();
        for _ in 0..n_samples {
            f.write_all(&sample_i16.to_le_bytes()).unwrap();
        }
        path
    }

    fn base_task(path: &std::path::Path, generation: u64, sample_rate: u32, clock: &Arc<SharedClock>) -> GatedOpenTask {
        let (event_tx, _event_rx) = unbounded::<AudioEvent>();
        GatedOpenTask {
            path: path.to_str().unwrap().to_string(),
            replay_gain_db: None,
            generation,
            volume: Arc::new(AtomicU32::new(1.0f32.to_bits())),
            replay_gain_enabled: Arc::new(AtomicBool::new(false)),
            device_sample_rate: NonZero::new(sample_rate).unwrap(),
            device_channels: NonZero::new(1).unwrap(),
            initial_seek: None,
            event_tx,
            clock: Arc::clone(clock),
            abort: Arc::new(AtomicBool::new(false)),
        }
    }

    #[test]
    fn opens_a_real_track_across_the_thread_boundary_and_returns_a_working_handle() {
        let sample_rate = 44100u32;
        let path = write_test_wav(0.5, sample_rate, sample_rate);
        let clock = SharedClock::new();

        let (task_tx, result_rx) = spawn_gated_open_worker();
        task_tx.send(base_task(&path, 7, sample_rate, &clock)).unwrap();

        let result = result_rx.recv_timeout(std::time::Duration::from_secs(5))
            .expect("worker must produce a result within the timeout");

        assert_eq!(result.generation, 7);
        let (_gated, handle) = result.result.expect("a valid WAV fixture must open cleanly");
        assert_eq!(handle.generation, 7);
        assert_eq!(handle.path, path.to_str().unwrap());
        assert!(handle.duration.is_some(), "a real decode must produce a real duration");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn does_not_block_the_caller_queuing_multiple_tasks() {
        // sending tasks must return immediately regardless of how long decode takes
        let sample_rate = 44100u32;
        let path_a = write_test_wav(0.5, sample_rate, sample_rate);
        let path_b = write_test_wav(0.25, sample_rate, sample_rate);
        let clock = SharedClock::new();

        let (task_tx, result_rx) = spawn_gated_open_worker();

        let start = std::time::Instant::now();
        task_tx.send(base_task(&path_a, 1, sample_rate, &clock)).unwrap();
        task_tx.send(base_task(&path_b, 2, sample_rate, &clock)).unwrap();
        let dispatch_elapsed = start.elapsed();
        assert!(
            dispatch_elapsed < std::time::Duration::from_millis(500),
            "sending tasks must not block on decode work: took {:?}",
            dispatch_elapsed
        );

        let first = result_rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        let second = result_rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        assert_eq!(first.generation, 1);
        assert_eq!(second.generation, 2);
        assert!(first.result.is_ok());
        assert!(second.result.is_ok());

        let _ = std::fs::remove_file(&path_a);
        let _ = std::fs::remove_file(&path_b);
    }

    #[test]
    fn aborted_task_never_produces_a_result() {
        let sample_rate = 44100u32;
        let path = write_test_wav(0.5, sample_rate, sample_rate);
        let clock = SharedClock::new();

        let (task_tx, result_rx) = spawn_gated_open_worker();
        let mut task = base_task(&path, 9, sample_rate, &clock);
        task.abort.store(true, Ordering::Relaxed); // aborted before it was ever sent
        task_tx.send(task).unwrap();

        // give the worker thread a real chance to have processed (and discarded) it
        let outcome = result_rx.recv_timeout(std::time::Duration::from_millis(500));
        assert!(outcome.is_err(), "an aborted task must never send a result, not even an Err one");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn missing_file_reports_an_error_result_not_a_panic() {
        let sample_rate = 44100u32;
        let clock = SharedClock::new();
        let (task_tx, result_rx) = spawn_gated_open_worker();

        let mut task = base_task(std::path::Path::new("/nonexistent/does_not_exist.wav"), 3, sample_rate, &clock);
        task.path = "/nonexistent/does_not_exist.wav".to_string();
        task_tx.send(task).unwrap();

        let result = result_rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        assert_eq!(result.generation, 3);
        assert!(result.result.is_err(), "a missing file must come back as Err, not crash the worker thread");

        // the worker thread must still be alive and able to serve a subsequent valid task
        // a bad path must not have poisoned or exited the loop
        let path = write_test_wav(0.5, sample_rate, sample_rate);
        task_tx.send(base_task(&path, 4, sample_rate, &clock)).unwrap();
        let ok_result = result_rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        assert_eq!(ok_result.generation, 4);
        assert!(ok_result.result.is_ok());

        let _ = std::fs::remove_file(&path);
    }
}