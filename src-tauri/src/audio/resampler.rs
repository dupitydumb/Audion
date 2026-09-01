use std::num::NonZero;
use std::time::Duration;
use rodio::Source;
use rubato::{Fft, FixedSync, Indexing, Resampler};
use rubato::audioadapter_buffers::direct::SequentialSliceOfVecs;

use super::mod_types::DecodedSource;

pub struct RubatoResampler {
    pub source:             DecodedSource,
    pub resampler:          Fft<f32>,
    pub input_buf:          Vec<Vec<f32>>,
    pub output_buf:         Vec<Vec<f32>>,
    pub output_interleaved: Vec<f32>,
    pub output_pos:         usize,
    pub chunk_size:         usize,
    pub channels:           usize,
    pub dst_rate:           NonZero<u32>,
    pub done:               bool,
}

impl RubatoResampler {
    pub fn new(source: DecodedSource, dst_rate: NonZero<u32>) -> Result<Self, String> {
        let src_rate = source.sample_rate();
        let channels = source.channels().get() as usize;

        let resampler = Fft::<f32>::new(
            src_rate.get() as usize,
            dst_rate.get() as usize,
            1024,
            1,
            channels,
            FixedSync::Both,
        )
        .map_err(|e| format!("Failed to create resampler: {}", e))?;

        let chunk_size        = resampler.input_frames_next();
        let output_frames_max = resampler.output_frames_max();

        Ok(Self {
            source,
            resampler,
            input_buf:          vec![vec![0.0f32; chunk_size]; channels],
            output_buf:         vec![vec![0.0f32; output_frames_max]; channels],
            output_interleaved: Vec::with_capacity(output_frames_max * channels),
            output_pos:         0,
            chunk_size,
            channels,
            dst_rate,
            done:               false,
        })
    }

    fn fill_input(&mut self) -> usize {
        for frame in 0..self.chunk_size {
            for ch in 0..self.channels {
                match self.source.next() {
                    Some(s) => self.input_buf[ch][frame] = s,
                    None => {
                        for pad_ch in ch..self.channels {
                            self.input_buf[pad_ch][frame] = 0.0;
                        }
                        for pad_frame in (frame + 1)..self.chunk_size {
                            for pad_ch in 0..self.channels {
                                self.input_buf[pad_ch][pad_frame] = 0.0;
                            }
                        }
                        return frame;
                    }
                }
            }
        }
        self.chunk_size
    }

    fn process_next_chunk(&mut self) -> bool {
        if self.done {
            return false;
        }

        let frames_read = self.fill_input();
        if frames_read == 0 {
            self.done = true;
            return false;
        }

        let is_last = frames_read < self.chunk_size;

        for ch in &mut self.output_buf {
            ch.fill(0.0);
        }

        let output_frames_max = self.resampler.output_frames_max();
        let input_adapter = SequentialSliceOfVecs::new(
            &self.input_buf, self.channels, self.chunk_size,
        ).map_err(|e| format!("Input adapter error: {}", e));
        let output_adapter = SequentialSliceOfVecs::new_mut(
            &mut self.output_buf, self.channels, output_frames_max,
        ).map_err(|e| format!("Output adapter error: {}", e));

        let result = match (input_adapter, output_adapter) {
            (Ok(inp), Ok(mut out)) => {
                let indexing = if is_last {
                    Some(Indexing {
                        input_offset: 0,
                        output_offset: 0,
                        active_channels_mask: None,
                        partial_len: Some(frames_read),
                    })
                } else {
                    None
                };
                self.resampler.process_into_buffer(&inp, &mut out, indexing.as_ref())
            }
            (Err(e), _) | (_, Err(e)) => {
                tracing::warn!("[AUDIO] Resampler adapter error: {}", e);
                self.done = true;
                return false;
            }
        };

        match result {
            Ok((_, out_frames)) => {
                self.output_interleaved.clear();
                for frame in 0..out_frames {
                    for ch in 0..self.channels {
                        self.output_interleaved.push(self.output_buf[ch][frame]);
                    }
                }
                self.output_pos = 0;
            }
            Err(e) => {
                tracing::warn!("[AUDIO] Resampler error: {}", e);
                self.done = true;
                return false;
            }
        }

        if frames_read < self.chunk_size {
            self.done = true;
        }

        true
    }
}

impl Iterator for RubatoResampler {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        loop {
            if self.output_pos < self.output_interleaved.len() {
                let s = self.output_interleaved[self.output_pos];
                self.output_pos += 1;
                return Some(s);
            }
            if !self.process_next_chunk() {
                return None;
            }
        }
    }
}

impl Source for RubatoResampler {
    fn current_span_len(&self) -> Option<usize> {
        let remaining = self.output_interleaved.len().saturating_sub(self.output_pos);
        if remaining > 0 { Some(remaining) } else { None }
    }
    fn channels(&self) -> NonZero<u16> {
        NonZero::new(self.channels as u16).unwrap()
    }
    fn sample_rate(&self) -> NonZero<u32> {
        self.dst_rate
    }
    fn total_duration(&self) -> Option<Duration> {
        None
    }
}
