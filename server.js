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

// --- ESP32-CAM Control Proxy ---
// Replace this with your actual ESP32-CAM local IP address
const ESP32_CAM_IP = 'http://192.168.1.100';

app.post('/api/drone/record', async (req, res) => {
  const { action } = req.body;
  console.log(`[API] Received recording command: ${action}`);

  try {
    // Modify this URL structure to match your exact ESP32-CAM firmware API.
    // E.g., Many firmwares use /control?var=record&val=1
    const commandVal = action === 'start' ? '1' : '0';
    const espUrl = `${ESP32_CAM_IP}/control?var=record&val=${commandVal}`;

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
