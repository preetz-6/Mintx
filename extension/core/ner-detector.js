/**
 * Mintx — NER-based PII Detector (Transformers.js)
 *
 * Runs a small named-entity-recognition model in-browser
 * to detect PII that regex/heuristics might miss:
 * - Person names in free text
 * - Organization names
 * - Locations/addresses
 *
 * Complements the regex+heuristic detection in pii-detector.js.
 * This module handles text-level NER; visual PII (faces) is in vision-model.js.
 */

let nerPipeline = null;
let isLoading = false;

/**
 * Initialize the NER pipeline.
 * Uses a small BERT-based NER model (~50MB quantized).
 *
 * @param {Function} [onProgress]
 */
export async function initNerModel(onProgress) {
  if (nerPipeline || isLoading) return;
  isLoading = true;

  try {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('onnxruntime/');

    nerPipeline = await pipeline(
      'token-classification',
      'Xenova/bert-base-NER',
      {
        device: 'wasm', // NER is lightweight, WASM is fine
        progress_callback: onProgress || undefined
      }
    );

    isLoading = false;
  } catch (err) {
    isLoading = false;
    console.error('[Mintx] NER model init failed:', err);
    throw err;
  }
}

/**
 * Detect named entities (PII) in a text string.
 *
 * @param {string} text — visible text content to scan
 * @returns {Promise<Array<{ entity: string, word: string, score: number, start: number, end: number }>>}
 */
export async function detectEntities(text) {
  if (!nerPipeline) {
    return []; // model not loaded — caller uses regex fallback
  }

  if (!text || text.length < 2) return [];

  try {
    const results = await nerPipeline(text, {
      ignore_labels: ['O'] // skip non-entity tokens
    });

    // Group sub-word tokens into full entities
    return mergeSubwordTokens(results);
  } catch (err) {
    console.error('[Mintx] NER detection failed:', err);
    return [];
  }
}

/**
 * Map NER entity labels to Mintx PII categories.
 *
 * BERT-NER labels: B-PER, I-PER, B-ORG, I-ORG, B-LOC, I-LOC, B-MISC, I-MISC
 */
const NER_TO_PII = {
  'PER': 'NAME',
  'LOC': 'ADDRESS',
  'ORG': 'ORG',      // organizations — might contain PII context
  'MISC': null,       // miscellaneous — skip unless relevant
};

/**
 * Merge sub-word tokens (B-/I- prefix scheme) into full entity spans.
 *
 * @param {Array} tokens — raw NER pipeline output
 * @returns {Array<{ entity: string, piiCategory: string|null, word: string, score: number, start: number, end: number }>}
 */
function mergeSubwordTokens(tokens) {
  const merged = [];
  let current = null;

  for (const token of tokens) {
    // Parse entity label: "B-PER", "I-PER", etc.
    const [prefix, label] = token.entity.includes('-')
      ? token.entity.split('-')
      : [token.entity, token.entity];

    const piiCategory = NER_TO_PII[label] || null;

    if (prefix === 'B' || !current || current.label !== label) {
      // Start of a new entity
      if (current) merged.push(current);
      current = {
        entity: token.entity,
        label,
        piiCategory,
        word: cleanToken(token.word),
        score: token.score,
        start: token.start,
        end: token.end
      };
    } else {
      // Continuation of current entity (I- prefix)
      current.word += cleanToken(token.word);
      current.end = token.end;
      current.score = Math.min(current.score, token.score); // conservative
    }
  }

  if (current) merged.push(current);

  // Filter: only return high-confidence PII entities
  return merged.filter(e => e.piiCategory && e.score > 0.5);
}

/**
 * Clean sub-word tokens (remove ## prefix from WordPiece).
 */
function cleanToken(word) {
  if (word.startsWith('##')) {
    return word.slice(2);
  }
  // If token starts without space context, add space
  return word.startsWith(' ') ? word : ` ${word}`;
}

/**
 * Scan text and return PII findings with positions,
 * ready for tokenization by DataVault.
 *
 * @param {string} text
 * @returns {Promise<Array<{ category: string, value: string, start: number, end: number, score: number }>>}
 */
export async function scanTextForPII(text) {
  const entities = await detectEntities(text);

  return entities.map(e => ({
    category: e.piiCategory,
    value: e.word.trim(),
    start: e.start,
    end: e.end,
    score: e.score
  }));
}

/**
 * Check if NER model is loaded.
 */
export function isNerReady() {
  return !!nerPipeline;
}
