#define SENSOR_PIN 19   // Change if using another GPIO

void setup() {
  Serial.begin(115200);
  pinMode(SENSOR_PIN, INPUT);
}

void loop() {
  int sensorValue = digitalRead(SENSOR_PIN);

  if (sensorValue == HIGH) {
    Serial.println("Vibration Detected!");
  } else {
    Serial.println("No Vibration");
  }

  delay(500);
}