const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');

const telemetryService = require('./services/telemetry');
const sensorService = require('./services/sensors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json()); // Allow parsing JSON bodies
app.use(express.static('public'));

// Default route to serve login if not authenticated (handled client-side usually)
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// --- ESP32-CAM Control Proxy ---
const esp32Config = {
  baseUrl: (process.env.ESP32_CAM_URL || 'http://192.168.1.100').replace(/\/$/, ''),
  capturePath: process.env.ESP32_CAPTURE_PATH || '/capture',
  streamPath: process.env.ESP32_STREAM_PATH || '/stream',
  controlPath: process.env.ESP32_CONTROL_PATH || '/control',
};

function buildEsp32Url(pathname) {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${esp32Config.baseUrl}${path}`;
}

app.get('/api/esp32/config', (req, res) => {
  res.json({ success: true, config: esp32Config });
});

app.post('/api/esp32/config', (req, res) => {
  const { baseUrl, capturePath, streamPath, controlPath } = req.body || {};

  if (baseUrl !== undefined) {
    if (typeof baseUrl !== 'string' || !/^https?:\/\//i.test(baseUrl.trim())) {
      return res.status(400).json({ success: false, message: 'baseUrl must start with http:// or https://' });
    }
    esp32Config.baseUrl = baseUrl.trim().replace(/\/$/, '');
  }

  if (capturePath) esp32Config.capturePath = capturePath.startsWith('/') ? capturePath : `/${capturePath}`;
  if (streamPath) esp32Config.streamPath = streamPath.startsWith('/') ? streamPath : `/${streamPath}`;
  if (controlPath) esp32Config.controlPath = controlPath.startsWith('/') ? controlPath : `/${controlPath}`;

  console.log('[API] Updated ESP32-CAM config:', esp32Config);
  return res.json({ success: true, config: esp32Config });
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
