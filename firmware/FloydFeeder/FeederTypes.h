// Types live in a header so the Arduino IDE's generated prototypes can see them.
#pragma once
#include <Arduino.h>

enum Direction : uint8_t { DIR_BRAKE, DIR_FORWARD, DIR_REVERSE };

struct Motor {
  uint8_t fwdPin;
  uint8_t revPin;
  uint8_t pwmPin;
  Direction dir;
  uint16_t speed;  // 0-1023
};

enum Phase : uint8_t { PHASE_IDLE, PHASE_PRE_SPIN, PHASE_FEEDING, PHASE_POST_SPIN, PHASE_JAM_CLEAR };

struct FeedJob {
  uint16_t augerSpeed;
  uint16_t impellerSpeed;
  uint32_t preMs;
  uint32_t feedMs;
  uint32_t postMs;
  const char* source;  // "app", "button", "schedule", "jam"
};

struct Button {
  uint8_t pin;
  bool pressed;      // debounced
  bool lastReading;  // raw, true = pressed
  uint32_t changedAt;
};

struct Schedule {
  uint8_t hour;
  uint8_t minute;
  uint8_t daysMask;  // bit 0 = Sunday ... bit 6 = Saturday
  bool enabled;
  FeedJob job;
  int32_t lastFiredMinute;
};

struct CommandBuffer {
  char json[512];
};
