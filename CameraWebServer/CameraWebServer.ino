#include "esp_camera.h"
#include <WiFi.h>
#include "FS.h"
#include "SD_MMC.h"

#define CAMERA_MODEL_AI_THINKER
#define FLASH_LED_PIN 4

#include "board_config.h"

const char *ssid = "Siddharth";
const char *password = "india@1234";

int pictureNumber = 0;

void startCameraServer();   // Web server declaration

void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(true);

  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, HIGH);

  camera_config_t config;
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

  config.frame_size = FRAMESIZE_UXGA;
  config.jpeg_quality = 10;
  config.fb_count = 2;

  // Camera Init
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x", err);
    return;
  }

  // WiFi Connect
  WiFi.begin(ssid, password);
  WiFi.setSleep(false);

  Serial.print("Connecting to WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("");
  Serial.println("WiFi connected");

  // SD Card Init
  if (!SD_MMC.begin()) {
    Serial.println("SD Card Mount Failed");
    return;
  }

  Serial.println("SD Card initialized");

  // Start Camera Web Server
  startCameraServer();

  Serial.print("Camera Ready! Open: http://");
  Serial.println(WiFi.localIP());
}

void loop() {

  camera_fb_t * fb = esp_camera_fb_get();

  if (!fb) {
    Serial.println("Camera capture failed");
    return;
  }

  String path = "/image" + String(pictureNumber) + ".jpg";

  File file = SD_MMC.open(path.c_str(), FILE_WRITE);

  if (!file) {
    Serial.println("Failed to open file");
  } else {
    file.write(fb->buf, fb->len);
    Serial.printf("Saved: %s\n", path.c_str());
    pictureNumber++;
  }

  file.close();
  esp_camera_fb_return(fb);

  delay(10000);   // Capture every 10 seconds
}