/*
  Floyd Feeder firmware - Seeed Studio XIAO ESP32S3
  ------------------------------------------
  Talks to the Floyd web app over Bluetooth LE (Web Bluetooth).

  Board:     XIAO_ESP32S3 (Boards Manager: "esp32" by Espressif Systems, FQBN esp32:esp32:XIAO_ESP32S3)
  Libraries: ArduinoJson v7 (Library Manager). BLE comes with the board package.

  Wiring (HC-160A S2 control header; connect XIAO GND to driver G)
    D3 - Impeller Forward Enable (A)     D8 - Auger Forward Enable (a)
    D1 - Impeller Reverse Enable (B)     D9 - Auger Reverse Enable (b)
    D4 - Impeller PWM (PA)               D5 - Auger PWM (Pa)
    D6 - Button A (manual feed / stop)   D7 - Button B (clear jam)

  Enable pins:  A=0,B=0 brake | A=1,B=0 forward | A=0,B=1 reverse | A=1,B=1 never driven
  Buttons:      inverted logic, pressed = LOW (internal pull-up, wire button to GND)

  Behaviour
    Button A : idle -> manual feed (defaults below); feeding -> stop.
    Button B : clear jam = auger in reverse, impeller braked, for JAM_DEFAULT_MS.
    Feed     : pre-spin (impeller only) -> feeding (impeller + auger) -> post-spin (impeller only).
    Schedules: stored in flash, run in local time once the web app has synced the clock.

  BLE contract (service 4fafc201-1fb5-459e-8fcc-c5c9c331914b), same as the web app:
    ...9141 Command   WRITE   {"action":..., "parameters":{...}, "timestamp":...}
    ...9142 Response  NOTIFY  {"type":"control_response"|"error","data":{...}}
    ...9143 Telemetry NOTIFY  {"type":"sensor_data","data":{motorState, augerSpeed, impellerSpeed,
                                augerDirection, impellerDirection, buttonAPressed, buttonBPressed}}
    ...9144 Status    READ/NOTIFY
    ...9145 Schedules READ/WRITE  pages: uint16 LE index, uint16 LE total, <=480 bytes JSON
    ...9147 Time      WRITE   uint32 LE Unix seconds [+ int16 LE UTC offset in minutes]
    ...9148 Feed log  NOTIFY  {"type":"control_response","data":{"action":"feed_complete",...}}
  Speeds on the wire are 0-1023; the driver uses 15 kHz PWM up to 98% duty.
*/

#include <Arduino.h>
#include <ArduinoJson.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLESecurity.h>
#include <Preferences.h>
#include <sys/time.h>
#include <time.h>
#include "FeederTypes.h"

#ifndef ARDUINO_XIAO_ESP32S3
#error "Select the Seeed Studio XIAO_ESP32S3 board for Floyd Feeder."
#elif !defined(CONFIG_NIMBLE_ENABLED)
#error "Use Espressif Arduino ESP32 3.3.13 with NimBLE enabled."
#endif

// ---------------------------------------------------------------- pins
const uint8_t PIN_IMPELLER_FWD = D3;  // A
const uint8_t PIN_IMPELLER_REV = D1;  // B
const uint8_t PIN_IMPELLER_PWM = D4;
const uint8_t PIN_AUGER_FWD = D8;     // a
const uint8_t PIN_AUGER_REV = D9;     // b
const uint8_t PIN_AUGER_PWM = D5;
const uint8_t PIN_BUTTON_A = D6;
const uint8_t PIN_BUTTON_B = D7;

// ---------------------------------------------------------------- settings
const uint16_t PWM_MAX = 1023;                 // web app speed range
const uint32_t MOTOR_PWM_HZ = 15000;
const uint8_t MOTOR_PWM_BITS = 10;
const uint16_t MOTOR_MAX_DUTY = (1u << MOTOR_PWM_BITS) * 98u / 100u;
const uint16_t FEED_DEFAULT_AUGER = 768;       // 75 %
const uint16_t FEED_DEFAULT_IMPELLER = 1023;   // 100 %
const uint32_t FEED_DEFAULT_PRE_MS = 1500;
const uint32_t FEED_DEFAULT_FEED_MS = 3000;
const uint32_t FEED_DEFAULT_POST_MS = 1500;
const uint32_t FEED_MAX_MS = 30000;
const uint32_t SPIN_MAX_MS = 10000;
const uint16_t JAM_DEFAULT_SPEED = 768;
const uint32_t JAM_DEFAULT_MS = 2000;
const uint32_t JAM_MAX_MS = 10000;
const uint32_t DIRECTION_DEAD_TIME_MS = 80;    // brake time between forward and reverse
const uint32_t DEBOUNCE_MS = 40;
const uint32_t TELEMETRY_DEFAULT_MS = 2000;
// Used only until the web app sends the browser's UTC offset (minutes east of UTC).
const int16_t TZ_OFFSET_MINUTES_DEFAULT = 0;

const size_t MAX_SCHEDULES = 10;
const size_t SCHEDULE_BUFFER_MAX = 4096;
const size_t SCHEDULE_PAGE_PAYLOAD = 480;
const time_t TIME_VALID_AFTER = 1600000000;    // clock counts as synced after Sep 2020

#define SERVICE_UUID    "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CMD_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c3319141"
#define RESPONSE_UUID   "4fafc201-1fb5-459e-8fcc-c5c9c3319142"
#define TELEMETRY_UUID  "4fafc201-1fb5-459e-8fcc-c5c9c3319143"
#define STATUS_UUID     "4fafc201-1fb5-459e-8fcc-c5c9c3319144"
#define SCHEDULES_UUID  "4fafc201-1fb5-459e-8fcc-c5c9c3319145"
#define TIME_UUID       "4fafc201-1fb5-459e-8fcc-c5c9c3319147"
#define FEEDLOG_UUID    "4fafc201-1fb5-459e-8fcc-c5c9c3319148"

// ---------------------------------------------------------------- motors
Motor impeller = {PIN_IMPELLER_FWD, PIN_IMPELLER_REV, PIN_IMPELLER_PWM, DIR_BRAKE, 0};
Motor auger = {PIN_AUGER_FWD, PIN_AUGER_REV, PIN_AUGER_PWM, DIR_BRAKE, 0};

const char* directionName(Direction d) {
  return d == DIR_FORWARD ? "forward" : d == DIR_REVERSE ? "reverse" : "brake";
}

// Never sets both enable pins HIGH: both go LOW (brake) before the new one goes HIGH.
void setMotor(Motor& m, Direction dir, uint16_t speed) {
  if (dir == DIR_BRAKE) speed = 0;
  if (speed > PWM_MAX) speed = PWM_MAX;
  if (dir != m.dir) {
    ledcWrite(m.pwmPin, 0);
    digitalWrite(m.fwdPin, LOW);
    digitalWrite(m.revPin, LOW);
    if (m.dir != DIR_BRAKE && dir != DIR_BRAKE) delay(DIRECTION_DEAD_TIME_MS);  // forward <-> reverse
    if (dir == DIR_FORWARD) digitalWrite(m.fwdPin, HIGH);
    if (dir == DIR_REVERSE) digitalWrite(m.revPin, HIGH);
    m.dir = dir;
  }
  ledcWrite(m.pwmPin, (uint32_t)speed * MOTOR_MAX_DUTY / PWM_MAX);
  m.speed = speed;
}

void brakeAll() {
  setMotor(auger, DIR_BRAKE, 0);
  setMotor(impeller, DIR_BRAKE, 0);
}

// ---------------------------------------------------------------- feed sequence
Phase phase = PHASE_IDLE;
FeedJob job;
uint32_t phaseStartedAt = 0;
uint32_t jamDurationMs = 0;
bool telemetryDirty = true;

const char* phaseName(Phase p) {
  switch (p) {
    case PHASE_PRE_SPIN: return "pre_spin";
    case PHASE_FEEDING: return "feeding";
    case PHASE_POST_SPIN: return "post_spin";
    case PHASE_JAM_CLEAR: return "jam_clear";
    default: return "idle";
  }
}

void applyPhaseOutputs() {
  switch (phase) {
    case PHASE_PRE_SPIN:
    case PHASE_POST_SPIN:
      setMotor(auger, DIR_BRAKE, 0);
      setMotor(impeller, DIR_FORWARD, job.impellerSpeed);
      break;
    case PHASE_FEEDING:
      setMotor(impeller, DIR_FORWARD, job.impellerSpeed);
      setMotor(auger, DIR_FORWARD, job.augerSpeed);
      break;
    case PHASE_JAM_CLEAR:
      setMotor(impeller, DIR_BRAKE, 0);
      setMotor(auger, DIR_REVERSE, job.augerSpeed);
      break;
    default:
      brakeAll();
      break;
  }
}

void enterPhase(Phase next) {
  phase = next;
  phaseStartedAt = millis();
  applyPhaseOutputs();
  telemetryDirty = true;
}

// ---------------------------------------------------------------- buttons (state)
Button buttonA = {PIN_BUTTON_A, false, false, 0};
Button buttonB = {PIN_BUTTON_B, false, false, 0};

// ---------------------------------------------------------------- BLE state
BLEServer* bleServer = nullptr;
BLECharacteristic* cmdChar = nullptr;
BLECharacteristic* responseChar = nullptr;
BLECharacteristic* telemetryChar = nullptr;
BLECharacteristic* statusChar = nullptr;
BLECharacteristic* schedulesChar = nullptr;
BLECharacteristic* timeChar = nullptr;
BLECharacteristic* feedLogChar = nullptr;

volatile bool bleConnected = false;
volatile bool restartAdvertising = false;
volatile bool sendStatusSoon = false;

QueueHandle_t commandQueue;

portMUX_TYPE scheduleMux = portMUX_INITIALIZER_UNLOCKED;
// Last accepted schedule JSON, served back page by page on READ.
uint8_t scheduleJson[SCHEDULE_BUFFER_MAX];
size_t scheduleJsonLen = 0;
uint16_t scheduleReadPage = 0;
// Incoming schedule pages, assembled in the BLE task and parsed in loop().
uint8_t scheduleRx[SCHEDULE_BUFFER_MAX];
size_t scheduleRxLen = 0;
uint16_t scheduleRxTotal = 0;
uint16_t scheduleRxNext = 0;
volatile bool scheduleRxReady = false;
volatile bool scheduleRxFailed = false;

volatile int16_t tzOffsetMinutes = TZ_OFFSET_MINUTES_DEFAULT;
volatile bool tzOffsetDirty = false;

Preferences prefs;
uint32_t telemetryIntervalMs = TELEMETRY_DEFAULT_MS;
uint32_t lastTelemetryAt = 0;

// ---------------------------------------------------------------- notifications
void sendJson(BLECharacteristic* characteristic, JsonDocument& doc) {
  char buffer[512];
  size_t length = serializeJson(doc, buffer, sizeof(buffer));
  characteristic->setValue((uint8_t*)buffer, length);
  if (bleConnected) characteristic->notify();
}

void sendError(const char* message, const char* action = nullptr) {
  JsonDocument doc;
  doc["type"] = "error";
  doc["data"]["message"] = message;
  if (action) doc["data"]["action"] = action;
  sendJson(responseChar, doc);
  Serial.printf("[error] %s\n", message);
}

void sendControlResponse(const char* action, bool success) {
  JsonDocument doc;
  doc["type"] = "control_response";
  JsonObject data = doc["data"].to<JsonObject>();
  data["action"] = action;
  data["success"] = success;
  data["motorState"] = phaseName(phase);
  sendJson(responseChar, doc);
}

void sendTelemetry() {
  JsonDocument doc;
  doc["type"] = "sensor_data";
  JsonObject data = doc["data"].to<JsonObject>();
  data["motorState"] = phaseName(phase);
  data["augerSpeed"] = auger.speed;
  data["impellerSpeed"] = impeller.speed;
  data["augerDirection"] = directionName(auger.dir);
  data["impellerDirection"] = directionName(impeller.dir);
  data["buttonAPressed"] = buttonA.pressed;
  data["buttonBPressed"] = buttonB.pressed;
  sendJson(telemetryChar, doc);
  lastTelemetryAt = millis();
  telemetryDirty = false;
}

void sendStatus() {
  JsonDocument doc;
  doc["type"] = "status";
  JsonObject data = doc["data"].to<JsonObject>();
  data["connected"] = true;
  data["firmware"] = "floyd-xiao-esp32s3-1.0";
  data["timeSynced"] = time(nullptr) > TIME_VALID_AFTER;
  sendJson(statusChar, doc);
}

void sendFeedComplete(bool success, const char* errorMessage) {
  JsonDocument doc;
  doc["type"] = "control_response";
  JsonObject data = doc["data"].to<JsonObject>();
  data["action"] = "feed_complete";
  data["success"] = success;
  data["augerSpeed"] = job.augerSpeed;
  data["impellerSpeed"] = job.impellerSpeed;
  data["feedMs"] = job.feedMs;
  data["source"] = job.source;
  if (errorMessage) data["errorMessage"] = errorMessage;
  sendJson(feedLogChar, doc);
}

// ---------------------------------------------------------------- actions
bool isFeedPhase(Phase p) {
  return p == PHASE_PRE_SPIN || p == PHASE_FEEDING || p == PHASE_POST_SPIN;
}

bool startFeed(const FeedJob& next) {
  if (phase != PHASE_IDLE) return false;
  job = next;
  job.augerSpeed = min<uint16_t>(job.augerSpeed, PWM_MAX);
  job.impellerSpeed = min<uint16_t>(job.impellerSpeed, PWM_MAX);
  job.preMs = min(job.preMs, SPIN_MAX_MS);
  job.feedMs = min(job.feedMs, FEED_MAX_MS);
  job.postMs = min(job.postMs, SPIN_MAX_MS);
  Serial.printf("[feed] start (%s) auger=%u impeller=%u feed=%lums\n", job.source,
                job.augerSpeed, job.impellerSpeed, (unsigned long)job.feedMs);
  enterPhase(PHASE_PRE_SPIN);
  return true;
}

void startJamClear(uint16_t speed, uint32_t durationMs) {
  if (isFeedPhase(phase)) sendFeedComplete(false, "Stopped to clear a jam");
  job.augerSpeed = min<uint16_t>(speed, PWM_MAX);
  job.impellerSpeed = 0;
  job.source = "jam";
  jamDurationMs = min(durationMs, JAM_MAX_MS);
  Serial.printf("[jam] reverse auger for %lums\n", (unsigned long)jamDurationMs);
  enterPhase(PHASE_JAM_CLEAR);
}

void stopAll(const char* reason) {
  if (isFeedPhase(phase)) sendFeedComplete(false, reason);
  Serial.printf("[stop] %s\n", reason);
  enterPhase(PHASE_IDLE);
}

void updateSequence() {
  uint32_t elapsed = millis() - phaseStartedAt;
  switch (phase) {
    case PHASE_PRE_SPIN:
      if (elapsed >= job.preMs) enterPhase(PHASE_FEEDING);
      break;
    case PHASE_FEEDING:
      if (elapsed >= job.feedMs) enterPhase(PHASE_POST_SPIN);
      break;
    case PHASE_POST_SPIN:
      if (elapsed >= job.postMs) {
        enterPhase(PHASE_IDLE);
        sendFeedComplete(true, nullptr);
        Serial.println("[feed] complete");
      }
      break;
    case PHASE_JAM_CLEAR:
      if (elapsed >= jamDurationMs) {
        enterPhase(PHASE_IDLE);
        sendControlResponse("clear_jam", true);
      }
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------- buttons
// Returns true once per debounced press (HIGH -> LOW edge).
bool pollButton(Button& b) {
  bool reading = digitalRead(b.pin) == LOW;  // inverted logic: LOW = pressed
  if (reading != b.lastReading) {
    b.lastReading = reading;
    b.changedAt = millis();
  }
  if (reading != b.pressed && millis() - b.changedAt >= DEBOUNCE_MS) {
    b.pressed = reading;
    telemetryDirty = true;
    return b.pressed;
  }
  return false;
}

void updateButtons() {
  if (pollButton(buttonA)) {
    if (phase == PHASE_IDLE) {
      startFeed({FEED_DEFAULT_AUGER, FEED_DEFAULT_IMPELLER, FEED_DEFAULT_PRE_MS,
                 FEED_DEFAULT_FEED_MS, FEED_DEFAULT_POST_MS, "button"});
    } else {
      stopAll("Stopped by Button A");
    }
  }
  if (pollButton(buttonB)) {
    startJamClear(JAM_DEFAULT_SPEED, JAM_DEFAULT_MS);
  }
}

// ---------------------------------------------------------------- schedules
Schedule schedules[MAX_SCHEDULES];
size_t scheduleCount = 0;
int32_t lastAttemptedScheduleMinute = -1;

bool readSpeed(JsonVariantConst v, uint16_t& out) {
  if (!v.is<float>()) return false;
  float value = v.as<float>();
  if (value < 0 || value > PWM_MAX) return false;
  out = (uint16_t)value;
  return true;
}

bool readMs(JsonVariantConst v, uint32_t& out) {
  if (!v.is<float>()) return false;
  float value = v.as<float>();
  if (value < 0) return false;
  out = (uint32_t)value;
  return true;
}

// Parses and validates a schedule list. Fills `out` only when the whole list is valid.
bool parseSchedules(const uint8_t* json, size_t length, Schedule* out, size_t& count, const char*& error) {
  JsonDocument doc;
  if (deserializeJson(doc, json, length)) { error = "Schedule JSON is invalid."; return false; }
  if (!doc.is<JsonArray>()) { error = "Schedules must be a JSON list."; return false; }
  JsonArrayConst list = doc.as<JsonArrayConst>();
  if (list.size() > MAX_SCHEDULES) { error = "The feeder supports at most 10 schedules."; return false; }

  count = 0;
  for (JsonObjectConst item : list) {
    Schedule s = {};
    const char* timeText = item["time"] | "";
    const char* days = item["daysOfWeek"] | "";
    int hour = -1, minute = -1;
    if (strlen(timeText) != 5 || sscanf(timeText, "%d:%d", &hour, &minute) != 2 ||
        hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      error = "Schedule time must be HH:MM."; return false;
    }
    for (const char* p = days; *p; ++p) {
      if (*p >= '0' && *p <= '6') s.daysMask |= 1 << (*p - '0');
    }
    if (!item["enabled"].is<bool>() ||
        !readSpeed(item["augerSpeed"], s.job.augerSpeed) ||
        !readSpeed(item["impellerSpeed"], s.job.impellerSpeed) ||
        !readMs(item["preSpinMs"], s.job.preMs) ||
        !readMs(item["feedMs"], s.job.feedMs) ||
        !readMs(item["postSpinMs"], s.job.postMs)) {
      error = "Schedule has missing or out-of-range fields."; return false;
    }
    s.hour = hour;
    s.minute = minute;
    s.enabled = item["enabled"].as<bool>();
    s.job.source = "schedule";
    out[count++] = s;
  }
  return true;
}

void storeScheduleJson(const uint8_t* json, size_t length) {
  portENTER_CRITICAL(&scheduleMux);
  memcpy(scheduleJson, json, length);
  scheduleJsonLen = length;
  scheduleReadPage = 0;
  portEXIT_CRITICAL(&scheduleMux);
}

void loadSchedulesFromFlash() {
  static uint8_t buffer[SCHEDULE_BUFFER_MAX];
  size_t length = prefs.getBytesLength("sched");
  if (length == 0 || length > sizeof(buffer)) length = 0;
  else length = prefs.getBytes("sched", buffer, sizeof(buffer));

  const char* error = nullptr;
  if (length > 0 && parseSchedules(buffer, length, schedules, scheduleCount, error)) {
    storeScheduleJson(buffer, length);
  } else {
    scheduleCount = 0;
    storeScheduleJson((const uint8_t*)"[]", 2);
  }
  Serial.printf("[schedules] %u loaded\n", (unsigned)scheduleCount);
}

void handleScheduleUpload() {
  if (scheduleRxFailed) {
    scheduleRxFailed = false;
    sendError("Schedule upload failed: pages arrived out of order or exceeded 4096 bytes.", "set_schedules");
  }
  if (!scheduleRxReady) return;

  Schedule parsed[MAX_SCHEDULES];
  size_t count = 0;
  const char* error = nullptr;
  if (!parseSchedules(scheduleRx, scheduleRxLen, parsed, count, error)) {
    sendError(error, "set_schedules");
  } else if (prefs.putBytes("sched", scheduleRx, scheduleRxLen) != scheduleRxLen) {
    sendError("The feeder could not save schedules to flash.", "set_schedules");
  } else {
    memcpy(schedules, parsed, sizeof(Schedule) * count);
    scheduleCount = count;
    storeScheduleJson(scheduleRx, scheduleRxLen);
    Serial.printf("[schedules] %u saved\n", (unsigned)count);
    sendControlResponse("set_schedules", true);
  }
  scheduleRxReady = false;
}

void runSchedules() {
  time_t now = time(nullptr);
  if (now < TIME_VALID_AFTER) return;  // clock not synced yet
  time_t local = now + (time_t)tzOffsetMinutes * 60;
  struct tm t;
  gmtime_r(&local, &t);
  int32_t minuteKey = (int32_t)(local / 60);
  if (lastAttemptedScheduleMinute == minuteKey) return;

  for (size_t i = 0; i < scheduleCount; ++i) {
    Schedule& s = schedules[i];
    if (!s.enabled) continue;
    if (s.hour != t.tm_hour || s.minute != t.tm_min || !(s.daysMask & (1 << t.tm_wday))) continue;
    // The feeder attempts one scheduled feed per minute, including across list edits.
    lastAttemptedScheduleMinute = minuteKey;
    if (!startFeed(s.job)) Serial.println("[schedules] skipped: feeder busy");
    break;
  }
}

// ---------------------------------------------------------------- commands
void handleCommand(const char* json) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) { sendError("Command JSON is invalid."); return; }
  const char* action = doc["action"] | "";
  JsonVariantConst params = doc["parameters"];

  if (strcmp(action, "start_feed") == 0) {
    FeedJob next = {
      (uint16_t)(params["augerSpeed"] | (int)FEED_DEFAULT_AUGER),
      (uint16_t)(params["impellerSpeed"] | (int)FEED_DEFAULT_IMPELLER),
      (uint32_t)(params["preSpinMs"] | (long)FEED_DEFAULT_PRE_MS),
      (uint32_t)(params["feedMs"] | (long)FEED_DEFAULT_FEED_MS),
      (uint32_t)(params["postSpinMs"] | (long)FEED_DEFAULT_POST_MS),
      "app",
    };
    if (startFeed(next)) sendControlResponse(action, true);
    else sendError("The feeder is busy.");
  } else if (strcmp(action, "stop_feed") == 0) {
    stopAll("Stopped from the app");
    sendControlResponse(action, true);
  } else if (strcmp(action, "clear_jam") == 0) {
    startJamClear((uint16_t)(params["speed"] | (int)JAM_DEFAULT_SPEED),
                  (uint32_t)(params["duration"] | (long)JAM_DEFAULT_MS));
    sendControlResponse(action, true);
  } else if (strcmp(action, "get_sensors") == 0) {
    sendTelemetry();
  } else if (strcmp(action, "ping") == 0) {
    sendControlResponse(action, true);
  } else if (strcmp(action, "set_sensor_interval") == 0) {
    long interval = params["interval"] | (long)TELEMETRY_DEFAULT_MS;
    telemetryIntervalMs = constrain(interval, 1000L, 60000L);
    sendControlResponse(action, true);
  } else if (strcmp(action, "get_schedules") == 0) {
    sendControlResponse(action, true);  // the app reads the schedules characteristic
  } else {
    sendError("This command is not supported by the Floyd feeder firmware.");
  }
}

// ---------------------------------------------------------------- BLE callbacks
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) {
    bleConnected = true;
    sendStatusSoon = true;
    portENTER_CRITICAL(&scheduleMux);
    scheduleReadPage = 0;
    portEXIT_CRITICAL(&scheduleMux);
  }
  void onDisconnect(BLEServer*) {
    bleConnected = false;
    restartAdvertising = true;
  }
};

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) {
    CommandBuffer buffer;
    size_t length = min(c->getLength(), sizeof(buffer.json) - 1);
    memcpy(buffer.json, c->getData(), length);
    buffer.json[length] = '\0';
    if (xQueueSend(commandQueue, &buffer, 0) != pdTRUE) Serial.println("[ble] command queue full");
  }
};

class TimeCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) {
    size_t length = c->getLength();
    const uint8_t* d = c->getData();
    if (length < 4) return;
    uint32_t seconds = d[0] | (d[1] << 8) | (d[2] << 16) | ((uint32_t)d[3] << 24);
    struct timeval tv = {(time_t)seconds, 0};
    settimeofday(&tv, nullptr);
    if (length >= 6) {
      tzOffsetMinutes = (int16_t)(d[4] | (d[5] << 8));
      tzOffsetDirty = true;
    }
    sendStatusSoon = true;
  }
};

class ScheduleCallbacks : public BLECharacteristicCallbacks {
  // Each READ returns the next page; the cursor wraps after the last page.
  void onRead(BLECharacteristic* c) {
    static uint8_t page[4 + SCHEDULE_PAGE_PAYLOAD];
    portENTER_CRITICAL(&scheduleMux);
    uint16_t total = max<size_t>(1, (scheduleJsonLen + SCHEDULE_PAGE_PAYLOAD - 1) / SCHEDULE_PAGE_PAYLOAD);
    uint16_t index = scheduleReadPage % total;
    size_t offset = (size_t)index * SCHEDULE_PAGE_PAYLOAD;
    size_t length = min(SCHEDULE_PAGE_PAYLOAD, scheduleJsonLen - offset);
    page[0] = index & 0xff;
    page[1] = index >> 8;
    page[2] = total & 0xff;
    page[3] = total >> 8;
    memcpy(page + 4, scheduleJson + offset, length);
    scheduleReadPage = (index + 1) % total;
    portEXIT_CRITICAL(&scheduleMux);
    c->setValue(page, 4 + length);
  }

  void onWrite(BLECharacteristic* c) {
    size_t length = c->getLength();
    const uint8_t* d = c->getData();
    if (scheduleRxReady || length < 4) { scheduleRxFailed = true; return; }
    uint16_t index = d[0] | (d[1] << 8);
    uint16_t total = d[2] | (d[3] << 8);
    size_t payload = length - 4;
    if (index == 0) {
      scheduleRxLen = 0;
      scheduleRxTotal = total;
      scheduleRxNext = 0;
    }
    if (total == 0 || total != scheduleRxTotal || index != scheduleRxNext ||
        scheduleRxLen + payload > SCHEDULE_BUFFER_MAX) {
      scheduleRxTotal = 0;  // drop the rest of this upload
      scheduleRxFailed = true;
      return;
    }
    memcpy(scheduleRx + scheduleRxLen, d + 4, payload);
    scheduleRxLen += payload;
    scheduleRxNext++;
    if (scheduleRxNext == scheduleRxTotal) scheduleRxReady = true;
  }
};

BLECharacteristic* addCharacteristic(BLEService* service, const char* uuid, uint32_t properties) {
  if (properties & BLECharacteristic::PROPERTY_WRITE) {
    properties |= BLECharacteristic::PROPERTY_WRITE_ENC | BLECharacteristic::PROPERTY_WRITE_AUTHEN;
  }
  return service->createCharacteristic(uuid, properties);
}

class OwnerPairingCallbacks : public BLESecurityCallbacks {
  uint32_t onPassKeyRequest() override { return UINT32_MAX; }  // The feeder is display-only.
  bool onConfirmPIN(uint32_t) override { return false; }
  bool onSecurityRequest() override { return true; }
  void onPassKeyNotify(uint32_t passkey) override {
    Serial.printf("[ble] Enter this pairing code on your phone: %06lu\n", (unsigned long)passkey);
  }
  void onAuthenticationComplete(ble_gap_conn_desc* connection, int status) override {
    Serial.println(status == 0 && connection->sec_state.authenticated
      ? "[ble] Pairing complete" : "[ble] Pairing failed");
  }
};

void setupBle() {
  char chipId[7];
  snprintf(chipId, sizeof(chipId), "%06llX", (unsigned long long)(ESP.getEfuseMac() & 0xFFFFFF));
  String name = String("FloydFeeder-") + chipId;

  BLEDevice::init(name.c_str());
  BLEDevice::setSecurityCallbacks(new OwnerPairingCallbacks());
  BLESecurity::setAuthenticationMode(true, true, true);  // Bonding, MITM, Secure Connections.
  ble_hs_cfg.sm_sc_only = 1;
  BLESecurity::setCapability(ESP_IO_CAP_OUT);
  BLESecurity::setInitEncryptionKey();
  BLESecurity::setRespEncryptionKey();
  BLESecurity::setPassKey(false);
  BLESecurity::regenPassKeyOnConnect(true);
  BLESecurity::setForceAuthentication(false);  // Start pairing when the phone tries a protected write.
  BLEDevice::setMTU(517);
  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new ServerCallbacks());

  BLEService* service = bleServer->createService(BLEUUID(SERVICE_UUID), 32);
  cmdChar = addCharacteristic(service, CMD_UUID, BLECharacteristic::PROPERTY_WRITE);
  responseChar = addCharacteristic(service, RESPONSE_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  telemetryChar = addCharacteristic(service, TELEMETRY_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  statusChar = addCharacteristic(service, STATUS_UUID,
                                 BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  schedulesChar = addCharacteristic(service, SCHEDULES_UUID,
                                    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE);
  timeChar = addCharacteristic(service, TIME_UUID, BLECharacteristic::PROPERTY_WRITE);
  feedLogChar = addCharacteristic(service, FEEDLOG_UUID, BLECharacteristic::PROPERTY_NOTIFY);

  cmdChar->setCallbacks(new CommandCallbacks());
  timeChar->setCallbacks(new TimeCallbacks());
  schedulesChar->setCallbacks(new ScheduleCallbacks());
  service->start();
  sendStatus();

  // A 128-bit UUID and the name do not fit together in 31 bytes:
  // service UUID goes in the advertisement, the name in the scan response.
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  BLEAdvertisementData advData;
  advData.setFlags(0x06);  // general discoverable, BLE only
  advData.setCompleteServices(BLEUUID(SERVICE_UUID));
  BLEAdvertisementData scanData;
  scanData.setName(name.c_str());
  advertising->setAdvertisementData(advData);
  advertising->setScanResponseData(scanData);
  BLEDevice::startAdvertising();
  Serial.printf("[ble] advertising as %s\n", name.c_str());
}

// ---------------------------------------------------------------- setup / loop
void setup() {
  // Motors off before anything else: enables LOW (brake) and PWM 0.
  const uint8_t outputs[] = {
    PIN_IMPELLER_FWD, PIN_IMPELLER_REV, PIN_IMPELLER_PWM,
    PIN_AUGER_FWD, PIN_AUGER_REV, PIN_AUGER_PWM,
  };
  for (uint8_t pin : outputs) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
  }
  Serial.begin(115200);
  if (!ledcAttach(PIN_IMPELLER_PWM, MOTOR_PWM_HZ, MOTOR_PWM_BITS) ||
      !ledcAttach(PIN_AUGER_PWM, MOTOR_PWM_HZ, MOTOR_PWM_BITS) ||
      !ledcWrite(PIN_IMPELLER_PWM, 0) || !ledcWrite(PIN_AUGER_PWM, 0)) {
    for (;;) {
      Serial.println("[motor] Could not initialize PWM. Motors remain braked.");
      delay(1000);
    }
  }
  pinMode(PIN_BUTTON_A, INPUT_PULLUP);
  pinMode(PIN_BUTTON_B, INPUT_PULLUP);

  delay(200);
  Serial.println("\nFloyd Feeder (XIAO ESP32S3)");

  commandQueue = xQueueCreate(4, sizeof(CommandBuffer));
  prefs.begin("floyd", false);
  tzOffsetMinutes = prefs.getShort("tz", TZ_OFFSET_MINUTES_DEFAULT);
  loadSchedulesFromFlash();
  setupBle();
}

void loop() {
  CommandBuffer command;
  while (xQueueReceive(commandQueue, &command, 0) == pdTRUE) handleCommand(command.json);

  updateButtons();
  updateSequence();
  handleScheduleUpload();

  static uint32_t lastScheduleCheck = 0;
  if (millis() - lastScheduleCheck >= 1000) {
    lastScheduleCheck = millis();
    runSchedules();
  }

  if (tzOffsetDirty) {
    tzOffsetDirty = false;
    prefs.putShort("tz", tzOffsetMinutes);
  }
  if (sendStatusSoon) {
    sendStatusSoon = false;
    sendStatus();
  }
  if (restartAdvertising) {
    restartAdvertising = false;
    delay(100);
    BLEDevice::startAdvertising();
    Serial.println("[ble] disconnected, advertising again");
  }
  if (telemetryDirty || (bleConnected && millis() - lastTelemetryAt >= telemetryIntervalMs)) {
    sendTelemetry();
  }
}
