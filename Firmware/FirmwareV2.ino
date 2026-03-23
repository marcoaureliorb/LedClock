/**
 * @file    Firmware.ino
 * @brief   LED Clock for ESP8266 — NeoPixel display with Wi-Fi, NTP and REST API.
 *
 * Hardware:
 *   - Clock strip : 252 NeoPixels on pin D5 (GPIO 14)
 *   - Deco  strip :  14 NeoPixels on pin D6 (GPIO 12)
 *   - Light sensor: analog input on A0
 *
 * Features:
 *   - Displays time, date and temperature on a 4-digit NeoPixel clock.
 *   - Fetches current temperature from the hgbrasil weather API.
 *   - Serves a web UI fetched via HTTPS from GitHub.
 *   - REST API for remote configuration of colors and brightness.
 *
 * Display cycle (1 tick = 1 s, full cycle = 60 s):
 *   Ticks  1–49 → time
 *   Ticks 50–54 → date
 *   Ticks 55–59 → temperature
 */

// ============================================================
// Includes
// ============================================================
#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <WiFiUdp.h>
#include <NTPClient.h>
#include <Adafruit_NeoPixel.h>
#include <Arduino_JSON.h>

// ============================================================
// Debug
// ============================================================
#define LOG(...)  Serial.printf(__VA_ARGS__)

// ============================================================
// Hardware — pins & LED counts
// ============================================================
#define PIN_LED_CLOCK       14    // D5
#define PIN_LED_DECO        12    // D6

#define LED_CLOCK_COUNT    252
#define LED_DECO_COUNT      14
#define LEDS_PER_DIGIT      63    // LEDs allocated to each digit position

// ============================================================
// Brightness modes
// ============================================================
#define BRIGHT_OFF           0
#define BRIGHT_ON            1
#define BRIGHT_AUTO          2
#define BRIGHT_DEFAULT       50

// ============================================================
// Display cycle — tick thresholds (1 tick = 1 s)
// ============================================================
#define TICK_SHOW_TIME       1
#define TICK_SHOW_DAY        50
#define TICK_SHOW_TEMP       55
#define TICK_CYCLE_RESET     60

// ============================================================
// Network
// ============================================================
// ⚠ Move credentials to a separate config.h before sharing code!
static const char* WIFI_SSID      = "Biscoitao2.4G";
static const char* WIFI_PASSWORD  = "4luci184";
static const char* WIFI_HOSTNAME  = "WIFI-Clock";

// ============================================================
// NTP
// ============================================================
static const char* NTP_SERVER      = "br.pool.ntp.org";
static const int   NTP_OFFSET_SEC  = -3 * 3600;   // UTC-3 (Brasília)
static const int   NTP_INTERVAL_MS = 60000;        // Sync every 60 s

// ============================================================
// Web / HTTP
// ============================================================
static const char* HTML_GITHUB_URL =
    "https://raw.githubusercontent.com/marcoaureliorb/LedClock/refs/heads/main/WebApi/index.html";
static const int   HTTP_TIMEOUT_MS  = 8000;
static const char* TEMPERATURE_URL  =
    "http://api.hgbrasil.com/weather?woeid=455831&format=json-cors&array_limit=2&fields=only_results,temp,city_name&key=3b983af0";
static const char* CONTENT_TYPE_JSON = "application/json";

// ============================================================
// Light-sensor smoothing
// ============================================================
static const int LIGHT_READINGS_COUNT = 12;

// ============================================================
// Type definitions
// ============================================================
struct RGB {
    uint8_t r;
    uint8_t g;
    uint8_t b;
};

// ============================================================
// Forward declarations — API handlers
// ============================================================
void handleRoot();
void getInfoApi();
void getTimeApi();
void getTemperatureApi();
void getTemperatureUrlApi();
void setHourColorApi();
void setDayColorApi();
void setTempColorApi();
void setClockBrightnessState();
void setDecoBrightnessState();
void setDecoColorApi();
void setHourMinuteToShowApi();
void showTemperatureApi();

// ============================================================
// Forward declarations — Wi-Fi event handlers
// ============================================================
void onWifiConnected(const WiFiEventStationModeConnected& event);
void onWifiGotIP(const WiFiEventStationModeGotIP& event);

// ============================================================
// Global objects
// ============================================================
Adafruit_NeoPixel stripClock(LED_CLOCK_COUNT, PIN_LED_CLOCK, NEO_RGB + NEO_KHZ800);
Adafruit_NeoPixel stripDeco (LED_DECO_COUNT,  PIN_LED_DECO,  NEO_RGB + NEO_KHZ800);

ESP8266WebServer serverWeb(80);

WiFiUDP   ntpUDP;
NTPClient timeClient(ntpUDP, NTP_SERVER, NTP_OFFSET_SEC, NTP_INTERVAL_MS);

// ============================================================
// State — time & date
// ============================================================
static int g_day    = 0;
static int g_month  = 0;
static int g_hour   = 0;
static int g_minute = 0;
static int g_second = 0;

// ============================================================
// State — display colors
// ============================================================
static RGB g_dayColor  [4];
static RGB g_clockColor[4];
static RGB g_tempColor [4];
static RGB g_decoColor [LED_DECO_COUNT];

// ============================================================
// State — brightness
// ============================================================
static int g_brightnessClockMode = BRIGHT_ON;
static int g_brightnessDecoMode  = BRIGHT_ON;
static int g_brightnessSensor    = BRIGHT_DEFAULT;

// ============================================================
// State — light sensor (rolling average)
// ============================================================
static int g_lightReadings[LIGHT_READINGS_COUNT] = {0};
static int g_lightReadIndex = 0;

// ============================================================
// State — temperature
// ============================================================
static int    g_temperature    = -1;
static String g_temperatureUrl = TEMPERATURE_URL;

// ============================================================
// State — display schedule (HHMM format, e.g. 530 = 05:30)
//         Strips are forced off while inside this window.
// ============================================================
static int g_scheduleStart = 0;    // 00:00
static int g_scheduleEnd   = 530;  // 05:30

// ============================================================
// State — display cycle tick counter
// ============================================================
static int g_displayTick = 0;

// ============================================================
// Helpers — RGB utilities
// ============================================================

RGB makeRGB(uint8_t r, uint8_t g, uint8_t b) {
    return {r, g, b};
}

RGB makeRGB(const String& r, const String& g, const String& b) {
    return {(uint8_t)r.toInt(), (uint8_t)g.toInt(), (uint8_t)b.toInt()};
}

/**
 * Parses a comma-separated "R,G,B" string into an RGB struct.
 */
RGB rgbFromString(String str) {
    uint8_t components[3] = {0, 0, 0};
    int     idx           = 0;

    while (str.length() > 0 && idx < 3) {
        int comma = str.indexOf(',');
        if (comma == -1) {
            components[idx++] = (uint8_t)str.toInt();
            break;
        }
        components[idx++] = (uint8_t)str.substring(0, comma).toInt();
        str = str.substring(comma + 1);
    }

    return {components[0], components[1], components[2]};
}

String rgbToString(const RGB& c) {
    return String('(') + c.r + ',' + c.g + ',' + c.b + ')';
}

/**
 * Converts an RGB struct to a NeoPixel color word.
 * The strips are wired in NEO_RGB order, so channels must be swapped.
 */
uint32_t rgbToNeoPixel(const RGB& c) {
    return stripClock.Color(c.g, c.r, c.b);
}

void logRGB(const char* label, const RGB& c) {
    LOG("%s (%u, %u, %u)\n", label, c.r, c.g, c.b);
}

String brightnessModeToStr(int mode) {
    switch (mode) {
        case BRIGHT_OFF:  return "0 - off";
        case BRIGHT_ON:   return "1 - on";
        case BRIGHT_AUTO: return "2 - auto";
        default:          return "invalid";
    }
}

// ============================================================
// Helpers — HTTP / JSON
// ============================================================

void sendJsonResponse(int code, const String& body) {
    serverWeb.send(code, CONTENT_TYPE_JSON, body);
    LOG("%s\n", body.c_str());
}

void sendJsonOk(const String& message) {
    sendJsonResponse(200, String("{\"Status\":\"") + message + "\"}");
}

// ============================================================
// Brightness — read light sensor (rolling average)
// ============================================================

void updateBrightnessSensor() {
    int raw = analogRead(A0);

    g_lightReadings[g_lightReadIndex] = raw;
    g_lightReadIndex = (g_lightReadIndex + 1) % LIGHT_READINGS_COUNT;

    int sum = 0;
    for (int i = 0; i < LIGHT_READINGS_COUNT; i++) {
        sum += g_lightReadings[i];
    }

    int average      = sum / LIGHT_READINGS_COUNT;
    g_brightnessSensor = map(average, 0, 1023, 200, 1);

    LOG("Light sensor raw=%d  avg=%d  mapped=%d\n", raw, average, g_brightnessSensor);
}

// ============================================================
// Brightness — apply to both strips
// ============================================================

void applyBrightness() {
    switch (g_brightnessDecoMode) {
        case BRIGHT_OFF:  stripDeco.setBrightness(0);              break;
        case BRIGHT_ON:   stripDeco.setBrightness(BRIGHT_DEFAULT); break;
        case BRIGHT_AUTO:
            updateBrightnessSensor();
            stripDeco.setBrightness(g_brightnessSensor);
            break;
    }

    switch (g_brightnessClockMode) {
        case BRIGHT_OFF:  stripClock.setBrightness(0);              break;
        case BRIGHT_ON:   stripClock.setBrightness(BRIGHT_DEFAULT); break;
        case BRIGHT_AUTO:
            updateBrightnessSensor();
            stripClock.setBrightness(g_brightnessSensor);
            break;
    }

    // Night-time override: force both strips off during quiet hours
    int currentHHMM = g_hour * 100 + g_minute;
    if (currentHHMM > g_scheduleStart && currentHHMM < g_scheduleEnd) {
        stripDeco.setBrightness(0);
        stripClock.setBrightness(0);
        LOG("Night mode: strips off.\n");
    }
}

// ============================================================
// NTP — read time & date
// ============================================================

void readTheTime() {
    timeClient.update();

    g_hour   = timeClient.getHours();
    g_minute = timeClient.getMinutes();
    g_second = timeClient.getSeconds();

    unsigned long epoch = timeClient.getEpochTime();
    struct tm* t = gmtime((time_t*)&epoch);
    g_day   = t->tm_mday;
    g_month = t->tm_mon + 1;

    LOG("Date: %02d/%02d  Time: %02d:%02d:%02d\n",
        g_day, g_month, g_hour, g_minute, g_second);
}

// ============================================================
// Temperature — fetch from weather API
// ============================================================

void readTheTemperature() {
    // Fetch on startup or at the top/bottom of the hour
    bool shouldFetch = (g_temperature == -1) || (g_minute % 59 == 0);
    if (!shouldFetch) return;

    LOG("[TEMP] Fetching temperature...\n");
    g_temperature = 0;

    WiFiClient client;
    HTTPClient http;

    if (!http.begin(client, g_temperatureUrl)) {
        LOG("[TEMP] Failed to start HTTP connection.\n");
        return;
    }

    int code = http.GET();
    LOG("[TEMP] HTTP code: %d\n", code);

    if (code == HTTP_CODE_OK || code == HTTP_CODE_MOVED_PERMANENTLY) {
        String  payload = http.getString();
        JSONVar data    = JSON.parse(payload);

        if (JSON.typeof(data) == "undefined") {
            LOG("[TEMP] JSON parse failed.\n");
        } else {
            g_temperature = (int)data["temp"];
            LOG("[TEMP] Temperature: %d C\n", g_temperature);
        }
    } else {
        LOG("[TEMP] GET failed: %s\n", http.errorToString(code).c_str());
    }

    http.end();
}

// ============================================================
// LED primitives — digit segments
//
// Each digit occupies LEDS_PER_DIGIT (63) LEDs split into
// 7 segments of 9 LEDs each. Segments are addressed by their
// start offset within the digit's slot.
// ============================================================

void digitZero (int o, uint32_t c) { stripClock.fill(c, o +  0, 27); stripClock.fill(c, o + 36, 27); }
void digitOne  (int o, uint32_t c) { stripClock.fill(c, o +  0,  9); stripClock.fill(c, o + 36,  9); }
void digitTwo  (int o, uint32_t c) { stripClock.fill(c, o +  0, 18); stripClock.fill(c, o + 27,  9); stripClock.fill(c, o + 45, 18); }
void digitThree(int o, uint32_t c) { stripClock.fill(c, o +  0, 18); stripClock.fill(c, o + 27, 27); }
void digitFour (int o, uint32_t c) { stripClock.fill(c, o +  0,  9); stripClock.fill(c, o + 18, 27); }
void digitFive (int o, uint32_t c) { stripClock.fill(c, o +  9, 45); }
void digitSix  (int o, uint32_t c) { stripClock.fill(c, o +  9, 54); }
void digitSeven(int o, uint32_t c) { stripClock.fill(c, o +  0, 18); stripClock.fill(c, o + 36,  9); }
void digitEight(int o, uint32_t c) { stripClock.fill(c, o +  0, 63); }
void digitNine (int o, uint32_t c) { stripClock.fill(c, o +  0, 45); }
void letterC       (int o, uint32_t c) { stripClock.fill(c, o +  9, 18); stripClock.fill(c, o + 45, 18); }
void symbolDegrees (int o, uint32_t c) { stripClock.fill(c, o +  0, 36); }

void displayDigit(int digit, int offset, uint32_t color) {
    switch (digit) {
        case 0: digitZero (offset, color); break;
        case 1: digitOne  (offset, color); break;
        case 2: digitTwo  (offset, color); break;
        case 3: digitThree(offset, color); break;
        case 4: digitFour (offset, color); break;
        case 5: digitFive (offset, color); break;
        case 6: digitSix  (offset, color); break;
        case 7: digitSeven(offset, color); break;
        case 8: digitEight(offset, color); break;
        case 9: digitNine (offset, color); break;
        default: break;
    }
}

// ============================================================
// Display — shared four-digit renderer
//
// Digits are laid out right-to-left on the strip:
//   slot 0 → offset   0  (rightmost)
//   slot 1 → offset  63
//   slot 2 → offset 126
//   slot 3 → offset 189  (leftmost)
//
// colors[3] → slot 0,  colors[2] → slot 1, etc.
// ============================================================

void displayFourDigits(int d0, int d1, int d2, int d3, RGB colors[4]) {
    stripClock.clear();
    displayDigit(d0, 0 * LEDS_PER_DIGIT, rgbToNeoPixel(colors[3]));  logRGB("Slot 0:", colors[3]);
    displayDigit(d1, 1 * LEDS_PER_DIGIT, rgbToNeoPixel(colors[2]));  logRGB("Slot 1:", colors[2]);
    displayDigit(d2, 2 * LEDS_PER_DIGIT, rgbToNeoPixel(colors[1]));  logRGB("Slot 2:", colors[1]);
    displayDigit(d3, 3 * LEDS_PER_DIGIT, rgbToNeoPixel(colors[0]));  logRGB("Slot 3:", colors[0]);
}

void displayTheTime() {
    displayFourDigits(
        g_minute % 10, g_minute / 10,
        g_hour   % 10, g_hour   / 10,
        g_clockColor
    );
}

void displayTheDay() {
    displayFourDigits(
        g_month % 10, g_month / 10,
        g_day   % 10, g_day   / 10,
        g_dayColor
    );
}

void displayTheTemperature() {
    stripClock.clear();
    letterC      (0 * LEDS_PER_DIGIT, rgbToNeoPixel(g_tempColor[3]));  logRGB("Letter C :", g_tempColor[3]);
    symbolDegrees(1 * LEDS_PER_DIGIT, rgbToNeoPixel(g_tempColor[2]));  logRGB("Degrees  :", g_tempColor[2]);
    displayDigit (g_temperature % 10, 2 * LEDS_PER_DIGIT, rgbToNeoPixel(g_tempColor[1]));  logRGB("Temp d0  :", g_tempColor[1]);
    displayDigit (g_temperature / 10, 3 * LEDS_PER_DIGIT, rgbToNeoPixel(g_tempColor[0]));  logRGB("Temp d1  :", g_tempColor[0]);
}

// ============================================================
// Web — serve UI from GitHub via HTTPS streaming
// ============================================================

void handleRoot() {
    LOG("[HTTP] GET /  — Fetching HTML from GitHub...\n");

    WiFiClientSecure tlsClient;
    // ⚠ setInsecure() skips certificate validation.
    // For production use tlsClient.setFingerprint() or setTrustAnchors().
    tlsClient.setInsecure();

    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.begin(tlsClient, HTML_GITHUB_URL);

    int code = http.GET();
    LOG("[HTTP] GitHub response: %d\n", code);

    if (code == HTTP_CODE_OK) {
        WiFiClient* stream  = http.getStreamPtr();
        int         totalLen = http.getSize();

        serverWeb.setContentLength(totalLen > 0 ? totalLen : CONTENT_LENGTH_UNKNOWN);
        serverWeb.send(200, "text/html", "");

        // 512-byte buffer is safe for ESP8266's limited RAM
        const size_t BUF_SIZE = 512;
        uint8_t      buf[BUF_SIZE];
        int          bytesSent = 0;
        uint32_t     deadline  = millis() + HTTP_TIMEOUT_MS;

        while (http.connected() && millis() < deadline) {
            size_t available = stream->available();
            if (available == 0) { delay(1); continue; }

            size_t toRead = min(available, BUF_SIZE);
            size_t nRead  = stream->readBytes(buf, toRead);
            if (nRead > 0) {
                serverWeb.client().write(buf, nRead);
                bytesSent += nRead;
                deadline   = millis() + HTTP_TIMEOUT_MS;  // reset on each chunk
            }
        }

        LOG("[HTTP] Streaming complete: %d bytes sent.\n", bytesSent);

    } else {
        String err =
            "<!DOCTYPE html><html><head><meta charset='UTF-8'>"
            "<title>Error</title></head>"
            "<body style='font-family:monospace;background:#07080d;color:#ff4444;padding:40px'>"
            "<h2>Failed to load interface</h2>"
            "<p>Could not fetch HTML from GitHub.</p>"
            "<p>HTTP code: <b>" + String(code) + "</b></p>"
            "<p><a href='/' style='color:#00c8ff'>Retry</a></p>"
            "</body></html>";

        serverWeb.send(502, "text/html", err);
        LOG("[HTTP] Failed. Code: %d\n", code);
    }

    http.end();
}

// ============================================================
// Web — API helper: parse brightness state from query param
// ============================================================

int parseBrightnessState(const String& arg) {
    String s = arg;
    s.toUpperCase();
    if (s == "OFF") return BRIGHT_OFF;
    if (s == "ON")  return BRIGHT_ON;
    return BRIGHT_AUTO;
}

// ============================================================
// Web — REST API: validate digit position (1-indexed, size n)
// ============================================================

bool validatePosition(int pos, int size) {
    if (pos < 0 || pos >= size) {
        sendJsonResponse(400, "{\"Error\":\"Invalid position\"}");
        return false;
    }
    return true;
}

// ============================================================
// Web — REST API handlers
// ============================================================

void getInfoApi() {
    String sensorValues;
    for (int i = 0; i < LIGHT_READINGS_COUNT; i++) {
        sensorValues += String(g_lightReadings[i]) + " - ";
    }

    String decoColors;
    for (int i = 0; i < LED_DECO_COUNT; i++) {
        decoColors += rgbToString(g_decoColor[i]) + " - ";
    }

    String response = String("{")
        + "\"Time\":\""                     + g_hour + ":" + g_minute + ":" + g_second + "\","
        + "\"Clock_First_Day_Color\":\""    + rgbToString(g_dayColor[0])    + "\","
        + "\"Clock_Second_Day_Color\":\""   + rgbToString(g_dayColor[1])    + "\","
        + "\"Clock_First_Month_Color\":\""  + rgbToString(g_dayColor[2])    + "\","
        + "\"Clock_Second_Month_Color\":\"" + rgbToString(g_dayColor[3])    + "\","
        + "\"Clock_First_Hour_Color\":\""   + rgbToString(g_clockColor[0])  + "\","
        + "\"Clock_Second_Hour_Color\":\""  + rgbToString(g_clockColor[1])  + "\","
        + "\"Clock_First_Minute_Color\":\"" + rgbToString(g_clockColor[2])  + "\","
        + "\"Clock_Second_Minute_Color\":\"" + rgbToString(g_clockColor[3]) + "\","
        + "\"Clock_Brightness_Mode\":\""    + brightnessModeToStr(g_brightnessClockMode) + "\","
        + "\"Brightness_Sensor_Values\":\""  + sensorValues + "\","
        + "\"Brightness_Sensor_Mapped\":"    + g_brightnessSensor + ","
        + "\"Temperature\":\""              + g_temperature + " C\","
        + "\"Temperature_URL\":\""          + g_temperatureUrl + "\","
        + "\"Temp_First_Value_Color\":\""   + rgbToString(g_tempColor[0]) + "\","
        + "\"Temp_Second_Value_Color\":\""  + rgbToString(g_tempColor[1]) + "\","
        + "\"Temp_First_Symbol_Color\":\""  + rgbToString(g_tempColor[2]) + "\","
        + "\"Temp_Second_Symbol_Color\":\"" + rgbToString(g_tempColor[3]) + "\","
        + "\"Deco_Color\":\""               + decoColors + "\","
        + "\"Deco_Brightness_Mode\":\""     + brightnessModeToStr(g_brightnessDecoMode) + "\","
        + "\"Schedule\":\""                 + g_scheduleStart + " to " + g_scheduleEnd + "\""
        + "}";

    sendJsonResponse(200, response);
}

void getTimeApi() {
    sendJsonResponse(200,
        String("{\"Time\":\"") + g_hour + ":" + g_minute + ":" + g_second + "\"}");
}

void getTemperatureApi() {
    sendJsonResponse(200,
        String("{\"Temperature\":\"") + g_temperature + " C\"}");
}

void getTemperatureUrlApi() {
    sendJsonResponse(200,
        String("{\"Temperature_URL\":\"") + g_temperatureUrl + "\"}");
}

void showTemperatureApi() {
    sendJsonOk("Show temperature triggered.");
}

void setHourMinuteToShowApi() {
    g_scheduleStart = serverWeb.arg(0).toInt() * 100 + serverWeb.arg(1).toInt();
    g_scheduleEnd   = serverWeb.arg(2).toInt() * 100 + serverWeb.arg(3).toInt();
    sendJsonOk(String("Schedule set: ") + g_scheduleStart + " to " + g_scheduleEnd);
}

void setHourColorApi() {
    int pos = serverWeb.arg(0).toInt() - 1;
    if (!validatePosition(pos, 4)) return;
    g_clockColor[pos] = makeRGB(serverWeb.arg(1), serverWeb.arg(2), serverWeb.arg(3));
    sendJsonOk(String("Clock color ") + (pos + 1) + " set to " + rgbToString(g_clockColor[pos]));
}

void setDayColorApi() {
    int pos = serverWeb.arg(0).toInt() - 1;
    if (!validatePosition(pos, 4)) return;
    g_dayColor[pos] = makeRGB(serverWeb.arg(1), serverWeb.arg(2), serverWeb.arg(3));
    sendJsonOk(String("Day color ") + (pos + 1) + " set to " + rgbToString(g_dayColor[pos]));
}

void setTempColorApi() {
    int pos = serverWeb.arg(0).toInt() - 1;
    if (!validatePosition(pos, 4)) return;
    g_tempColor[pos] = makeRGB(serverWeb.arg(1), serverWeb.arg(2), serverWeb.arg(3));
    sendJsonOk(String("Temperature color ") + (pos + 1) + " set to " + rgbToString(g_tempColor[pos]));
}

void setDecoColorApi() {
    int pos = serverWeb.arg(0).toInt() - 1;
    if (!validatePosition(pos, LED_DECO_COUNT)) return;
    g_decoColor[pos] = makeRGB(serverWeb.arg(1), serverWeb.arg(2), serverWeb.arg(3));
    sendJsonOk(String("Deco LED ") + (pos + 1) + " set to " + rgbToString(g_decoColor[pos]));
}

void setClockBrightnessState() {
    g_brightnessClockMode = parseBrightnessState(serverWeb.arg(0));
    sendJsonOk(String("Clock brightness set to ") + brightnessModeToStr(g_brightnessClockMode));
}

void setDecoBrightnessState() {
    g_brightnessDecoMode = parseBrightnessState(serverWeb.arg(0));
    sendJsonOk(String("Deco brightness set to ") + brightnessModeToStr(g_brightnessDecoMode));
}

// ============================================================
// Wi-Fi event handlers
// ============================================================

void onWifiConnected(const WiFiEventStationModeConnected& event) {
    LOG("\nWi-Fi connected!\n\n");
}

void onWifiGotIP(const WiFiEventStationModeGotIP& event) {
    LOG("\nIP      : %s\n", WiFi.localIP().toString().c_str());
    LOG("Gateway : %s\n",   WiFi.gatewayIP().toString().c_str());
    LOG("RSSI    : %d dBm\n\n", WiFi.RSSI());
}

// ============================================================
// Initialization — default colors
// ============================================================

void initDefaultColors() {
    // Day digits (month | day) — green for value digits, white for leading zeros
    g_dayColor[0] = makeRGB(0,   255, 0);
    g_dayColor[1] = makeRGB(0,   255, 0);
    g_dayColor[2] = makeRGB(255, 255, 255);
    g_dayColor[3] = makeRGB(255, 255, 255);

    // Clock digits (hour | minute) — blue for value digits, white for leading zeros
    g_clockColor[0] = makeRGB(0,   0,   255);
    g_clockColor[1] = makeRGB(0,   0,   255);
    g_clockColor[2] = makeRGB(255, 255, 255);
    g_clockColor[3] = makeRGB(255, 255, 255);

    // Temperature digits — red for value digits, white for symbols
    g_tempColor[0] = makeRGB(255, 0,   0);
    g_tempColor[1] = makeRGB(255, 0,   0);
    g_tempColor[2] = makeRGB(255, 255, 255);
    g_tempColor[3] = makeRGB(255, 255, 255);

    // Decoration LEDs — all white by default
    for (int i = 0; i < LED_DECO_COUNT; i++) {
        g_decoColor[i] = makeRGB(255, 255, 255);
    }
}

// ============================================================
// setup()
// ============================================================

void setup() {
    delay(3000);  // Allow time for the serial monitor to connect
    Serial.begin(115200);
    Serial.setDebugOutput(false);
    LOG("=== LED Clock booting ===\n");

    // Wi-Fi
    WiFi.mode(WIFI_STA);
    WiFi.hostname(WIFI_HOSTNAME);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    static WiFiEventHandler onConnectedHandler = WiFi.onStationModeConnected(onWifiConnected);
    static WiFiEventHandler onGotIPHandler     = WiFi.onStationModeGotIP(onWifiGotIP);

    LOG("Connecting to Wi-Fi");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print('.');
    }
    Serial.println();

    // Web server routes
    serverWeb.on("/",                       HTTP_GET, handleRoot);
    serverWeb.on("/getinfo",                getInfoApi);
    serverWeb.on("/gettime",                getTimeApi);
    serverWeb.on("/gettemperature",         getTemperatureApi);
    serverWeb.on("/gettemperatureurl",      getTemperatureUrlApi);
    serverWeb.on("/setHourColor",           setHourColorApi);
    serverWeb.on("/setDayColor",            setDayColorApi);
    serverWeb.on("/setcolortemp",           setTempColorApi);
    serverWeb.on("/setclockbrightnessstate", setClockBrightnessState);
    serverWeb.on("/setdecobrightnessstate",  setDecoBrightnessState);
    serverWeb.on("/setdecocolor",           setDecoColorApi);
    serverWeb.on("/setHourMinuteToShow",    setHourMinuteToShowApi);
    serverWeb.on("/showTemperature",        showTemperatureApi);
    serverWeb.enableCORS(true);
    serverWeb.begin();
    LOG("Web server started.\n");

    // NTP client
    timeClient.begin();

    // LED strips
    stripClock.begin();
    stripClock.show();
    stripClock.setBrightness(BRIGHT_DEFAULT);

    stripDeco.begin();
    stripDeco.show();
    stripDeco.setBrightness(BRIGHT_DEFAULT);

    // Initialize colors and cycle state
    initDefaultColors();
    g_displayTick = 0;

    LOG("=== Boot complete ===\n");
}

// ============================================================
// loop()
// ============================================================

void loop() {
    if (!WiFi.isConnected()) {
        LOG("Waiting for Wi-Fi...\n");
        delay(1000);
        return;
    }

    serverWeb.handleClient();
    g_displayTick++;

    // -- Display cycle ----------------------------------------
    if (g_displayTick == TICK_SHOW_TIME) {
        readTheTime();
        displayTheTime();
    }
    if (g_displayTick == TICK_SHOW_DAY) {
        displayTheDay();
    }
    if (g_displayTick == TICK_SHOW_TEMP) {
        readTheTemperature();
        displayTheTemperature();
    }
    if (g_displayTick >= TICK_CYCLE_RESET) {
        g_displayTick = 0;
    }

    // -- Decoration LEDs -------------------------------------
    for (int i = 0; i < LED_DECO_COUNT; i++) {
        const RGB& c = g_decoColor[i];
        stripDeco.setPixelColor(i, stripDeco.Color(c.g, c.r, c.b));
    }

    // -- Brightness (includes night-mode schedule override) --
    applyBrightness();

    stripDeco.show();
    stripClock.show();

    delay(1000);
}
