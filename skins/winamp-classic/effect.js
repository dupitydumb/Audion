// Winamp Classic Spectrum Analyzer & VU Oscilloscope
let rafId = null;
let t = 0;
const numBars = 28;
const peaks = new Array(numBars).fill(0);
const peakHold = new Array(numBars).fill(0);

function draw() {
  t += 0.05;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Bottom dock spectrum visualizer layout
  const barWidth = Math.max(6, Math.floor(w / (numBars * 1.5)));
  const gap = Math.max(2, Math.floor(barWidth * 0.28));
  const totalWidth = numBars * (barWidth + gap);
  const startX = (w - totalWidth) / 2;
  const bottomY = h - 18;
  const maxHeight = Math.min(180, h * 0.26);

  for (let i = 0; i < numBars; i++) {
    // Dynamic simulated frequency energy with sine wave variations
    const freq = Math.sin(t * 1.8 + i * 0.32) * Math.cos(t * 0.9 - i * 0.2);
    const pulse = (Math.sin(t * 3.5 + i * 0.6) + 1) * 0.5;
    let height = Math.abs(freq * 0.7 + pulse * 0.3) * maxHeight;
    height = Math.max(6, height);

    // Peak decay logic (authentic Winamp gravity drop)
    if (height > peaks[i]) {
      peaks[i] = height;
      peakHold[i] = 22; // hold frames
    } else {
      if (peakHold[i] > 0) {
        peakHold[i]--;
      } else {
        peaks[i] = Math.max(0, peaks[i] - 1.8);
      }
    }

    const x = startX + i * (barWidth + gap);

    // Render segmented LED blocks
    const blockSize = 4;
    const blockGap = 1.5;
    const blocks = Math.floor(height / (blockSize + blockGap));

    for (let b = 0; b < blocks; b++) {
      const by = bottomY - b * (blockSize + blockGap);
      const ratio = b / (maxHeight / (blockSize + blockGap));

      // Classic Winamp LED colors: Green -> Yellow -> Red
      if (ratio > 0.82) {
        ctx.fillStyle = '#ff2222'; // Peak Red
      } else if (ratio > 0.60) {
        ctx.fillStyle = '#ffcc00'; // Mid Yellow
      } else {
        ctx.fillStyle = '#00ff41'; // Base Neon Green
      }
      ctx.fillRect(x, by, barWidth, blockSize);
    }

    // Render floating peak cap
    const peakY = bottomY - peaks[i];
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, peakY, barWidth, 2);
  }

  // Vintage green oscilloscope line across top
  ctx.strokeStyle = 'rgba(0, 255, 65, 0.28)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const oscY = h - 210;
  for (let ox = 0; ox < w; ox += 8) {
    const wave = Math.sin(ox * 0.02 + t * 4) * Math.cos(ox * 0.01 - t * 2) * 14;
    if (ox === 0) ctx.moveTo(ox, oscY + wave);
    else ctx.lineTo(ox, oscY + wave);
  }
  ctx.stroke();

  rafId = requestAnimationFrame(draw);
}
draw();
return () => { if (rafId) cancelAnimationFrame(rafId); };