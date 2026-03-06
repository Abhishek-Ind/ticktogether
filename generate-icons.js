// Run with: node generate-icons.js
// Generates icon-192.png and icon-512.png
import { createCanvas } from "canvas";
import { writeFileSync } from "fs";

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const r = size / 2;
  const pad = size * 0.12;

  // Background
  ctx.fillStyle = "#0f0f0f";
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.22);
  ctx.fill();

  // Clock circle
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = size * 0.07;
  ctx.beginPath();
  ctx.arc(r, r + size * 0.04, r - pad - size * 0.04, 0, Math.PI * 2);
  ctx.stroke();

  // Clock hands
  ctx.lineCap = "round";
  ctx.lineWidth = size * 0.065;
  // minute hand (pointing to ~12)
  ctx.beginPath();
  ctx.moveTo(r, r + size * 0.04);
  ctx.lineTo(r, r + size * 0.04 - (r - pad) * 0.55);
  ctx.stroke();
  // hour hand (pointing to ~3)
  ctx.beginPath();
  ctx.moveTo(r, r + size * 0.04);
  ctx.lineTo(r + (r - pad) * 0.38, r + size * 0.04 + (r - pad) * 0.22);
  ctx.stroke();

  return canvas.toBuffer("image/png");
}

writeFileSync("icon-192.png", drawIcon(192));
writeFileSync("icon-512.png", drawIcon(512));
console.log("Icons generated.");
