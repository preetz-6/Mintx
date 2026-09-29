// utils/uuid.js
function v4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}

// core/context-builder.js
function buildSanitizedContext({
  userIntent,
  pageDomain,
  domElements,
  visionSummary,
  availableTokens,
  actionHistory,
  screenshotBase64 = null
}) {
  const context = {
    request_id: `req_${v4().slice(0, 6)}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    user_intent: userIntent,
    page_domain: pageDomain,
    dom_elements: domElements.map((el) => ({
      element_id: el.element_id,
      tag: el.tag,
      type: el.type,
      role: el.role,
      label: el.label,
      placeholder: el.placeholder,
      current_value_token: el.current_value_token || null
    })),
    vision_summary: visionSummary,
    available_tokens: availableTokens,
    action_history: actionHistory.slice(-10)
    // keep last 10 actions
  };
  if (screenshotBase64) {
    context.screenshot_base64 = screenshotBase64;
  }
  return context;
}

// core/screenshot.js
async function captureVisibleTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png",
    quality: 90
  });
  return dataUrl;
}
async function dataUrlToImageData(dataUrl, maxWidth = 1280) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  bitmap.close();
  return { imageData, canvas, ctx, width, height, scale };
}
async function canvasToDataUrl(canvas, type = "image/png", quality = 0.9) {
  const blob = await canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// core/vision-model.js
var captionPipeline = null;
var detectionPipeline = null;
var isLoading = false;
async function initVisionModel(onProgress) {
  if (captionPipeline || isLoading) return;
  isLoading = true;
  try {
    const { pipeline, env } = await import(
      /* webpackIgnore: true */
      "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3"
    );
    env.backends.onnx.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.0/dist/";
    captionPipeline = await pipeline(
      "image-to-text",
      "Xenova/vit-gpt2-image-captioning",
      {
        device: await getDevice(),
        progress_callback: onProgress || void 0
      }
    );
    detectionPipeline = await pipeline(
      "object-detection",
      "Xenova/detr-resnet-50",
      {
        device: await getDevice(),
        progress_callback: onProgress || void 0
      }
    );
    isLoading = false;
  } catch (err) {
    isLoading = false;
    console.error("[Mintx] Vision model init failed:", err);
    throw err;
  }
}
async function generateVisionSummary(imageDataUrl) {
  if (!captionPipeline) {
    console.warn("[Mintx] Vision model not loaded, using fallback");
    return null;
  }
  try {
    const results = await captionPipeline(imageDataUrl, {
      max_new_tokens: 50
    });
    return results[0]?.generated_text || null;
  } catch (err) {
    console.error("[Mintx] Caption generation failed:", err);
    return null;
  }
}
async function detectObjects(imageDataUrl, threshold = 0.7) {
  if (!detectionPipeline) {
    console.warn("[Mintx] Detection model not loaded");
    return [];
  }
  try {
    const results = await detectionPipeline(imageDataUrl, {
      threshold
    });
    return results.map((r) => ({
      label: r.label,
      score: r.score,
      box: r.box
      // { xmin, ymin, xmax, ymax } in pixel coords
    }));
  } catch (err) {
    console.error("[Mintx] Object detection failed:", err);
    return [];
  }
}
async function detectVisualPII(imageDataUrl, imageWidth, imageHeight) {
  const detections = await detectObjects(imageDataUrl, 0.6);
  const regions = [];
  for (const det of detections) {
    if (det.label === "person") {
      const box = det.box;
      const faceH = (box.ymax - box.ymin) * 0.35;
      regions.push({
        x: box.xmin,
        y: box.ymin,
        w: box.xmax - box.xmin,
        h: faceH,
        category: "FACE",
        method: "blur",
        confidence: det.score
      });
    }
  }
  return regions;
}
async function getDevice() {
  try {
    if (typeof navigator !== "undefined" && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return "webgpu";
    }
  } catch (e) {
  }
  return "wasm";
}
function isVisionReady() {
  return !!captionPipeline;
}

// core/redactor.js
function applyRedactions(canvas, ctx, regions) {
  const applied = [];
  for (const region of regions) {
    const method = region.method || getDefaultMethod(region.category);
    switch (method) {
      case "blackout":
        redactBlackout(ctx, region);
        break;
      case "blur":
        redactBlur(ctx, region);
        break;
      case "pixelate":
        redactPixelate(ctx, region);
        break;
      case "mask":
        redactMask(ctx, region);
        break;
      default:
        redactBlackout(ctx, region);
    }
    applied.push({ ...region, method });
  }
  return applied;
}
function getDefaultMethod(category) {
  const defaults = {
    "FACE": "blur",
    "PASSWORD": "blackout",
    "CREDIT_CARD": "blackout",
    "SSN": "blackout",
    "AADHAAR": "blackout",
    "PAN": "blackout",
    "EMAIL": "mask",
    "PHONE": "mask",
    "NAME": "mask",
    "ADDRESS": "mask"
  };
  return defaults[category] || "blackout";
}
function redactBlackout(ctx, region) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(region.x, region.y, region.w, region.h);
}
function redactBlur(ctx, region) {
  const { x, y, w, h } = region;
  const cx = Math.max(0, Math.round(x));
  const cy = Math.max(0, Math.round(y));
  const cw = Math.min(Math.round(w), ctx.canvas.width - cx);
  const ch = Math.min(Math.round(h), ctx.canvas.height - cy);
  if (cw <= 0 || ch <= 0) return;
  const imageData = ctx.getImageData(cx, cy, cw, ch);
  const data = imageData.data;
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
      let r = 0, g = 0, b = 0, count = 0;
      const maxBY = Math.min(by + blockSize, ch);
      const maxBX = Math.min(bx + blockSize, cw);
      for (let py = by; py < maxBY; py++) {
        for (let px = bx; px < maxBX; px++) {
          const i = (py * cw + px) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
      }
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      for (let py = by; py < maxBY; py++) {
        for (let px = bx; px < maxBX; px++) {
          const i = (py * cw + px) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
        }
      }
    }
  }
  ctx.putImageData(imageData, cx, cy);
}
function redactMask(ctx, region) {
  const colors = {
    "EMAIL": "rgba(108, 92, 231, 0.85)",
    "PHONE": "rgba(0, 214, 143, 0.85)",
    "NAME": "rgba(255, 121, 198, 0.85)",
    "ADDRESS": "rgba(255, 192, 72, 0.85)",
    "DEFAULT": "rgba(100, 100, 100, 0.85)"
  };
  const color = colors[region.category] || colors["DEFAULT"];
  ctx.fillStyle = color;
  ctx.fillRect(region.x, region.y, region.w, region.h);
  const fontSize = Math.max(10, Math.min(14, region.h * 0.6));
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `[${region.category}]`,
    region.x + region.w / 2,
    region.y + region.h / 2
  );
}
function boxBlurH(data, w, h, radius) {
  const iarr = 1 / (radius + radius + 1);
  for (let y = 0; y < h; y++) {
    let ti = y * w * 4;
    let li = ti;
    let ri = ti + radius * 4;
    const fv = [data[ti], data[ti + 1], data[ti + 2], data[ti + 3]];
    const lv = [
      data[ti + (w - 1) * 4],
      data[ti + (w - 1) * 4 + 1],
      data[ti + (w - 1) * 4 + 2],
      data[ti + (w - 1) * 4 + 3]
    ];
    const val = [
      fv[0] * (radius + 1),
      fv[1] * (radius + 1),
      fv[2] * (radius + 1),
      fv[3] * (radius + 1)
    ];
    for (let j = 0; j < radius; j++) {
      const idx = Math.min(j, w - 1) * 4 + ti;
      val[0] += data[idx];
      val[1] += data[idx + 1];
      val[2] += data[idx + 2];
      val[3] += data[idx + 3];
    }
    for (let j = 0; j <= radius; j++) {
      const idx = Math.min(j + radius, w - 1) * 4 + ti;
      val[0] += data[idx] - fv[0];
      val[1] += data[idx + 1] - fv[1];
      val[2] += data[idx + 2] - fv[2];
      val[3] += data[idx + 3] - fv[3];
      data[ti] = Math.round(val[0] * iarr);
      data[ti + 1] = Math.round(val[1] * iarr);
      data[ti + 2] = Math.round(val[2] * iarr);
      data[ti + 3] = Math.round(val[3] * iarr);
      ti += 4;
    }
    for (let j = radius + 1; j < w - radius; j++) {
      val[0] += data[ri] - data[li];
      val[1] += data[ri + 1] - data[li + 1];
      val[2] += data[ri + 2] - data[li + 2];
      val[3] += data[ri + 3] - data[li + 3];
      data[ti] = Math.round(val[0] * iarr);
      data[ti + 1] = Math.round(val[1] * iarr);
      data[ti + 2] = Math.round(val[2] * iarr);
      data[ti + 3] = Math.round(val[3] * iarr);
      ri += 4;
      li += 4;
      ti += 4;
    }
    for (let j = w - radius; j < w; j++) {
      val[0] += lv[0] - data[li];
      val[1] += lv[1] - data[li + 1];
      val[2] += lv[2] - data[li + 2];
      val[3] += lv[3] - data[li + 3];
      data[ti] = Math.round(val[0] * iarr);
      data[ti + 1] = Math.round(val[1] * iarr);
      data[ti + 2] = Math.round(val[2] * iarr);
      data[ti + 3] = Math.round(val[3] * iarr);
      li += 4;
      ti += 4;
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
      fv[0] * (radius + 1),
      fv[1] * (radius + 1),
      fv[2] * (radius + 1),
      fv[3] * (radius + 1)
    ];
    for (let j = 0; j < radius; j++) {
      const idx = ti + Math.min(j, h - 1) * w * 4;
      val[0] += data[idx];
      val[1] += data[idx + 1];
      val[2] += data[idx + 2];
      val[3] += data[idx + 3];
    }
    for (let j = 0; j <= radius; j++) {
      const idx = ti + Math.min(j + radius, h - 1) * w * 4;
      val[0] += data[idx] - fv[0];
      val[1] += data[idx + 1] - fv[1];
      val[2] += data[idx + 2] - fv[2];
      val[3] += data[idx + 3] - fv[3];
      data[ti] = Math.round(val[0] * iarr);
      data[ti + 1] = Math.round(val[1] * iarr);
      data[ti + 2] = Math.round(val[2] * iarr);
      data[ti + 3] = Math.round(val[3] * iarr);
      ti += w * 4;
    }
    for (let j = radius + 1; j < h - radius; j++) {
      val[0] += data[ri] - data[li];
      val[1] += data[ri + 1] - data[li + 1];
      val[2] += data[ri + 2] - data[li + 2];
      val[3] += data[ri + 3] - data[li + 3];
      data[ti] = Math.round(val[0] * iarr);
      data[ti + 1] = Math.round(val[1] * iarr);
      data[ti + 2] = Math.round(val[2] * iarr);
      data[ti + 3] = Math.round(val[3] * iarr);
      ri += w * 4;
      li += w * 4;
      ti += w * 4;
    }
    for (let j = h - radius; j < h; j++) {
      val[0] += lv[0] - data[li];
      val[1] += lv[1] - data[li + 1];
      val[2] += lv[2] - data[li + 2];
      val[3] += lv[3] - data[li + 3];
      data[ti] = Math.round(val[0] * iarr);
      data[ti + 1] = Math.round(val[1] * iarr);
      data[ti + 2] = Math.round(val[2] * iarr);
      data[ti + 3] = Math.round(val[3] * iarr);
      li += w * 4;
      ti += w * 4;
    }
  }
}

// background/service-worker.js
var SERVER_URL = "http://localhost:8000";
var visionInitialized = false;
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_TASK") {
    handleTask(msg.payload.userIntent);
    sendResponse({ status: "started" });
  }
  if (msg.type === "INIT_VISION") {
    initVision();
    sendResponse({ status: "initializing" });
  }
  return true;
});
async function initVision() {
  if (visionInitialized) return;
  broadcast("AGENT_LOG", { message: "Loading vision models (first-time download)...", level: "info" });
  broadcast("AGENT_STATUS", { text: "Loading AI", state: "running" });
  try {
    await initVisionModel((progress) => {
      if (progress.status === "progress" && progress.progress) {
        broadcast("AGENT_LOG", {
          message: `Downloading ${progress.file}: ${Math.round(progress.progress)}%`,
          level: "info"
        });
      }
    });
    visionInitialized = true;
    broadcast("AGENT_LOG", { message: "Vision models loaded \u2713", level: "success" });
    broadcast("AGENT_STATUS", { text: "Ready", state: "success" });
  } catch (err) {
    broadcast("AGENT_LOG", { message: `Vision model failed: ${err.message}`, level: "error" });
    broadcast("AGENT_STATUS", { text: "Vision Error", state: "error" });
  }
}
async function handleTask(userIntent) {
  const actionHistory = [];
  let taskComplete = false;
  let iteration = 0;
  const MAX_ITERATIONS = 10;
  broadcast("AGENT_STATUS", { text: "Running", state: "running" });
  broadcast("AGENT_LOG", { message: `Starting task: "${userIntent}"`, level: "action" });
  if (!visionInitialized) {
    await initVision();
  }
  while (!taskComplete && iteration < MAX_ITERATIONS) {
    iteration++;
    broadcast("AGENT_LOG", { message: `\u2500\u2500 Loop ${iteration} \u2500\u2500`, level: "info" });
    try {
      const tab = await getActiveTab();
      broadcast("AGENT_LOG", { message: "Capturing screenshot...", level: "info" });
      let screenshotDataUrl = null;
      let redactedScreenshot = null;
      try {
        screenshotDataUrl = await captureVisibleTab(tab.id);
      } catch (err) {
        broadcast("AGENT_LOG", { message: `Screenshot capture failed: ${err.message}`, level: "warn" });
      }
      const observation = await sendToContentScript(tab.id, {
        type: "OBSERVE",
        payload: {}
      });
      if (!observation) {
        broadcast("AGENT_LOG", { message: "No observation returned from page", level: "error" });
        break;
      }
      let visionSummary = observation.visionSummary;
      if (screenshotDataUrl) {
        if (isVisionReady()) {
          broadcast("AGENT_LOG", { message: "Running vision model...", level: "info" });
          const aiSummary = await generateVisionSummary(screenshotDataUrl);
          if (aiSummary) {
            visionSummary = `${aiSummary}. DOM context: ${observation.visionSummary}`;
          }
        }
        broadcast("AGENT_LOG", { message: "Scanning for visual PII...", level: "pii" });
        const { imageData, canvas, ctx, width, height, scale } = await dataUrlToImageData(screenshotDataUrl);
        const visualPIIRegions = isVisionReady() ? await detectVisualPII(screenshotDataUrl, width, height) : [];
        const domPIIRegions = observation.piiRegions || [];
        const allRegions = [...visualPIIRegions, ...domPIIRegions];
        if (allRegions.length > 0) {
          broadcast("AGENT_LOG", {
            message: `Redacting ${allRegions.length} PII regions (${visualPIIRegions.length} visual, ${domPIIRegions.length} DOM)`,
            level: "pii"
          });
          applyRedactions(canvas, ctx, allRegions);
          redactedScreenshot = await canvasToDataUrl(canvas);
        } else {
          broadcast("AGENT_LOG", { message: "No visual PII detected", level: "info" });
          redactedScreenshot = screenshotDataUrl;
        }
      }
      const context = buildSanitizedContext({
        userIntent,
        pageDomain: new URL(tab.url).hostname,
        domElements: observation.domElements,
        visionSummary,
        availableTokens: observation.availableTokens,
        actionHistory,
        screenshotBase64: redactedScreenshot || null
      });
      broadcast("AGENT_LOG", {
        message: `Context: ${context.dom_elements.length} elements, ${context.available_tokens.length} tokens${redactedScreenshot ? ", +screenshot" : ""}`,
        level: "info"
      });
      broadcast("AGENT_LOG", { message: "Sending sanitized context to server...", level: "action" });
      const plan = await sendToServer(context);
      if (!plan || !plan.actions) {
        broadcast("AGENT_LOG", { message: "Server returned no actions", level: "warn" });
        break;
      }
      broadcast("AGENT_LOG", {
        message: `Server plan: "${plan.reasoning}" (${plan.actions.length} actions)`,
        level: "action"
      });
      for (const action of plan.actions) {
        broadcast("AGENT_LOG", {
          message: `Executing: ${action.type} \u2192 ${action.target_element_id} ${action.value ? `(${action.value})` : ""}`,
          level: "action"
        });
        const result = await sendToContentScript(tab.id, {
          type: "EXECUTE_ACTION",
          payload: action
        });
        actionHistory.push({
          action_id: action.action_id,
          type: action.type,
          target: action.target_element_id,
          result: result?.status || "unknown"
        });
        if (result?.status === "success") {
          broadcast("AGENT_LOG", { message: `\u2713 ${action.action_id} succeeded`, level: "success" });
        } else {
          broadcast("AGENT_LOG", {
            message: `\u2717 ${action.action_id} failed: ${result?.error || "unknown"}`,
            level: "error"
          });
        }
      }
      taskComplete = plan.task_complete === true;
    } catch (err) {
      broadcast("AGENT_LOG", { message: `Loop error: ${err.message}`, level: "error" });
      break;
    }
  }
  const finalStatus = taskComplete ? "Done" : iteration >= MAX_ITERATIONS ? "Max loops" : "Stopped";
  const finalState = taskComplete ? "success" : "error";
  broadcast("AGENT_STATUS", { text: finalStatus, state: finalState });
  broadcast("AGENT_LOG", { message: `Agent finished: ${finalStatus}`, level: taskComplete ? "success" : "warn" });
}
async function sendToServer(sanitizedContext) {
  const res = await fetch(`${SERVER_URL}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sanitizedContext)
  });
  if (!res.ok) {
    throw new Error(`Server responded ${res.status}`);
  }
  return res.json();
}
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
function sendToContentScript(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      resolve(response);
    });
  });
}
function broadcast(type, payload) {
  chrome.runtime.sendMessage({ type, payload }).catch(() => {
  });
}
//# sourceMappingURL=service-worker.bundle.js.map
