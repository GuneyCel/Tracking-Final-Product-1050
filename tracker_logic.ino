#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEBeacon.h>

#define WAKEUP_PIN GPIO_NUM_33
const float ACCEL_THRESHOLD = 1.1; 
const float GYRO_THRESHOLD = 0.7;  
const unsigned long STABLE_TIME_MS = 3000; 
const unsigned long BROADCAST_TIME_MS = 15000; 

Adafruit_MPU6050 mpu;

void setup() {
  // Initialize Serial and WAIT
  Serial.begin(115200);
  // Wait for Serial Monitor to connect
  while(!Serial) { delay(10); }
  delay(2000); 
  
  Serial.println("\n==============================");
  Serial.println("SYSTEM BOOTING...");
  
  // Initialize Hardware
  Wire.begin(21, 22);
  if (!mpu.begin()) {
    Serial.println("CRITICAL ERROR: MPU6050 not found!");
    while (1) yield();
  }
  Serial.println("MPU6050 Connection: SUCCESS");

  // Check Why it Woke Up
  esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();
  
  if (wakeup_reason == ESP_SLEEP_WAKEUP_EXT0) {
    Serial.println("WAKEUP SOURCE: Physical Motion Detected!");
    waitForStopAndBroadcast();
  } else {
    Serial.println("WAKEUP SOURCE: Cold Start / USB Power");
    Serial.println("Setting up sensors and preparing for sleep...");
  }

  // Arm the Interrupt
  setupMotionInterrupt();
  esp_sleep_enable_ext0_wakeup(WAKEUP_PIN, 1);
  
  Serial.println("GOING TO SLEEP NOW.");
  Serial.println("==============================\n");
   // Ensure all text is sent before CPU shuts down
  Serial.flush();
  
  // Start the Deep Sleep
  delay(100); 
  esp_deep_sleep_start();
}

// Wait for the Asset to Stop Moving and then Start the Broadcast
void waitForStopAndBroadcast() {
  Serial.println("Monitoring movement stability...");
  unsigned long lastMotionTime = millis();
  
  while (millis() - lastMotionTime < STABLE_TIME_MS) {
    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);

    float totalAccel = sqrt(sq(a.acceleration.x) + sq(a.acceleration.y) + sq(a.acceleration.z));
    float totalRotation = abs(g.gyro.x) + abs(g.gyro.y) + abs(g.gyro.z);

    if (abs(totalAccel - 9.8) > ACCEL_THRESHOLD || totalRotation > GYRO_THRESHOLD) {
      Serial.println("  [Status] Movement detected... resetting timer.");
      lastMotionTime = millis();
    }
     // Check twice per second
    delay(500);
  }

  Serial.println("STABILITY REACHED. Starting BLE Broadcast.");
  startiBeacon();
  delay(BROADCAST_TIME_MS);
  stopiBeacon();
  Serial.println("Broadcast Window Closed.");
}

// Start the iBeacon Broadcast
void startiBeacon() {
  BLEDevice::init("SmartTag_01");
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  BLEBeacon oBeacon = BLEBeacon();
  oBeacon.setManufacturerId(0x4C00); 
  oBeacon.setProximityUUID(BLEUUID("BEAC0000-0000-0000-0000-000000000001"));
  oBeacon.setMajor(1);
  oBeacon.setMinor(1);
  
  BLEAdvertisementData oAdvertisementData = BLEAdvertisementData();
  oAdvertisementData.setFlags(0x04);
  oAdvertisementData.setManufacturerData(oBeacon.getData());
  
  pAdvertising->setAdvertisementData(oAdvertisementData);
  pAdvertising->start();
  Serial.println("  [BLE] iBeacon Active...");
}

// Stop the iBeacon Broadcast
void stopiBeacon() {
  BLEDevice::getAdvertising()->stop();
  BLEDevice::deinit();
  Serial.println("  [BLE] iBeacon Deactivated.");
}

// Setting up the Motion Interrupt
void setupMotionInterrupt() {
  mpu.setHighPassFilter(MPU6050_HIGHPASS_5_HZ);
  mpu.setMotionDetectionThreshold(15); 
  mpu.setMotionDetectionDuration(5);
  mpu.setInterruptPinLatch(false);
  mpu.setMotionInterrupt(true);
}

void loop() {}