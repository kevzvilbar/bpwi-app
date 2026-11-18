const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 380" width="100%" height="100%">
  <style>
    @media (max-width: 140px) {
      .logo-text { display: none; }
    }
  </style>
  <defs>
    <clipPath id="inner-badge">
      <rect x="16" y="14" width="468" height="352" rx="22" ry="22" />
    </clipPath>
  </defs>

  <!-- Outer White Rounded Badge Frame -->
  <rect width="500" height="380" rx="36" ry="36" fill="#ffffff" stroke="rgba(0,0,0,0.06)" stroke-width="1.5" />

  <!-- Inner Artwork clipped to rounded inner rectangle -->
  <g clip-path="url(#inner-badge)">
    <!-- Top White Sky Area -->
    <rect x="16" y="14" width="468" height="352" fill="#ffffff" />

    <!-- Wave 1: Cyan / Cerulean (#03b2e1) -->
    <path d="M 16,96
             A 59.65 59.65 0 0 0 74.5,48
             A 59.65 59.65 0 0 0 191.5,48
             A 59.65 59.65 0 0 0 308.5,48
             A 59.65 59.65 0 0 0 425.5,48
             A 59.65 59.65 0 0 0 484,96
             L 484,366 L 16,366 Z"
          fill="#03b2e1" />

    <!-- Wave 2: Ocean Blue (#2474bb) -->
    <path d="M 16,186
             A 59.65 59.65 0 0 0 74.5,138
             A 59.65 59.65 0 0 0 191.5,138
             A 59.65 59.65 0 0 0 308.5,138
             A 59.65 59.65 0 0 0 425.5,138
             A 59.65 59.65 0 0 0 484,186
             L 484,366 L 16,366 Z"
          fill="#2474bb" />

    <!-- Wave 3: Deep Maritime Navy (#1c3c6d) -->
    <path d="M 16,276
             A 59.65 59.65 0 0 0 74.5,228
             A 59.65 59.65 0 0 0 191.5,228
             A 59.65 59.65 0 0 0 308.5,228
             A 59.65 59.65 0 0 0 425.5,228
             A 59.65 59.65 0 0 0 484,276
             L 484,366 L 16,366 Z"
          fill="#1c3c6d" />

    <!-- Authentic Brand Typography in Navy Base -->
    <text class="logo-text"
          x="446" y="328"
          text-anchor="end"
          fill="#ffffff"
          font-family="Georgia, 'Times New Roman', serif"
          font-size="28"
          font-weight="600"
          letter-spacing="0.4">BP Waterworks, Inc.</text>
  </g>
</svg>`;

async function main() {
  const publicDir = path.join(__dirname, '..', 'public');

  // 1. Write public/bpwi-logo.svg
  fs.writeFileSync(path.join(publicDir, 'bpwi-logo.svg'), svgContent, 'utf-8');
  console.log('Created public/bpwi-logo.svg');

  const svgBuffer = Buffer.from(svgContent);

  // 2. Write public/bpwi-logo.png (crisp 1000x760 high-resolution transparent PNG)
  await sharp(svgBuffer)
    .resize(1000, 760)
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(path.join(publicDir, 'bpwi-logo.png'));
  console.log('Created public/bpwi-logo.png');

  // 3. Write public/icon-192.png (PWA icon, 192x192 with clean padding)
  await sharp(svgBuffer)
    .resize(180, 137, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: 27,
      bottom: 28,
      left: 6,
      right: 6,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toFile(path.join(publicDir, 'icon-192.png'));
  console.log('Created public/icon-192.png');

  // 4. Write public/icon-512.png (PWA icon, 512x512 with clean padding)
  await sharp(svgBuffer)
    .resize(480, 365, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: 73,
      bottom: 74,
      left: 16,
      right: 16,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toFile(path.join(publicDir, 'icon-512.png'));
  console.log('Created public/icon-512.png');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
