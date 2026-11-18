//! Windows exclusive output: a raw WASAPI `IAudioClient` opened in
//! `AUDCLNT_SHAREMODE_EXCLUSIVE`, with its own render thread.
//!
//! cpal 0.17 only implements shared mode (it hardcodes the shared flag and
//! `AUTOCONVERTPCM`), so the exclusive path is built directly on the windows
//! crate. All COM work happens on the render thread; no COM pointer crosses it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use crossbeam::channel::{unbounded, Sender};
use rodio::Source;
use windows::core::{GUID, HSTRING, PCWSTR};
use windows::Win32::Foundation::{
    CloseHandle, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, IAudioClient, IAudioRenderClient, IMMDevice, IMMDeviceEnumerator,
    AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, WAVEFORMATEX,
    WAVEFORMATEXTENSIBLE, WAVEFORMATEXTENSIBLE_0,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED,
};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

use super::NegotiatedFormat;

// windows 0.61.3 does not export these two
const CLSID_MM_DEVICE_ENUMERATOR: GUID = GUID::from_u128(0xBCDE0395_E52F_467C_8E3D_C4579291692E);
const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID =
    GUID::from_u128(0x0000_0003_0000_0010_8000_00AA00389B71);
const KSDATAFORMAT_SUBTYPE_PCM: GUID =
    GUID::from_u128(0x0000_0001_0000_0010_8000_00AA00389B71);

const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;
const HNS_PER_MS: i64 = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SampleKind {
    F32,
    S32,
    S24,
    S16,
}

impl SampleKind {
    fn container_bits(self) -> u16 {
        match self {
            Self::F32 | Self::S32 | Self::S24 => 32,
            Self::S16 => 16,
        }
    }

    fn valid_bits(self) -> u16 {
        match self {
            Self::F32 => 32,
            Self::S32 => 32,
            Self::S24 => 24,
            Self::S16 => 16,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::F32 => "f32le",
            Self::S32 => "s32le",
            Self::S24 => "s24le",
            Self::S16 => "s16le",
        }
    }
}

/// exclusive speaker masks up to 7.1, 0 lets the driver derive it
fn channel_mask_for(channels: u16) -> u32 {
    match channels {
        1 => 0x4,      // front center
        2 => 0x3,      // front left | front right
        3 => 0x7,      // + front center
        4 => 0x33,     // quad
        5 => 0x37,     // 5.0
        6 => 0x3F,     // 5.1
        7 => 0x13F,    // 6.1
        8 => 0x63F,    // 7.1
        _ => 0,
    }
}

fn make_extensible(sample_rate: u32, channels: u16, kind: SampleKind) -> WAVEFORMATEXTENSIBLE {
    let container_bits = kind.container_bits();
    let block_align = channels * (container_bits / 8);
    WAVEFORMATEXTENSIBLE {
        Format: WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_EXTENSIBLE,
            nChannels: channels,
            nSamplesPerSec: sample_rate,
            nAvgBytesPerSec: sample_rate * block_align as u32,
            nBlockAlign: block_align,
            wBitsPerSample: container_bits,
            cbSize: 22,
        },
        Samples: WAVEFORMATEXTENSIBLE_0 {
            wValidBitsPerSample: kind.valid_bits(),
        },
        dwChannelMask: channel_mask_for(channels),
        SubFormat: match kind {
            SampleKind::F32 => KSDATAFORMAT_SUBTYPE_IEEE_FLOAT,
            _ => KSDATAFORMAT_SUBTYPE_PCM,
        },
    }
}

/// plain WAVEFORMATEX is only understood for mono/stereo PCM 8/16-bit
fn make_plain_16(sample_rate: u32, channels: u16) -> WAVEFORMATEX {
    WAVEFORMATEX {
        wFormatTag: 1, // WAVE_FORMAT_PCM
        nChannels: channels,
        nSamplesPerSec: sample_rate,
        nAvgBytesPerSec: sample_rate * channels as u32 * 2,
        nBlockAlign: channels * 2,
        wBitsPerSample: 16,
        cbSize: 0,
    }
}

fn clamp_sample(x: f32) -> f32 {
    if x.is_nan() { 0.0 } else { x.clamp(-1.0, 1.0) }
}

fn f32_to_i16(x: f32) -> i16 {
    (clamp_sample(x) * i16::MAX as f32) as i16
}

fn f32_to_i32(x: f32) -> i32 {
    (clamp_sample(x) as f64 * i32::MAX as f64) as i32
}

/// 24 valid bits left-justified in a 32-bit container
fn f32_to_i24_in_i32(x: f32) -> i32 {
    ((clamp_sample(x) as f64 * 8_388_607.0) as i32) << 8
}

fn write_samples(buf: &mut [u8], samples: &[f32], kind: SampleKind) {
    match kind {
        SampleKind::F32 => {
            for (dst, s) in buf.chunks_exact_mut(4).zip(samples) {
                dst.copy_from_slice(&clamp_sample(*s).to_le_bytes());
            }
        }
        SampleKind::S32 => {
            for (dst, s) in buf.chunks_exact_mut(4).zip(samples) {
                dst.copy_from_slice(&f32_to_i32(*s).to_le_bytes());
            }
        }
        SampleKind::S24 => {
            for (dst, s) in buf.chunks_exact_mut(4).zip(samples) {
                dst.copy_from_slice(&f32_to_i24_in_i32(*s).to_le_bytes());
            }
        }
        SampleKind::S16 => {
            for (dst, s) in buf.chunks_exact_mut(2).zip(samples) {
                dst.copy_from_slice(&f32_to_i16(*s).to_le_bytes());
            }
        }
    }
}

/// what went wrong on the render thread, polled by the engine every tick
pub struct ExclusiveHealth {
    active: AtomicBool,
    reason: Mutex<Option<String>>,
}

impl ExclusiveHealth {
    fn new() -> Self {
        Self {
            active: AtomicBool::new(false),
            reason: Mutex::new(None),
        }
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }

    pub fn reason(&self) -> Option<String> {
        self.reason.lock().ok().and_then(|r| r.clone())
    }

    fn fail(&self, reason: String) {
        if let Ok(mut r) = self.reason.lock() {
            *r = Some(reason);
        }
        self.active.store(false, Ordering::Release);
    }
}

enum SinkCmd {
    Source(Box<dyn Source<Item = f32> + Send>),
    Shutdown,
}

pub struct WasapiExclusiveSink {
    cmd_tx: Sender<SinkCmd>,
    stop: Arc<AtomicBool>,
    health: Arc<ExclusiveHealth>,
    format: NegotiatedFormat,
    thread: Option<JoinHandle<()>>,
}

impl WasapiExclusiveSink {
    /// `endpoint_id` is a WASAPI endpoint id (`{0.0.0.00000000}.{...}`), which
    /// is exactly cpal's device id string on Windows. `None` = default endpoint.
    pub fn open(
        endpoint_id: Option<String>,
        sample_rate: u32,
        channels: u16,
    ) -> Result<Self, String> {
        let (cmd_tx, cmd_rx) = unbounded();
        let stop = Arc::new(AtomicBool::new(false));
        let health = Arc::new(ExclusiveHealth::new());
        let (result_tx, result_rx) = mpsc::channel::<Result<NegotiatedFormat, String>>();

        let thread_health = health.clone();
        let thread_stop = stop.clone();
        let thread = std::thread::Builder::new()
            .name("wasapi-exclusive".to_string())
            .spawn(move || {
                render_thread(
                    endpoint_id,
                    sample_rate,
                    channels,
                    cmd_rx,
                    thread_stop,
                    thread_health,
                    result_tx,
                );
            })
            .map_err(|e| format!("Failed to spawn exclusive render thread: {}", e))?;

        match result_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(format)) => Ok(Self {
                cmd_tx,
                stop,
                health,
                format,
                thread: Some(thread),
            }),
            Ok(Err(e)) => {
                stop.store(true, Ordering::Release);
                let _ = thread.join();
                Err(e)
            }
            Err(_) => {
                stop.store(true, Ordering::Release);
                let _ = thread.join();
                Err("Timed out opening exclusive output".to_string())
            }
        }
    }

    pub fn format(&self) -> &NegotiatedFormat {
        &self.format
    }

    pub fn health(&self) -> &Arc<ExclusiveHealth> {
        &self.health
    }

    /// hands the render thread its source, once the engine chain is built
    pub fn attach(&self, source: Box<dyn Source<Item = f32> + Send>) -> Result<(), String> {
        if source.sample_rate().get() != self.format.sample_rate {
            return Err(format!(
                "Source rate {} Hz does not match negotiated exclusive rate {} Hz",
                source.sample_rate(),
                self.format.sample_rate
            ));
        }
        if source.channels().get() != self.format.channels {
            return Err(format!(
                "Source channel count {} does not match negotiated exclusive channels {}",
                source.channels(),
                self.format.channels
            ));
        }
        self.cmd_tx
            .send(SinkCmd::Source(source))
            .map_err(|_| "Exclusive render thread is gone".to_string())
    }
}

impl Drop for WasapiExclusiveSink {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let _ = self.cmd_tx.send(SinkCmd::Shutdown);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

struct ComGuard;

impl ComGuard {
    fn init() -> Result<Self, String> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(|e| format!("CoInitializeEx failed: {}", e))?;
        }
        Ok(Self)
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

fn render_thread(
    endpoint_id: Option<String>,
    sample_rate: u32,
    channels: u16,
    cmd_rx: crossbeam::channel::Receiver<SinkCmd>,
    stop: Arc<AtomicBool>,
    health: Arc<ExclusiveHealth>,
    result_tx: mpsc::Sender<Result<NegotiatedFormat, String>>,
) {
    // COM lives for the whole render thread: the client and render pointers
    // must not outlive the apartment
    let _com = match ComGuard::init() {
        Ok(g) => g,
        Err(e) => {
            health.fail(e.clone());
            let _ = result_tx.send(Err(e));
            return;
        }
    };
    let prepared = unsafe { activate_endpoint(endpoint_id.as_deref()) };
    let (device, client) = match prepared {
        Ok(v) => v,
        Err(e) => {
            health.fail(e.clone());
            let _ = result_tx.send(Err(e));
            return;
        }
    };

    let opened = unsafe { negotiate_and_init(&client, sample_rate, channels) };
    let (kind, buffer_size, render_event) = match opened {
        Ok(v) => v,
        Err(e) => {
            drop(client);
            drop(device);
            health.fail(e.clone());
            let _ = result_tx.send(Err(e));
            return;
        }
    };

    let render = match unsafe { client.GetService::<IAudioRenderClient>() } {
        Ok(r) => r,
        Err(e) => {
            let _ = unsafe { CloseHandle(render_event) };
            drop(client);
            drop(device);
            let msg = format!("Failed to get render client: {}", e);
            health.fail(msg.clone());
            let _ = result_tx.send(Err(msg));
            return;
        }
    };

    if let Err(e) = unsafe { client.Start() } {
        let _ = unsafe { CloseHandle(render_event) };
        drop(render);
        drop(client);
        drop(device);
        let msg = format!("Failed to start exclusive stream: {}", e);
        health.fail(msg.clone());
        let _ = result_tx.send(Err(msg));
        return;
    }

    health.active.store(true, Ordering::Release);
    let _ = result_tx.send(Ok(NegotiatedFormat {
        sample_rate,
        channels,
        sample_format: kind.label().to_string(),
    }));

    let bytes_per_frame = channels as usize * (kind.container_bits() as usize / 8);
    let mut current: Option<Box<dyn Source<Item = f32> + Send>> = None;
    let mut scratch: Vec<f32> = Vec::new();

    loop {
        if stop.load(Ordering::Acquire) {
            break;
        }
        loop {
            match cmd_rx.try_recv() {
                Ok(SinkCmd::Source(s)) => current = Some(s),
                Ok(SinkCmd::Shutdown) => {
                    stop.store(true, Ordering::Release);
                    break;
                }
                Err(crossbeam::channel::TryRecvError::Empty) => break,
                Err(crossbeam::channel::TryRecvError::Disconnected) => {
                    stop.store(true, Ordering::Release);
                    break;
                }
            }
        }
        if stop.load(Ordering::Acquire) {
            break;
        }

        let wait = unsafe { WaitForSingleObject(render_event, 50) };
        if wait == WAIT_TIMEOUT {
            continue;
        }
        if wait != WAIT_OBJECT_0 {
            health.fail("Exclusive render event wait failed".to_string());
            break;
        }

        let padding = match unsafe { client.GetCurrentPadding() } {
            Ok(p) => p,
            Err(e) => {
                health.fail(format!("Exclusive stream lost: {}", e));
                break;
            }
        };
        let avail = buffer_size.saturating_sub(padding);
        if avail == 0 {
            continue;
        }
        // cap so a long stall never asks for a huge buffer
        let frames = avail.min(2048);
        let buffer_ptr = match unsafe { render.GetBuffer(frames) } {
            Ok(p) => p,
            Err(e) => {
                health.fail(format!("Failed to get exclusive buffer: {}", e));
                break;
            }
        };

        let sample_count = frames as usize * channels as usize;
        scratch.clear();
        scratch.reserve(sample_count);
        let mut ended = false;
        for _ in 0..sample_count {
            match current.as_mut() {
                Some(src) => match src.next() {
                    Some(s) => scratch.push(clamp_sample(s)),
                    None => {
                        ended = true;
                        break;
                    }
                },
                None => break,
            }
        }
        if ended {
            // track ended: keep the stream alive with silence so the engine
            // controls the transition, it owns the next source
            current = None;
            scratch.resize(sample_count, 0.0);
        }

        let bytes = unsafe {
            std::slice::from_raw_parts_mut(buffer_ptr, frames as usize * bytes_per_frame)
        };
        if scratch.len() == sample_count {
            write_samples(bytes, &scratch, kind);
        } else {
            bytes.fill(0);
        }

        if let Err(e) = unsafe { render.ReleaseBuffer(frames, 0) } {
            health.fail(format!("Failed to release exclusive buffer: {}", e));
            break;
        }
    }

    unsafe {
        let _ = client.Stop();
        let _ = client.Reset();
    }
    let _ = unsafe { CloseHandle(render_event) };
    drop(render);
    drop(client);
    drop(device);
    health.active.store(false, Ordering::Release);
}

unsafe fn activate_endpoint(
    endpoint_id: Option<&str>,
) -> Result<(IMMDevice, IAudioClient), String> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&CLSID_MM_DEVICE_ENUMERATOR, None, CLSCTX_ALL)
                .map_err(|e| format!("Failed to create MMDeviceEnumerator: {}", e))?;

        let device = match endpoint_id {
            Some(id) => {
                let wide = HSTRING::from(id);
                enumerator
                    .GetDevice(PCWSTR(wide.as_ptr()))
                    .map_err(|e| format!("Failed to open output endpoint: {}", e))?
            }
            None => enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .map_err(|e| format!("Failed to get default output endpoint: {}", e))?,
        };

        let client: IAudioClient = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Failed to activate IAudioClient: {}", e))?;
        Ok((device, client))
    }
}

unsafe fn negotiate_and_init(
    client: &IAudioClient,
    sample_rate: u32,
    channels: u16,
) -> Result<(SampleKind, u32, HANDLE), String> {
    unsafe {
        let mut min_period: i64 = 0;
        client
            .GetDevicePeriod(None, Some(&mut min_period))
            .map_err(|e| format!("Failed to read device period: {}", e))?;
        let buffer_duration =
            (min_period * 4).max(20 * HNS_PER_MS).min(200 * HNS_PER_MS);

        let mut chosen: Option<(SampleKind, WAVEFORMATEXTENSIBLE)> = None;
        for kind in [SampleKind::F32, SampleKind::S32, SampleKind::S24] {
            let wf = make_extensible(sample_rate, channels, kind);
            let hr = client.IsFormatSupported(
                AUDCLNT_SHAREMODE_EXCLUSIVE,
                &wf.Format as *const WAVEFORMATEX,
                None,
            );
            if hr.0 == 0 {
                chosen = Some((kind, wf));
                break;
            }
        }

        let (kind, wf) = match chosen {
            Some(v) => v,
            None => {
                // last resort: 16-bit, plain header for mono/stereo
                let wf = make_extensible(sample_rate, channels, SampleKind::S16);
                let hr = client.IsFormatSupported(
                    AUDCLNT_SHAREMODE_EXCLUSIVE,
                    &wf.Format as *const WAVEFORMATEX,
                    None,
                );
                if hr.0 == 0 {
                    (SampleKind::S16, wf)
                } else if channels <= 2 {
                    let plain = make_plain_16(sample_rate, channels);
                    let hr = client.IsFormatSupported(
                        AUDCLNT_SHAREMODE_EXCLUSIVE,
                        &plain as *const WAVEFORMATEX,
                        None,
                    );
                    if hr.0 == 0 {
                        // initialize straight from the plain header
                        let event = CreateEventW(None, false, false, PCWSTR::null())
                            .map_err(|e| format!("Failed to create render event: {}", e))?;
                        client
                            .SetEventHandle(event)
                            .map_err(|e| format!("Failed to bind render event: {}", e))?;
                        client
                            .Initialize(
                                AUDCLNT_SHAREMODE_EXCLUSIVE,
                                AUDCLNT_STREAMFLAGS_EVENTCALLBACK as u32,
                                buffer_duration,
                                0,
                                &plain as *const WAVEFORMATEX,
                                None,
                            )
                            .map_err(|e| format!("Exclusive Initialize failed: {}", e))?;
                        let size = client
                            .GetBufferSize()
                            .map_err(|e| format!("Failed to read buffer size: {}", e))?;
                        return Ok((SampleKind::S16, size, event));
                    }
                    return Err(format!(
                        "Device does not accept exact {} Hz / {} ch exclusive",
                        sample_rate, channels
                    ));
                } else {
                    return Err(format!(
                        "Device does not accept exact {} Hz / {} ch exclusive",
                        sample_rate, channels
                    ));
                }
            }
        };

        let event = CreateEventW(None, false, false, PCWSTR::null())
            .map_err(|e| format!("Failed to create render event: {}", e))?;

        let init = client.Initialize(
            AUDCLNT_SHAREMODE_EXCLUSIVE,
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK as u32,
            buffer_duration,
            0,
            &wf.Format as *const WAVEFORMATEX,
            None,
        );
        if let Err(e) = init {
            let _ = CloseHandle(event);
            return Err(format!("Exclusive Initialize failed: {}", e));
        }
        if let Err(e) = client.SetEventHandle(event) {
            let _ = CloseHandle(event);
            return Err(format!("Failed to bind render event: {}", e));
        }
        let size = client
            .GetBufferSize()
            .map_err(|e| format!("Failed to read buffer size: {}", e))?;
        Ok((kind, size, event))
    }
}

/// best-effort explicit silence fill, kept for the no-source case
#[allow(dead_code)]
fn silence(dst: &mut [u8]) {
    dst.fill(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversions_clamp_and_scale() {
        assert_eq!(f32_to_i16(2.0), i16::MAX);
        assert_eq!(f32_to_i16(-2.0), i16::MIN);
        assert_eq!(f32_to_i16(0.0), 0);
        assert_eq!(f32_to_i32(2.0), i32::MAX);
        assert_eq!(f32_to_i32(0.0), 0);
        assert_eq!(f32_to_i24_in_i32(2.0), i32::MAX & !0xFF);
        assert_eq!(f32_to_i24_in_i32(0.0), 0);
    }

    #[test]
    fn masks_cover_common_layouts() {
        assert_eq!(channel_mask_for(2), 0x3);
        assert_eq!(channel_mask_for(6), 0x3F);
        assert_eq!(channel_mask_for(9), 0);
    }

    #[test]
    fn extensible_header_is_consistent() {
        let wf = make_extensible(96_000, 2, SampleKind::S24);
        // both structs are packed: copy each field by value, never take a reference
        let n_samples_per_sec = wf.Format.nSamplesPerSec;
        let n_block_align = wf.Format.nBlockAlign;
        let n_avg_bytes_per_sec = wf.Format.nAvgBytesPerSec;
        let w_bits_per_sample = wf.Format.wBitsPerSample;
        let w_format_tag = wf.Format.wFormatTag;
        let valid_bits = unsafe { wf.Samples.wValidBitsPerSample };
        assert_eq!(n_samples_per_sec, 96_000);
        assert_eq!(n_block_align, 8);
        assert_eq!(n_avg_bytes_per_sec, 96_000 * 8);
        assert_eq!(w_bits_per_sample, 32);
        assert_eq!(valid_bits, 24);
        assert_eq!(w_format_tag, WAVE_FORMAT_EXTENSIBLE);
    }
}
