/**
 * Mintx — Screenshot Capture
 *
 * Captures the visible viewport using chrome.tabs API (from service worker)
 * or OffscreenDocument for processing.
 *
 * Returns a base64 data URL (image/png).
 */

/**
 * Capture the visible tab as a PNG data URL.
 * Must be called from the service worker (background context).
 *
 * @param {number} tabId
 * @returns {Promise<string>} base64 data URL
 */
export async function captureVisibleTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: 'png',
    quality: 90
  });
  return dataUrl;
}

/**
 * Convert a data URL to an ImageData object for pixel-level processing.
 * Uses OffscreenCanvas (available in service workers and content scripts).
 *
 * @param {string} dataUrl — base64 PNG data URL
 * @param {number} [maxWidth=1280] — downscale for performance
 * @returns {Promise<{ imageData: ImageData, canvas: OffscreenCanvas, width: number, height: number }>}
 */
export async function dataUrlToImageData(dataUrl, maxWidth = 1280) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  // Downscale if needed (saves compute for vision model + redaction)
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  bitmap.close();

  return { imageData, canvas, ctx, width, height, scale };
}

/**
 * Convert an OffscreenCanvas back to a base64 data URL.
 *
 * @param {OffscreenCanvas} canvas
 * @param {string} [type='image/png']
 * @param {number} [quality=0.9]
 * @returns {Promise<string>}
 */
export async function canvasToDataUrl(canvas, type = 'image/png', quality = 0.9) {
  const blob = await canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}
