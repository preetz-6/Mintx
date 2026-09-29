/**
 * Mintx — Visual Redaction Engine
 *
 * Applies redaction to screenshots before they leave the device.
 * Works on OffscreenCanvas — operates on pixel data directly.
 *
 * Redaction methods:
 * - blackout: solid black rectangle over region
 * - blur: gaussian-approximation blur over region
 * - pixelate: mosaic pixelation over region
 * - mask: replace region with a colored placeholder + label
 */

/**
 * @typedef {Object} RedactionRegion
 * @property {number} x - left edge (in screenshot pixels)
 * @property {number} y - top edge
 * @property {number} w - width
 * @property {number} h - height
 * @property {string} category - PII category (e.g. 'FACE', 'EMAIL', 'NAME')
 * @property {string} method - 'blackout' | 'blur' | 'pixelate' | 'mask'
 */

/**
 * Apply redactions to a canvas.
 *
 * @param {OffscreenCanvas} canvas
 * @param {CanvasRenderingContext2D} ctx
 * @param {RedactionRegion[]} regions
 * @returns {RedactionRegion[]} applied regions (for logging)
 */
export function applyRedactions(canvas, ctx, regions) {
  const applied = [];

  for (const region of regions) {
    const method = region.method || getDefaultMethod(region.category);

    switch (method) {
      case 'blackout':
        redactBlackout(ctx, region);
        break;
      case 'blur':
        redactBlur(ctx, region);
        break;
      case 'pixelate':
        redactPixelate(ctx, region);
        break;
      case 'mask':
        redactMask(ctx, region);
        break;
      default:
        redactBlackout(ctx, region); // fallback: safest option
    }

    applied.push({ ...region, method });
  }

  return applied;
}

/**
 * Default redaction method per PII category.
 */
function getDefaultMethod(category) {
  const defaults = {
    'FACE': 'blur',
    'PASSWORD': 'blackout',
    'CREDIT_CARD': 'blackout',
    'SSN': 'blackout',
    'AADHAAR': 'blackout',
    'PAN': 'blackout',
    'EMAIL': 'mask',
    'PHONE': 'mask',
    'NAME': 'mask',
    'ADDRESS': 'mask',
  };
  return defaults[category] || 'blackout';
}

// ── Redaction Methods ──

function redactBlackout(ctx, region) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(region.x, region.y, region.w, region.h);
}

function redactBlur(ctx, region) {
  // Approximate Gaussian blur using iterative box blur (3 passes)
  const { x, y, w, h } = region;

  // Clamp to canvas bounds
  const cx = Math.max(0, Math.round(x));
  const cy = Math.max(0, Math.round(y));
  const cw = Math.min(Math.round(w), ctx.canvas.width - cx);
  const ch = Math.min(Math.round(h), ctx.canvas.height - cy);

  if (cw <= 0 || ch <= 0) return;

  const imageData = ctx.getImageData(cx, cy, cw, ch);
  const data = imageData.data;

  // Box blur — 3 passes with radius proportional to region size
  const radius = Math.max(5, Math.round(Math.min(cw, ch) / 8));

  for (let pass = 0; pass < 3; pass++) {
    boxBlurH(data, cw, ch, radius);
    boxBlurV(data, cw, ch, radius);
  }

  ctx.putImageData(imageData, cx, cy);
}

function redactPixelate(ctx, region) {
  const { x, y, w, h } = region;
  const blockSize = Math.max(8, Math.round(Math.min(w, h) / 6));

  const cx = Math.max(0, Math.round(x));
  const cy = Math.max(0, Math.round(y));
  const cw = Math.min(Math.round(w), ctx.canvas.width - cx);
  const ch = Math.min(Math.round(h), ctx.canvas.height - cy);

  if (cw <= 0 || ch <= 0) return;

  const imageData = ctx.getImageData(cx, cy, cw, ch);
  const data = imageData.data;

  for (let by = 0; by < ch; by += blockSize) {
    for (let bx = 0; bx < cw; bx += blockSize) {
      // Average color of block
      let r = 0, g = 0, b = 0, count = 0;
      const maxBY = Math.min(by + blockSize, ch);
      const maxBX = Math.min(bx + blockSize, cw);

      for (let py = by; py < maxBY; py++) {
        for (let px = bx; px < maxBX; px++) {
          const i = (py * cw + px) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2];
          count++;
        }
      }

      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);

      // Fill block with average
      for (let py = by; py < maxBY; py++) {
        for (let px = bx; px < maxBX; px++) {
          const i = (py * cw + px) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b;
        }
      }
    }
  }

  ctx.putImageData(imageData, cx, cy);
}

function redactMask(ctx, region) {
  // Colored overlay with category label
  const colors = {
    'EMAIL': 'rgba(108, 92, 231, 0.85)',
    'PHONE': 'rgba(0, 214, 143, 0.85)',
    'NAME': 'rgba(255, 121, 198, 0.85)',
    'ADDRESS': 'rgba(255, 192, 72, 0.85)',
    'DEFAULT': 'rgba(100, 100, 100, 0.85)',
  };

  const color = colors[region.category] || colors['DEFAULT'];

  ctx.fillStyle = color;
  ctx.fillRect(region.x, region.y, region.w, region.h);

  // Label
  const fontSize = Math.max(10, Math.min(14, region.h * 0.6));
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    `[${region.category}]`,
    region.x + region.w / 2,
    region.y + region.h / 2
  );
}

// ── Box Blur Helpers ──

function boxBlurH(data, w, h, radius) {
  const iarr = 1 / (radius + radius + 1);
  for (let y = 0; y < h; y++) {
    let ti = y * w * 4;
    let li = ti;
    let ri = ti + radius * 4;

    const fv = [data[ti], data[ti + 1], data[ti + 2], data[ti + 3]];
    const lv = [
      data[ti + (w - 1) * 4], data[ti + (w - 1) * 4 + 1],
      data[ti + (w - 1) * 4 + 2], data[ti + (w - 1) * 4 + 3]
    ];

    const val = [
      fv[0] * (radius + 1), fv[1] * (radius + 1),
      fv[2] * (radius + 1), fv[3] * (radius + 1)
    ];

    for (let j = 0; j < radius; j++) {
      const idx = Math.min(j, w - 1) * 4 + ti;
      val[0] += data[idx]; val[1] += data[idx + 1];
      val[2] += data[idx + 2]; val[3] += data[idx + 3];
    }

    for (let j = 0; j <= radius; j++) {
      const idx = Math.min(j + radius, w - 1) * 4 + ti;
      val[0] += data[idx] - fv[0]; val[1] += data[idx + 1] - fv[1];
      val[2] += data[idx + 2] - fv[2]; val[3] += data[idx + 3] - fv[3];
      data[ti] = Math.round(val[0] * iarr);
      data[ti + 1] = Math.round(val[1] * iarr);
      data[ti + 2] = Math.round(val[2] * iarr);
      data[ti + 3] = Math.round(val[3] * iarr);
      ti += 4;
    }

    for (let j = radius + 1; j < w - radius; j++) {
      val[0] += data[ri] - data[li]; val[1] += data[ri + 1] - data[li + 1];
      val[2] += data[ri + 2] - data[li + 2]; val[3] += data[ri + 3] - data[li + 3];
      data[ti] = Math.round(val[0] * iarr);
      data[ti + 1] = Math.round(val[1] * iarr);
      data[ti + 2] = Math.round(val[2] * iarr);
      data[ti + 3] = Math.round(val[3] * iarr);
      ri += 4; li += 4; ti += 4;
    }

    for (let j = w - radius; j < w; j++) {
      val[0] += lv[0] - data[li]; val[1] += lv[1] - data[li + 1];
      val[2] += lv[2] - data[li + 2]; val[3] += lv[3] - data[li + 3];
      data[ti] = Math.round(val[0] * iarr);
      data[ti + 1] = Math.round(val[1] * iarr);
      data[ti + 2] = Math.round(val[2] * iarr);
      data[ti + 3] = Math.round(val[3] * iarr);
      li += 4; ti += 4;
    }
  }
}

function boxBlurV(data, w, h, radius) {
  const iarr = 1 / (radius + radius + 1);
  for (let x = 0; x < w; x++) {
    let ti = x * 4;
    let li = ti;
    let ri = ti + radius * w * 4;

    const fv = [data[ti], data[ti + 1], data[ti + 2], data[ti + 3]];
    const lv_idx = ti + (h - 1) * w * 4;
    const lv = [data[lv_idx], data[lv_idx + 1], data[lv_idx + 2], data[lv_idx + 3]];

    const val = [
      fv[0] * (radius + 1), fv[1] * (radius + 1),
      fv[2] * (radius + 1), fv[3] * (radius + 1)
    ];

    for (let j = 0; j < radius; j++) {
      const idx = ti + Math.min(j, h - 1) * w * 4;
      val[0] += data[idx]; val[1] += data[idx + 1];
      val[2] += data[idx + 2]; val[3] += data[idx + 3];
    }

    for (let j = 0; j <= radius; j++) {
      const idx = ti + Math.min(j + radius, h - 1) * w * 4;
      val[0] += data[idx] - fv[0]; val[1] += data[idx + 1] - fv[1];
      val[2] += data[idx + 2] - fv[2]; val[3] += data[idx + 3] - fv[3];
      data[ti] = Math.round(val[0] * iarr);
      data[ti + 1] = Math.round(val[1] * iarr);
      data[ti + 2] = Math.round(val[2] * iarr);
      data[ti + 3] = Math.round(val[3] * iarr);
      ti += w * 4;
    }

    for (let j = radius + 1; j < h - radius; j++) {
      val[0] += data[ri] - data[li]; val[1] += data[ri + 1] - data[li + 1];
      val[2] += data[ri + 2] - data[li + 2]; val[3] += data[ri + 3] - data[li + 3];
      data[ti] = Math.round(val[0] * iarr);
      data[ti + 1] = Math.round(val[1] * iarr);
      data[ti + 2] = Math.round(val[2] * iarr);
      data[ti + 3] = Math.round(val[3] * iarr);
      ri += w * 4; li += w * 4; ti += w * 4;
    }

    for (let j = h - radius; j < h; j++) {
      val[0] += lv[0] - data[li]; val[1] += lv[1] - data[li + 1];
      val[2] += lv[2] - data[li + 2]; val[3] += lv[3] - data[li + 3];
      data[ti] = Math.round(val[0] * iarr);
      data[ti + 1] = Math.round(val[1] * iarr);
      data[ti + 2] = Math.round(val[2] * iarr);
      data[ti + 3] = Math.round(val[3] * iarr);
      li += w * 4; ti += w * 4;
    }
  }
}

/**
 * Map DOM element bounding rects to screenshot pixel coordinates.
 * Accounts for devicePixelRatio and any downscale factor.
 *
 * @param {Array} domElements — with .rect { x, y, w, h }
 * @param {number} dpr — window.devicePixelRatio
 * @param {number} scale — downscale factor from dataUrlToImageData
 * @param {string[]} piiCategories — which elements are PII (from pii-detector)
 * @returns {RedactionRegion[]}
 */
export function domRectsToRedactionRegions(domElements, dpr, scale, piiCategories) {
  const regions = [];

  for (const el of domElements) {
    if (!el.rect || !el.piiCategory) continue;

    regions.push({
      x: Math.round(el.rect.x * dpr * scale),
      y: Math.round(el.rect.y * dpr * scale),
      w: Math.round(el.rect.w * dpr * scale),
      h: Math.round(el.rect.h * dpr * scale),
      category: el.piiCategory,
      method: getDefaultMethod(el.piiCategory)
    });
  }

  return regions;
}
