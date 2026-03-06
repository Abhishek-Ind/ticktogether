// Run with: node generate-icons.js
// Generates icon-192.png and icon-512.png matching the app's purple theme
import { PNG } from "pngjs";
import { writeFileSync } from "fs";

function drawIcon(size) {
  const png = new PNG({ width: size, height: size, colorType: 2 });
  const r = size / 2;
  const cornerRadius = size * 0.22;

  // Purple gradient: top-right #7b6be8 → bottom-left #4f35d6
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 3;

      // Rounded rect mask
      const inCorner = isInRoundedRect(x, y, size, size, cornerRadius);
      if (!inCorner) {
        // Transparent — write white (will be outside when maskable)
        png.data[idx] = 255;
        png.data[idx + 1] = 255;
        png.data[idx + 2] = 255;
        continue;
      }

      // Diagonal gradient (160deg ≈ top-right to bottom-left)
      const t = (x / size + (size - y) / size) / 2;
      // #5f47dd → #9e92e8
      const rC = Math.round(0x5f + (0x9e - 0x5f) * t);
      const gC = Math.round(0x47 + (0x92 - 0x47) * t);
      const bC = Math.round(0xdd + (0xe8 - 0xdd) * t);

      png.data[idx] = rC;
      png.data[idx + 1] = gC;
      png.data[idx + 2] = bC;
    }
  }

  // Draw clock circle
  const clockR = r - size * 0.16;
  const clockCy = r + size * 0.04;
  const lineW = size * 0.07;
  drawCircle(png, size, r, clockCy, clockR, lineW, [255, 255, 255]);

  // Minute hand: center → ~12 o'clock
  const handW = size * 0.065;
  const minuteLen = clockR * 0.55;
  drawLine(png, size, r, clockCy, r, clockCy - minuteLen, handW, [255, 255, 255]);

  // Hour hand: center → ~3-4 o'clock area
  const hourEndX = r + clockR * 0.38;
  const hourEndY = clockCy + clockR * 0.22;
  drawLine(png, size, r, clockCy, hourEndX, hourEndY, handW, [255, 255, 255]);

  return PNG.sync.write(png);
}

function isInRoundedRect(x, y, w, h, radius) {
  if (x < 0 || x >= w || y < 0 || y >= h) return false;
  const cx = x < radius ? radius : x > w - radius ? w - radius : x;
  const cy = y < radius ? radius : y > h - radius ? h - radius : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function setPixel(png, size, px, py, color) {
  const x = Math.round(px);
  const y = Math.round(py);
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  // Only paint if inside rounded rect
  if (!isInRoundedRect(x, y, size, size, size * 0.22)) return;
  const idx = (y * size + x) * 3;
  png.data[idx] = color[0];
  png.data[idx + 1] = color[1];
  png.data[idx + 2] = color[2];
}

function drawCircle(png, size, cx, cy, radius, lineWidth, color) {
  const steps = Math.ceil(2 * Math.PI * radius * 4);
  const hw = lineWidth / 2;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const bx = cx + Math.cos(angle) * radius;
    const by = cy + Math.sin(angle) * radius;
    for (let dy = -hw; dy <= hw; dy++) {
      for (let dx = -hw; dx <= hw; dx++) {
        if (dx * dx + dy * dy <= hw * hw) {
          setPixel(png, size, bx + dx, by + dy, color);
        }
      }
    }
  }
}

function drawLine(png, size, x1, y1, x2, y2, lineWidth, color) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return;
  const steps = Math.ceil(len * 4);
  const hw = lineWidth / 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const bx = x1 + dx * t;
    const by = y1 + dy * t;
    for (let oy = -hw; oy <= hw; oy++) {
      for (let ox = -hw; ox <= hw; ox++) {
        if (ox * ox + oy * oy <= hw * hw) {
          setPixel(png, size, bx + ox, by + oy, color);
        }
      }
    }
  }
}

writeFileSync("icon-192.png", drawIcon(192));
writeFileSync("icon-512.png", drawIcon(512));
console.log("Icons generated.");
