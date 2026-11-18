const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

function makeWavePath(peakY, troughY, baseY) {
  let d = 'M 0,' + troughY + ' ';
  for (let i = 0; i < 4; i++) {
    const pX = 50 + i * 100;
    const tX = 100 + i * 100;
    d += 'C ' + (pX - 35) + ',' + troughY + ' ' + (pX - 6) + ',' + (peakY + 12) + ' ' + pX + ',' + peakY + ' ';
    d += 'C ' + (pX + 6) + ',' + (peakY + 12) + ' ' + (pX + 35) + ',' + troughY + ' ' + tX + ',' + troughY + ' ';
  }
  d += 'L 400,' + baseY + ' L 0,' + baseY + ' Z';
  return d;
}

// Canvas: 400 x 300 (standard 4:3 vector icon ratio)
// Official BP Waterworks 4-crest hydraulic waves
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="100%" height="100%">
  <defs>
    <clipPath id="badge-shape">
      <rect width="400" height="300" rx="36" ry="36" />
    </clipPath>
  </defs>

  <g clip-path="url(#badge-shape)">
    <!-- Top White Sky Area -->
    <rect width="400" height="300" fill="#ffffff" />

    <!-- Wave 1: Sky Cyan (#00B3E3) -->
    <path d="${makeWavePath(30, 75, 300)}" fill="#00B3E3" />

    <!-- Wave 2: Ocean Blue (#0074C8) -->
    <path d="${makeWavePath(95, 140, 300)}" fill="#0074C8" />

    <!-- Wave 3: Deep Maritime Navy (#103A71) -->
    <path d="${makeWavePath(160, 205, 300)}" fill="#103A71" />
  </g>

  <!-- Clean Subtle Perimeter Border -->
  <rect width="400" height="300" rx="36" ry="36" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2" />
</svg>`;

async function main() {
  const publicDir = path.join(__dirname, '..', 'public');

  // 1. Write public/bpwi-logo.svg
  fs.writeFileSync(path.join(publicDir, 'bpwi-logo.svg'), svgContent, 'utf-8');
  console.log('Created public/bpwi-logo.svg');

  const svgBuffer = Buffer.from(svgContent);

  // 2. Write public/bpwi-logo.png (crisp 1200x900 high-resolution transparent PNG)
  await sharp(svgBuffer)
    .resize(1200, 900)
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(path.join(publicDir, 'bpwi-logo.png'));
  console.log('Created public/bpwi-logo.png');

  // 3. Write public/icon-192.png (PWA icon, 192x192 with clean padding)
  await sharp(svgBuffer)
    .resize(176, 132, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: 30,
      bottom: 30,
      left: 8,
      right: 8,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toFile(path.join(publicDir, 'icon-192.png'));
  console.log('Created public/icon-192.png');

  // 4. Write public/icon-512.png (PWA icon, 512x512 with clean padding)
  await sharp(svgBuffer)
    .resize(480, 360, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: 76,
      bottom: 76,
      left: 16,
      right: 16,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toFile(path.join(publicDir, 'icon-512.png'));
  console.log('Created public/icon-512.png');
}

main().catch(console.error);
