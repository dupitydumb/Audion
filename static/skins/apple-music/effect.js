// Apple Music Dynamic 5-Blob Chromatic Fluid Mesh
let rafId = null;
let t = 0;
const blobs = [
  { x: 0.25, y: 0.3, r: 0.52, color: 'rgba(250, 36, 60, 0.28)', s: 0.0007, ph: 0 },
  { x: 0.75, y: 0.35, r: 0.58, color: 'rgba(255, 45, 85, 0.24)', s: 0.0006, ph: 2.1 },
  { x: 0.5, y: 0.75, r: 0.62, color: 'rgba(123, 44, 191, 0.22)', s: 0.0005, ph: 4.2 },
  { x: 0.85, y: 0.8, r: 0.48, color: 'rgba(255, 107, 74, 0.20)', s: 0.0008, ph: 1.2 },
  { x: 0.15, y: 0.7, r: 0.50, color: 'rgba(225, 29, 72, 0.22)', s: 0.0006, ph: 3.5 }
];

function draw() {
  t += 1;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    const cx = (b.x + Math.sin(t * b.s + b.ph) * 0.14) * w;
    const cy = (b.y + Math.cos(t * (b.s * 1.1) + b.ph) * 0.14) * h;
    const rad = b.r * Math.min(w, h);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, b.color);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  rafId = requestAnimationFrame(draw);
}
draw();
return () => { if (rafId) cancelAnimationFrame(rafId); };