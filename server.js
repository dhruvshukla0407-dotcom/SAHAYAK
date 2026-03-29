const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const ort = require('onnxruntime-node');
const sharp = require('sharp');

const telemetryService = require('./services/telemetry');
const sensorService = require('./services/sensors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const YOLO_MODEL_PATH = path.join(__dirname, 'public', 'models', 'yolov8n.onnx');
const COCO_CLASSES = ['person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'];
const HUMAN_LABELS = new Set(['person']);
const ANIMAL_LABELS = new Set(['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe']);
const YOLO_SCORE_THRESHOLD = 0.25;
const YOLO_HUMAN_ANIMAL_THRESHOLD = 0.25;
const YOLO_OTHER_THRESHOLD = 0.5;
const YOLO_IOU_THRESHOLD = 0.4;
const YOLO_MIN_BOX_AREA_RATIO = 0.0012;
const YOLO_MIN_BOX_SIDE_PX = 10;
const YOLO_MAX_DETECTIONS = 8;
const BACKEND_INFERENCE_INTERVAL_MS = 180;

const visionState = {
  session: null,
  inputName: null,
  outputNames: [],
  inputWidth: 640,
  inputHeight: 640,
  running: false,
  streamResponse: null,
  streamUrl: null,
  mjpegBuffer: Buffer.alloc(0),
  latestFrame: null,
  latestFrameAt: 0,
  lastProcessedAt: 0,
  processing: false,
  intervalHandle: null,
  lastDetections: [],
  lastDebug: 'Backend detector idle.',
};

app.use(cors());
app.use(express.json()); // Allow parsing JSON bodies
app.use(express.static('public'));
app.use('/vendor/onnxruntime-web', express.static(path.join(__dirname, 'node_modules', 'onnxruntime-web', 'dist')));

// Default route to serve login if not authenticated (handled client-side usually)
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// --- ESP32-CAM Control Proxy ---
const esp32Config = {
  baseUrl: (process.env.ESP32_CAM_URL || 'http://192.168.4.1').replace(/\/$/, ''),
  capturePath: process.env.ESP32_CAPTURE_PATH || '/capture',
  streamPath: process.env.ESP32_STREAM_PATH || '/stream',
  controlPath: process.env.ESP32_CONTROL_PATH || '/control',
};

function getEsp32ProxyStreamUrl() {
  return '/api/esp32/stream';
}

function getEsp32ProbeUrl() {
  return '/api/esp32/probe';
}

function buildEsp32Url(pathname) {
  if (/^https?:\/\//i.test(pathname)) {
    return pathname;
  }
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${esp32Config.baseUrl}${path}`;
}

function buildEsp32StreamUrl() {
  const configuredPath = (esp32Config.streamPath || '/stream').trim() || '/stream';
  if (/^https?:\/\//i.test(configuredPath)) {
    return configuredPath;
  }

  try {
    const base = new URL(esp32Config.baseUrl);
    const path = configuredPath.startsWith('/') ? configuredPath : `/${configuredPath}`;
    if (base.port === '80' || base.port === '') {
      return `${base.protocol}//${base.hostname}:81${path}`;
    }
    return `${base.protocol}//${base.host}${path}`;
  } catch (error) {
    return buildEsp32Url(configuredPath);
  }
}

function buildEsp32PrimaryStreamUrl() {
  const configuredPath = (esp32Config.streamPath || '/stream').trim() || '/stream';
  return buildEsp32Url(configuredPath);
}

function buildEsp32StreamCandidates() {
  const primaryUrl = buildEsp32PrimaryStreamUrl();
  const fallbackUrl = buildEsp32StreamUrl();
  return [...new Set([primaryUrl, fallbackUrl].filter(Boolean))];
}

function normalizeEsp32Endpoint(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function getVisionCategory(label) {
  const normalized = (label || '').toLowerCase();
  if (HUMAN_LABELS.has(normalized)) return 'Human';
  if (ANIMAL_LABELS.has(normalized)) return 'Animal';
  return 'Other';
}

function getModelInputShape(session) {
  const inputName = session?.inputNames?.[0];
  const metadata = inputName ? session?.inputMetadata?.[inputName] : null;
  const dims = metadata?.dimensions || [];
  const width = Number.isFinite(dims[3]) ? dims[3] : 640;
  const height = Number.isFinite(dims[2]) ? dims[2] : 640;
  return { inputName, width, height };
}

function getYoloLayout(output) {
  const dims = output?.dims || [];
  if (dims.length === 3) {
    const channelsFirst = dims[1] <= 128;
    return {
      dims,
      channelsFirst,
      rows: channelsFirst ? dims[2] : dims[1],
      stride: channelsFirst ? dims[1] : dims[2],
      rank: 3,
    };
  }

  if (dims.length === 2) {
    const channelsFirst = dims[0] <= 128;
    return {
      dims,
      channelsFirst,
      rows: channelsFirst ? dims[1] : dims[0],
      stride: channelsFirst ? dims[0] : dims[1],
      rank: 2,
    };
  }

  return null;
}

function iou(boxA, boxB) {
  const x1 = Math.max(boxA.x1, boxB.x1);
  const y1 = Math.max(boxA.y1, boxB.y1);
  const x2 = Math.min(boxA.x2, boxB.x2);
  const y2 = Math.min(boxA.y2, boxB.y2);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = Math.max(0, boxA.x2 - boxA.x1) * Math.max(0, boxA.y2 - boxA.y1);
  const areaB = Math.max(0, boxB.x2 - boxB.x1) * Math.max(0, boxB.y2 - boxB.y1);
  const union = areaA + areaB - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function applyNms(boxes, iouThreshold) {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept = [];
  while (sorted.length) {
    const candidate = sorted.shift();
    kept.push(candidate);
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (iou(candidate, sorted[i]) > iouThreshold) {
        sorted.splice(i, 1);
      }
    }
  }
  return kept;
}

function parseYoloOutput(output, scale, padX, padY, sourceWidth, sourceHeight) {
  const detections = [];
  const layout = getYoloLayout(output);
  const data = output?.data;
  if (!layout || !data) return { detections, rawCandidateCount: 0, bestRawScore: 0, layout: null };

  const { channelsFirst, rows, stride } = layout;
  const hasObjectness = (stride - 5) === COCO_CLASSES.length;
  const classOffset = hasObjectness ? 5 : 4;
  const classCount = stride - classOffset;
  let rawCandidateCount = 0;
  let bestRawScore = 0;

  const readValue = (row, index) => (channelsFirst ? data[rows * index + row] : data[row * stride + index]);

  for (let row = 0; row < rows; row++) {
    const cx = readValue(row, 0);
    const cy = readValue(row, 1);
    const w = readValue(row, 2);
    const h = readValue(row, 3);
    const objectness = hasObjectness ? readValue(row, 4) : 1;

    let bestScore = 0;
    let bestClass = -1;
    for (let classIndex = 0; classIndex < classCount; classIndex++) {
      const classProb = readValue(row, classIndex + classOffset);
      const score = objectness * classProb;
      if (score > bestScore) {
        bestScore = score;
        bestClass = classIndex;
      }
    }

    if (bestScore > bestRawScore) bestRawScore = bestScore;
    if (bestScore >= YOLO_SCORE_THRESHOLD) rawCandidateCount++;
    if (bestScore < YOLO_SCORE_THRESHOLD || bestClass < 0) continue;

    const x1 = Math.max(0, Math.min(sourceWidth, (cx - w / 2 - padX) / scale));
    const y1 = Math.max(0, Math.min(sourceHeight, (cy - h / 2 - padY) / scale));
    const x2 = Math.max(0, Math.min(sourceWidth, (cx + w / 2 - padX) / scale));
    const y2 = Math.max(0, Math.min(sourceHeight, (cy + h / 2 - padY) / scale));
    if (x2 <= x1 || y2 <= y1) continue;

    const label = COCO_CLASSES[bestClass] || `class-${bestClass}`;
    const boxWidth = x2 - x1;
    const boxHeight = y2 - y1;
    const boxAreaRatio = (boxWidth * boxHeight) / (sourceWidth * sourceHeight);
    if (boxWidth < YOLO_MIN_BOX_SIDE_PX || boxHeight < YOLO_MIN_BOX_SIDE_PX || boxAreaRatio < YOLO_MIN_BOX_AREA_RATIO) continue;

    const group = getVisionCategory(label);
    const minScore = group === 'Other' ? YOLO_OTHER_THRESHOLD : YOLO_HUMAN_ANIMAL_THRESHOLD;
    if (bestScore < minScore) continue;

    detections.push({
      x1,
      y1,
      x2,
      y2,
      score: bestScore,
      label,
      group,
    });
  }

  return {
    detections: applyNms(detections, YOLO_IOU_THRESHOLD).slice(0, YOLO_MAX_DETECTIONS).map((item) => ({
      ...item,
      x1Norm: item.x1 / sourceWidth,
      y1Norm: item.y1 / sourceHeight,
      x2Norm: item.x2 / sourceWidth,
      y2Norm: item.y2 / sourceHeight,
    })),
    rawCandidateCount,
    bestRawScore,
    layout,
  };
}

function emitVisionUpdate() {
  io.emit('vision_update', {
    detections: visionState.lastDetections,
    debug: visionState.lastDebug,
    running: visionState.running,
    inputWidth: visionState.inputWidth,
    inputHeight: visionState.inputHeight,
    streamUrl: visionState.streamUrl,
  });
}

async function ensureVisionModelLoaded() {
  if (visionState.session) return visionState.session;

  const session = await ort.InferenceSession.create(YOLO_MODEL_PATH, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });

  const shape = getModelInputShape(session);
  visionState.session = session;
  visionState.inputName = shape.inputName;
  visionState.outputNames = session.outputNames || [];
  visionState.inputWidth = shape.width;
  visionState.inputHeight = shape.height;
  visionState.lastDebug = `Backend YOLO ready. Input ${shape.width}x${shape.height}.`;
  emitVisionUpdate();
  return session;
}

function resetVisionStreamState() {
  visionState.mjpegBuffer = Buffer.alloc(0);
  visionState.latestFrame = null;
  visionState.latestFrameAt = 0;
  visionState.lastProcessedAt = 0;
}

function stopVisionStream() {
  visionState.running = false;
  if (visionState.intervalHandle) {
    clearInterval(visionState.intervalHandle);
    visionState.intervalHandle = null;
  }
  if (visionState.streamResponse?.data?.destroy) {
    visionState.streamResponse.data.destroy();
  }
  visionState.streamResponse = null;
  visionState.streamUrl = null;
  resetVisionStreamState();
}

function ingestMjpegChunk(chunk) {
  visionState.mjpegBuffer = Buffer.concat([visionState.mjpegBuffer, chunk]);

  while (true) {
    const soi = visionState.mjpegBuffer.indexOf(Buffer.from([0xff, 0xd8]));
    if (soi < 0) {
      if (visionState.mjpegBuffer.length > 1024 * 1024) {
        visionState.mjpegBuffer = Buffer.alloc(0);
      }
      return;
    }

    const eoi = visionState.mjpegBuffer.indexOf(Buffer.from([0xff, 0xd9]), soi + 2);
    if (eoi < 0) {
      if (soi > 0) {
        visionState.mjpegBuffer = visionState.mjpegBuffer.subarray(soi);
      }
      return;
    }

    const frame = visionState.mjpegBuffer.subarray(soi, eoi + 2);
    visionState.latestFrame = Buffer.from(frame);
    visionState.latestFrameAt = Date.now();
    visionState.mjpegBuffer = visionState.mjpegBuffer.subarray(eoi + 2);
  }
}

async function processLatestVisionFrame() {
  if (!visionState.running || visionState.processing || !visionState.latestFrame) return;
  if (visionState.latestFrameAt <= visionState.lastProcessedAt) return;

  visionState.processing = true;
  try {
    const frame = visionState.latestFrame;
    const frameMeta = await sharp(frame).metadata();
    const sourceWidth = frameMeta.width || 0;
    const sourceHeight = frameMeta.height || 0;
    if (!sourceWidth || !sourceHeight) {
      visionState.lastDebug = 'Backend vision could not read frame dimensions.';
      emitVisionUpdate();
      return;
    }

    const scale = Math.min(visionState.inputWidth / sourceWidth, visionState.inputHeight / sourceHeight);
    const scaledWidth = Math.round(sourceWidth * scale);
    const scaledHeight = Math.round(sourceHeight * scale);
    const padX = Math.floor((visionState.inputWidth - scaledWidth) / 2);
    const padY = Math.floor((visionState.inputHeight - scaledHeight) / 2);

    const raw = await sharp(frame)
      .resize(visionState.inputWidth, visionState.inputHeight, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      })
      .removeAlpha()
      .raw()
      .toBuffer();

    const planeSize = visionState.inputWidth * visionState.inputHeight;
    const tensorData = new Float32Array(planeSize * 3);
    for (let i = 0; i < planeSize; i++) {
      tensorData[i] = raw[i * 3] / 255;
      tensorData[i + planeSize] = raw[i * 3 + 1] / 255;
      tensorData[i + planeSize * 2] = raw[i * 3 + 2] / 255;
    }

    const input = new ort.Tensor('float32', tensorData, [1, 3, visionState.inputHeight, visionState.inputWidth]);
    const feeds = { [visionState.inputName]: input };
    const results = await visionState.session.run(feeds);

    let bestParsed = { detections: [], rawCandidateCount: 0, bestRawScore: 0, layout: null };
    let bestOutputName = 'unknown';
    for (const [name, tensor] of Object.entries(results || {})) {
      const parsed = parseYoloOutput(tensor, scale, padX, padY, sourceWidth, sourceHeight);
      const parsedCount = parsed.detections.length;
      const bestCount = bestParsed.detections.length;
      if (
        parsedCount > bestCount ||
        (parsedCount === bestCount && parsed.rawCandidateCount > bestParsed.rawCandidateCount) ||
        (parsedCount === bestCount && parsed.rawCandidateCount === bestParsed.rawCandidateCount && parsed.bestRawScore > bestParsed.bestRawScore)
      ) {
        bestParsed = parsed;
        bestOutputName = name;
      }
    }

    visionState.lastDetections = bestParsed.detections;
    visionState.lastProcessedAt = visionState.latestFrameAt;
    visionState.lastDebug = `Backend output ${bestOutputName} | shape ${bestParsed.layout?.dims?.join('x') || 'unknown'} | raw ${bestParsed.rawCandidateCount} | kept ${bestParsed.detections.length} | top ${(bestParsed.bestRawScore * 100).toFixed(1)}%`;
    emitVisionUpdate();
  } catch (error) {
    visionState.lastDebug = `Backend inference error: ${error.message}`;
    emitVisionUpdate();
  } finally {
    visionState.processing = false;
  }
}

function startVisionProcessingLoop() {
  if (visionState.intervalHandle) return;
  visionState.intervalHandle = setInterval(() => {
    void processLatestVisionFrame();
  }, BACKEND_INFERENCE_INTERVAL_MS);
}

async function startVisionStream() {
  await ensureVisionModelLoaded();
  stopVisionStream();

  const streamCandidates = buildEsp32StreamCandidates();
  let lastError = null;
  for (const espUrl of streamCandidates) {
    try {
      const response = await axios.get(espUrl, {
        responseType: 'stream',
        timeout: 10000,
        headers: { Accept: 'multipart/x-mixed-replace,image/jpeg,*/*;q=0.8' },
      });

      visionState.running = true;
      visionState.streamResponse = response;
      visionState.streamUrl = espUrl;
      visionState.lastDebug = `Backend detector connected to ${espUrl}`;
      response.data.on('data', ingestMjpegChunk);
      response.data.on('error', (error) => {
        visionState.lastDebug = `Backend stream error: ${error.message}`;
        emitVisionUpdate();
        stopVisionStream();
      });
      response.data.on('close', () => {
        if (visionState.running) {
          visionState.lastDebug = 'Backend stream closed.';
          emitVisionUpdate();
          stopVisionStream();
        }
      });
      startVisionProcessingLoop();
      emitVisionUpdate();
      return { streamUrl: espUrl };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Could not connect backend detector to ESP32 stream.');
}

app.get('/api/esp32/config', (req, res) => {
  res.json({
    success: true,
    config: {
      ...esp32Config,
      proxyStreamUrl: getEsp32ProxyStreamUrl(),
      probeUrl: getEsp32ProbeUrl(),
      resolvedStreamUrl: buildEsp32PrimaryStreamUrl(),
      fallbackStreamUrl: buildEsp32StreamUrl()
    }
  });
});

app.get('/api/vision/status', (req, res) => {
  res.json({
    success: true,
    running: visionState.running,
    inputWidth: visionState.inputWidth,
    inputHeight: visionState.inputHeight,
    streamUrl: visionState.streamUrl,
    debug: visionState.lastDebug,
    detections: visionState.lastDetections,
  });
});

app.post('/api/vision/start', async (req, res) => {
  try {
    const result = await startVisionStream();
    return res.json({
      success: true,
      running: true,
      streamUrl: result.streamUrl,
      inputWidth: visionState.inputWidth,
      inputHeight: visionState.inputHeight,
      debug: visionState.lastDebug,
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      message: 'Failed to start backend YOLO on the live stream.',
      error: error.message,
    });
  }
});

app.post('/api/vision/stop', (req, res) => {
  stopVisionStream();
  visionState.lastDetections = [];
  visionState.lastDebug = 'Backend detector stopped.';
  emitVisionUpdate();
  return res.json({ success: true, running: false });
});

app.post('/api/esp32/config', (req, res) => {
  const { baseUrl, capturePath, streamPath, controlPath } = req.body || {};

  if (baseUrl !== undefined) {
    if (typeof baseUrl !== 'string' || !/^https?:\/\//i.test(baseUrl.trim())) {
      return res.status(400).json({ success: false, message: 'baseUrl must start with http:// or https://' });
    }
    esp32Config.baseUrl = baseUrl.trim().replace(/\/$/, '');
  }

  if (capturePath) esp32Config.capturePath = normalizeEsp32Endpoint(capturePath);
  if (streamPath) esp32Config.streamPath = normalizeEsp32Endpoint(streamPath);
  if (controlPath) esp32Config.controlPath = normalizeEsp32Endpoint(controlPath);

  console.log('[API] Updated ESP32-CAM config:', esp32Config);
  return res.json({
    success: true,
    config: {
      ...esp32Config,
      proxyStreamUrl: getEsp32ProxyStreamUrl(),
      probeUrl: getEsp32ProbeUrl(),
      resolvedStreamUrl: buildEsp32PrimaryStreamUrl(),
      fallbackStreamUrl: buildEsp32StreamUrl()
    }
  });
});

app.get('/api/esp32/probe', async (req, res) => {
  const streamCandidates = buildEsp32StreamCandidates();

  let streamResponse = null;
  let workingStreamUrl = null;
  let lastStreamError = null;

  for (const candidateUrl of streamCandidates) {
    try {
      streamResponse = await axios.get(candidateUrl, {
        responseType: 'stream',
        timeout: 5000,
        headers: { Accept: 'multipart/x-mixed-replace,image/jpeg,*/*;q=0.8' }
      });
      workingStreamUrl = candidateUrl;
      break;
    } catch (streamError) {
      lastStreamError = streamError;
    }
  }

  if (!streamResponse || !workingStreamUrl) {
    return res.status(502).json({
      success: false,
      stage: 'stream',
      streamUrl: streamCandidates[0] || null,
      triedStreamUrls: streamCandidates,
      message: 'The backend could not reach the ESP32-CAM live stream endpoint.',
      error: lastStreamError ? lastStreamError.message : 'Unknown stream error'
    });
  }

  if (streamResponse?.data?.destroy) {
    streamResponse.data.destroy();
  }

  return res.json({
    success: true,
    streamUrl: workingStreamUrl,
    triedStreamUrls: streamCandidates,
    streamContentType: streamResponse.headers['content-type'] || 'unknown'
  });
});

app.get('/api/esp32/stream', async (req, res) => {
  let upstream = null;
  let lastError = null;
  const streamCandidates = buildEsp32StreamCandidates();

  for (const espUrl of streamCandidates) {
    try {
      upstream = await axios.get(espUrl, {
        responseType: 'stream',
        timeout: 10000,
        headers: { Accept: 'multipart/x-mixed-replace,image/jpeg,*/*;q=0.8' }
      });
      res.status(upstream.status);
      res.set('Content-Type', upstream.headers['content-type'] || 'multipart/x-mixed-replace');
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Connection', 'keep-alive');

      upstream.data.on('error', (error) => {
        console.error('[API] ESP32 stream upstream error:', error.message);
        if (!res.headersSent) {
          res.status(502).end('ESP32-CAM stream error');
        } else {
          res.end();
        }
      });

      req.on('close', () => {
        if (upstream?.data?.destroy) {
          upstream.data.destroy();
        }
      });

      upstream.data.pipe(res);
      return;
    } catch (error) {
      lastError = error;
      if (upstream?.data?.destroy) {
        upstream.data.destroy();
      }
    }
  }

  console.error('[API] ESP32 stream error:', lastError ? lastError.message : 'Unknown stream error');
  return res.status(502).json({
    success: false,
    message: 'Failed to open MJPEG stream from ESP32-CAM',
    triedStreamUrls: streamCandidates,
    error: lastError ? lastError.message : 'Unknown stream error'
  });
});

app.get('/api/esp32/snapshot', async (req, res) => {
  try {
    const espUrl = buildEsp32Url(esp32Config.capturePath);
    const response = await axios.get(espUrl, {
      responseType: 'arraybuffer',
      timeout: 5000,
      headers: { Accept: 'image/jpeg,image/*;q=0.9,*/*;q=0.8' }
    });

    res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.send(Buffer.from(response.data));
  } catch (error) {
    console.error('[API] ESP32 snapshot error:', error.message);
    return res.status(502).json({
      success: false,
      message: 'Failed to fetch snapshot from ESP32-CAM',
      error: error.message
    });
  }
});

app.post('/api/drone/record', async (req, res) => {
  const { action } = req.body;
  console.log(`[API] Received recording command: ${action}`);

  try {
    // Modify this URL structure to match your exact ESP32-CAM firmware API.
    // E.g., Many firmwares use /control?var=record&val=1
    const commandVal = action === 'start' ? '1' : '0';
    const espUrl = `${buildEsp32Url(esp32Config.controlPath)}?var=record&val=${commandVal}`;

    console.log(`[API] Forwarding request to ESP32: ${espUrl}`);

    // Set a timeout so the frontend doesn't hang forever if the ESP is offline
    const response = await axios.get(espUrl, { timeout: 3000 });

    // Forward success back to frontend
    res.json({ success: true, message: `ESP32 returned: ${response.statusText}` });
  } catch (error) {
    console.error(`[API] ESP32 Communication Error:`, error.message);
    // Even if it fails, we let the frontend know so it can show an error
    res.status(502).json({
      success: false,
      message: 'Failed to communicate with ESP32-CAM',
      error: error.message
    });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  console.log(`[AUTH] Login attempt for: ${username}`);
  if (username === 'siddharth' && password === 'india@1234') {
    console.log(`[AUTH] Login successful for: ${username}`);
    res.json({ success: true, redirect: '/' });
  } else {
    console.warn(`[AUTH] Login failed for: ${username}`);
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Send initial data
  socket.emit('telemetry_update', telemetryService.getTelemetry());
  socket.emit('sensor_update', sensorService.getSensors());

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Broadcast updates periodically
setInterval(() => {
  io.emit('telemetry_update', telemetryService.simulateTelemetry());
}, 800);

setInterval(() => {
  io.emit('sensor_update', sensorService.simulateSensors());
}, 5000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`AEGIS Server running on http://localhost:${PORT}`);
});
