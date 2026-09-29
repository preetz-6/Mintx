/**
 * Mintx — Vision Model (Transformers.js)
 *
 * Runs a lightweight vision model in-browser for:
 * 1. Image-to-text captioning (visual context summary)
 * 2. Object detection (for face detection / visual PII)
 *
 * Uses @huggingface/transformers (v3) with WebGPU backend.
 * Falls back to WASM if WebGPU unavailable.
 *
 * Models are downloaded on first use and cached in browser storage.
 */

let captionPipeline = null;
let detectionPipeline = null;
let isLoading = false;

/**
 * Initialize the vision pipelines.
 * Call this once — subsequent calls are no-ops.
 *
 * @param {Function} [onProgress] — called with { status, file, progress }
 */
export async function initVisionModel(onProgress) {
  if (captionPipeline || isLoading) return;
  isLoading = true;

  try {
    // Dynamic import — Transformers.js is loaded at runtime
    const { pipeline, env } = await import(
      /* webpackIgnore: true */
      'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3'
    );

    // Prefer WebGPU, fall back to WASM
    env.backends.onnx.wasm.wasmPaths =
      'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.0/dist/';

    // 1. Image captioning — lightweight model for vision summary
    //    ~100MB, runs well in browser
    captionPipeline = await pipeline(
      'image-to-text',
      'Xenova/vit-gpt2-image-captioning',
      {
        device: await getDevice(),
        progress_callback: onProgress || undefined
      }
    );

    // 2. Object detection — for face/person detection
    //    Using DETR-resnet-50 quantized (~40MB)
    detectionPipeline = await pipeline(
      'object-detection',
      'Xenova/detr-resnet-50',
      {
        device: await getDevice(),
        progress_callback: onProgress || undefined
      }
    );

    isLoading = false;
  } catch (err) {
    isLoading = false;
    console.error('[Mintx] Vision model init failed:', err);
    throw err;
  }
}

/**
 * Generate a text description of a screenshot.
 *
 * @param {string} imageDataUrl — base64 PNG/JPEG data URL
 * @returns {Promise<string>} natural language description
 */
export async function generateVisionSummary(imageDataUrl) {
  if (!captionPipeline) {
    console.warn('[Mintx] Vision model not loaded, using fallback');
    return null; // caller should fall back to DOM-based summary
  }

  try {
    const results = await captionPipeline(imageDataUrl, {
      max_new_tokens: 50
    });

    // Pipeline returns [{ generated_text: "..." }]
    return results[0]?.generated_text || null;
  } catch (err) {
    console.error('[Mintx] Caption generation failed:', err);
    return null;
  }
}

/**
 * Detect objects in a screenshot.
 * Returns bounding boxes for faces, persons, and other objects.
 *
 * @param {string} imageDataUrl — base64 PNG/JPEG data URL
 * @param {number} [threshold=0.7] — confidence threshold
 * @returns {Promise<Array<{ label: string, score: number, box: { xmin, ymin, xmax, ymax } }>>}
 */
export async function detectObjects(imageDataUrl, threshold = 0.7) {
  if (!detectionPipeline) {
    console.warn('[Mintx] Detection model not loaded');
    return [];
  }

  try {
    const results = await detectionPipeline(imageDataUrl, {
      threshold
    });

    return results.map(r => ({
      label: r.label,
      score: r.score,
      box: r.box // { xmin, ymin, xmax, ymax } in pixel coords
    }));
  } catch (err) {
    console.error('[Mintx] Object detection failed:', err);
    return [];
  }
}

/**
 * Detect faces/persons in a screenshot and return redaction regions.
 *
 * @param {string} imageDataUrl
 * @param {number} imageWidth — actual pixel width of the image
 * @param {number} imageHeight
 * @returns {Promise<import('./redactor.js').RedactionRegion[]>}
 */
export async function detectVisualPII(imageDataUrl, imageWidth, imageHeight) {
  const detections = await detectObjects(imageDataUrl, 0.6);
  const regions = [];

  for (const det of detections) {
    // DETR labels that represent visual PII
    if (det.label === 'person') {
      // For persons, we want to blur the face area (upper portion)
      const box = det.box;
      const faceH = (box.ymax - box.ymin) * 0.35; // top 35% = face region
      regions.push({
        x: box.xmin,
        y: box.ymin,
        w: box.xmax - box.xmin,
        h: faceH,
        category: 'FACE',
        method: 'blur',
        confidence: det.score
      });
    }
  }

  return regions;
}

/**
 * Check if WebGPU is available, fall back to WASM.
 */
async function getDevice() {
  try {
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    }
  } catch (e) {
    // WebGPU not available
  }
  return 'wasm';
}

/**
 * Check if vision models are loaded and ready.
 */
export function isVisionReady() {
  return !!captionPipeline;
}
