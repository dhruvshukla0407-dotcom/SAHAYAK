#include "esp_camera.h"
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

void startCameraServer();
const char *getDeviceId();

const char *getDeviceId() {
  return deviceId;
}

static void connectToWifi() {
  WiFi.mode(WIFI_AP_STA);
  WiFi.setSleep(false);
  WiFi.begin(ssid, password);

  Serial.print("Connecting to WiFi");
  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startedAt) < wifiConnectTimeoutMs) {
    delay(wifiReconnectDelayMs);
    Serial.print(".");
  }

  Serial.println();
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
    return true;
  }

  Serial.println("WiFi lost. Reconnecting...");
  WiFi.disconnect(true, true);
  connectToWifi();
  return WiFi.status() == WL_CONNECTED || WiFi.softAPIP()[0] != 0;
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
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.fb_count = psramFound() ? 2 : 1;
  config.grab_mode = CAMERA_GRAB_LATEST;
}

void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  Serial.println();
  Serial.println("Booting ESP32-CAM local stream node...");

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
  startMdns();
  startCameraServer();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Capture URL: http://");
    Serial.print(WiFi.localIP());
    Serial.println("/capture");
    Serial.print("MJPEG stream URL: http://");
    Serial.print(WiFi.localIP());
    Serial.println(":81/stream");
  }

  Serial.print("Fallback AP capture URL: http://");
  Serial.print(WiFi.softAPIP());
  Serial.println("/capture");
  Serial.print("Fallback AP MJPEG stream URL: http://");
  Serial.print(WiFi.softAPIP());
  Serial.println(":81/stream");
  Serial.print("Website/backend hostname option: http://");
  Serial.print(mdnsHost);
  Serial.println(".local");
}

void loop() {
  if (!ensureWifiConnected()) {
    delay(100);
    return;
  }

  delay(20);
}
