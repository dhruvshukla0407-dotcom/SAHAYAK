#include "esp_camera.h"
<<<<<<< HEAD
#include <WiFi.h>
#include <ESPmDNS.h>

#include "board_config.h"

const char *ssid = "Siddharth";
const char *password = "india@1234";
const char *deviceId = "esp32-cam-01";
const char *mdnsHost = "esp32-cam-01";
const char *fallbackApSsid = "ESP32-CAM-Setup";
const char *fallbackApPassword = "esp32cam123";

const int wifiReconnectDelayMs = 500;
const unsigned long wifiConnectTimeoutMs = 20000;
const framesize_t kStreamFrameSize = FRAMESIZE_QVGA;
const int kJpegQuality = 14;
=======
#include <WebSocketsClient.h>
#include <WiFi.h>

#include "board_config.h"

const char *ssid = "Bhaskar";
const char *password = "123456789";
const char *deviceId = "esp32-cam-01";

const char *websocketHost = "172.20.10.3";
const uint16_t websocketPort = 80;
const char *websocketPath = "/ws";

const int wifiReconnectDelayMs = 500;
const framesize_t kStreamFrameSize = FRAMESIZE_CIF;
const int kJpegQuality = 12;
const unsigned long kFrameIntervalMs = 60;
const bool kEnableLocalDebugServer = false;

WebSocketsClient webSocket;
bool wsConnected = false;
unsigned long lastFrameSentAt = 0;
>>>>>>> origin/main

void startCameraServer();
const char *getDeviceId();

const char *getDeviceId() {
  return deviceId;
}

static void connectToWifi() {
<<<<<<< HEAD
  WiFi.mode(WIFI_AP_STA);
=======
  WiFi.mode(WIFI_STA);
>>>>>>> origin/main
  WiFi.setSleep(false);
  WiFi.begin(ssid, password);

  Serial.print("Connecting to WiFi");
<<<<<<< HEAD
  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startedAt) < wifiConnectTimeoutMs) {
=======
  while (WiFi.status() != WL_CONNECTED) {
>>>>>>> origin/main
    delay(wifiReconnectDelayMs);
    Serial.print(".");
  }

  Serial.println();
<<<<<<< HEAD
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected. IP: ");
    Serial.println(WiFi.localIP());
    return;
  }

  Serial.println("WiFi connection timed out. Starting fallback access point.");
  WiFi.disconnect(true, true);
  WiFi.softAP(fallbackApSsid, fallbackApPassword);
  Serial.print("Fallback AP ready. SSID: ");
  Serial.println(fallbackApSsid);
  Serial.print("Fallback AP IP: ");
  Serial.println(WiFi.softAPIP());
}

static void startMdns() {
  if (!MDNS.begin(mdnsHost)) {
    Serial.println("mDNS responder failed to start.");
    return;
  }

  MDNS.addService("http", "tcp", 80);
  MDNS.addService("http", "tcp", 81);
  Serial.print("mDNS ready: http://");
  Serial.print(mdnsHost);
  Serial.println(".local");
}

static bool ensureWifiConnected() {
  const bool stationConnected = WiFi.status() == WL_CONNECTED;
  const bool apEnabled = WiFi.softAPgetStationNum() >= 0 && WiFi.softAPIP()[0] != 0;
  if (stationConnected || apEnabled) {
=======
  Serial.print("WiFi connected. IP: ");
  Serial.println(WiFi.localIP());
}

static bool ensureWifiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
>>>>>>> origin/main
    return true;
  }

  Serial.println("WiFi lost. Reconnecting...");
<<<<<<< HEAD
  WiFi.disconnect(true, true);
  connectToWifi();
  return WiFi.status() == WL_CONNECTED || WiFi.softAPIP()[0] != 0;
=======
  WiFi.disconnect();
  connectToWifi();
  return WiFi.status() == WL_CONNECTED;
>>>>>>> origin/main
}

static void configureCamera(camera_config_t &config) {
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;

  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;

  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;

  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;

  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = kStreamFrameSize;
  config.jpeg_quality = kJpegQuality;
<<<<<<< HEAD
  config.fb_location = CAMERA_FB_IN_PSRAM;
=======
>>>>>>> origin/main
  config.fb_count = psramFound() ? 2 : 1;
  config.grab_mode = CAMERA_GRAB_LATEST;
}

<<<<<<< HEAD
=======
static void onWebSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      wsConnected = false;
      Serial.println("WebSocket disconnected");
      break;

    case WStype_CONNECTED:
      wsConnected = true;
      Serial.printf("WebSocket connected to: %s\n", payload);
      break;

    case WStype_TEXT:
      Serial.printf("Server message: %s\n", payload);
      break;

    default:
      break;
  }
}

static void beginWebSocket() {
  webSocket.begin(websocketHost, websocketPort, websocketPath);
  webSocket.onEvent(onWebSocketEvent);
  webSocket.setReconnectInterval(2000);
  webSocket.enableHeartbeat(15000, 3000, 2);
}

static bool sendFrameMetadata(camera_fb_t *fb) {
  char metadata[224];
  int written = snprintf(
    metadata, sizeof(metadata),
    "{\"type\":\"frame-meta\",\"deviceId\":\"%s\",\"timestampSec\":%lld,\"timestampUsec\":%ld,\"length\":%u,\"format\":\"jpeg\",\"width\":%u,\"height\":%u}",
    deviceId, fb->timestamp.tv_sec, fb->timestamp.tv_usec, (unsigned int)fb->len, fb->width, fb->height
  );

  if (written <= 0 || written >= (int)sizeof(metadata)) {
    Serial.println("Failed to build frame metadata");
    return false;
  }

  return webSocket.sendTXT((uint8_t *)metadata, (size_t)written);
}

static bool sendLiveFrame() {
  if (!wsConnected) {
    return false;
  }

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Camera capture failed");
    return false;
  }

  bool ok = sendFrameMetadata(fb);
  if (ok) {
    ok = webSocket.sendBIN(fb->buf, fb->len);
  }

  esp_camera_fb_return(fb);

  if (!ok) {
    Serial.println("Frame push failed");
  }

  return ok;
}

>>>>>>> origin/main
void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  Serial.println();
<<<<<<< HEAD
  Serial.println("Booting ESP32-CAM local stream node...");
=======
  Serial.println("Booting autonomous camera node...");
>>>>>>> origin/main

  camera_config_t config;
  configureCamera(config);

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return;
  }

  sensor_t *sensor = esp_camera_sensor_get();
  if (sensor != nullptr) {
    sensor->set_framesize(sensor, kStreamFrameSize);
    sensor->set_quality(sensor, kJpegQuality);
  }

  connectToWifi();
<<<<<<< HEAD
  startMdns();
  startCameraServer();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Capture URL: http://");
    Serial.print(WiFi.localIP());
    Serial.println("/capture");
    Serial.print("MJPEG stream URL: http://");
=======
  beginWebSocket();

  if (kEnableLocalDebugServer) {
    startCameraServer();
    Serial.print("Debug MJPEG stream: http://");
>>>>>>> origin/main
    Serial.print(WiFi.localIP());
    Serial.println(":81/stream");
  }

<<<<<<< HEAD
  Serial.print("Fallback AP capture URL: http://");
  Serial.print(WiFi.softAPIP());
  Serial.println("/capture");
  Serial.print("Fallback AP MJPEG stream URL: http://");
  Serial.print(WiFi.softAPIP());
  Serial.println(":81/stream");
  Serial.print("Website/backend hostname option: http://");
  Serial.print(mdnsHost);
  Serial.println(".local");
=======
  Serial.print("Push target: ws://");
  Serial.print(websocketHost);
  Serial.print(":");
  Serial.print(websocketPort);
  Serial.println(websocketPath);
>>>>>>> origin/main
}

void loop() {
  if (!ensureWifiConnected()) {
    delay(100);
    return;
  }

<<<<<<< HEAD
  delay(20);
=======
  webSocket.loop();

  if (!wsConnected) {
    delay(20);
    return;
  }

  if (millis() - lastFrameSentAt < kFrameIntervalMs) {
    delay(1);
    return;
  }

  lastFrameSentAt = millis();
  sendLiveFrame();
>>>>>>> origin/main
}
