#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <WiFiUdp.h>
#include <NTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>
#include <LittleFS.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <SPI.h>
#include <cstdint>
#include <StreamString.h>
#include <EEPROM.h>
#include <time.h>
#include <cmath>

// --------------------------------------------------------------------------------
// ---------------------------------- CONSTANTES ----------------------------------
// --------------------------------------------------------------------------------

#define TRACE(...) Serial.printf(__VA_ARGS__, "\n")

constexpr uint8_t OLED_SDA = 12;
constexpr uint8_t OLED_SCL = 14;

constexpr uint8_t BUZZER_PIN = D3; 
constexpr uint8_t BRIGHT_DEFAULT_VALUE = 50;

constexpr uint8_t OFF = 0;
constexpr uint8_t ON = 1;
constexpr uint8_t AUTO = 2;

constexpr uint8_t  LED_CLOCK_COUNT = 252;
constexpr uint8_t  LED_DECO_COUNT = 14;

constexpr uint8_t TIME_TO_DISPLAY_CLOCK = 1;
constexpr uint8_t TIME_TO_DISPLAY_DAY = 45;    
constexpr uint8_t TIME_TO_DISPLAY_TEMPERATURE = 50;
constexpr uint8_t TIME_TO_DISPLAY_HUMIDITY = 55;

constexpr uint8_t IDX_FIRST_DIGIT = 189;
constexpr uint8_t IDX_SECOND_DIGIT = 126;
constexpr uint8_t IDX_THIRD_DIGIT = 63;
constexpr uint8_t IDX_FOURTH_DIGIT = 0;

constexpr uint8_t NUM_READINGS_LRD = 12;

constexpr uint32_t AZUL = 0x0000ff;
constexpr uint32_t VERDE = 0x00ff00;
constexpr uint32_t VERMELHO = 0xff0000;
constexpr uint32_t AMARELO = 0xffff00;
constexpr uint32_t BRANCO = 0xffffff;

// Constantes do Efeito Respiração Noturno
constexpr uint16_t BREATH_INTERVAL_MS = 30; 
constexpr uint8_t  BREATH_MAX_BRIGHT = 15;  
constexpr uint8_t  BREATH_MIN_BRIGHT = 2;   

constexpr uint32_t CONFIG_MAGIC = 0xCAFEBABE;
/*
  config version
  1: Dados iniciais gerais de relogio, temperatura, humidade e data
  2: Adicionado alarm
  3: Adicionado aviso de chuva
*/
constexpr uint16_t CONFIG_VERSION = 3;




const char* ssid = "Biscoitao2.4G"; 
const char* passPhrase = "4luci184";
const String urlTemp = "http://api.hgbrasil.com/weather?woeid=455831&format=json-cors&array_limit=2&fields=only_results,temp,humidity,city_name,condition_slug&key=3b983af0";

// --------------------------------------------------------------------------------
// --------------------------------- ESTRUTURAS -----------------------------------
// --------------------------------------------------------------------------------

struct Time {
    int hour;
    int minute;
};

struct NightMode {
    int enabled;  // 0 = Inativo, 1 = Ativo
    Time start;
    Time end;
};

struct Date {
    int day;
    int month;
    int year;
};

struct BrightnessMode {
    int clockMode;
    int decoMode; 
};

struct AlarmConfig {
    int enabled; // 0 = Inativo, 1 = Ativo
    Time time;
};

struct RuntimeData {
    Time time;
    Date date;
    int temperature;
    int humidity;
    int umbrellaAlarm;
    int brightValue;
    int brightnessSensorMap[NUM_READINGS_LRD];
};

struct Config {
    uint32_t magic;
    uint16_t version;
    uint32_t clockColor[4];
    uint32_t dayColor[4];
    uint32_t tempColor[4];
    uint32_t humidityColor[4];
    uint32_t decoColor[14];
    BrightnessMode brightnessMode;
    NightMode nightMode;
    AlarmConfig alarm;
};



// --------------------------------------------------------------------------------
// ------------------------------ VARIÁVEIS GLOBAIS -------------------------------
// --------------------------------------------------------------------------------

Config dadosLedClock;
RuntimeData dadosLedClockRuntimeData;

Adafruit_NeoPixel stripClock(LED_CLOCK_COUNT, D7, NEO_RGB + NEO_KHZ800);
Adafruit_NeoPixel stripDeco(LED_DECO_COUNT, D8, NEO_RGB + NEO_KHZ800);
Adafruit_SSD1306 display(128, 64, &Wire, -1);

int currentReadIndexLdr = 0;
int timeToChangeMode = 0;
uint32_t lastSecondMs = 0;
uint32_t lastBreathMs = 0;

// Controle do Alerta de Guarda-Chuva
uint32_t lastUmbrellaMs = 0;

// Variáveis de controlo do Alarme em tempo de execução
bool isAlarmRinging = false;
uint32_t alarmStartTimeMs = 0;
uint32_t lastAlarmBlinkMs = 0;
bool alarmBlinkState = false;
bool alarmTriggeredThisMinute = false;

ESP8266WebServer serverWeb(80);
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "br.pool.ntp.org", -3 * 3600, 60000);
String localIp = "000.000.000.00";

bool inicializando = true;

// --------------------------------------------------------------------------------
// --------------------------- DECLARAÇÃO DE FUNÇÕES ------------------------------
// --------------------------------------------------------------------------------

void loadConfigurationDefault();
void getInfoApi();
void setHourColorApi();
void setDayColorApi();
void setTempColorApi();
void setDecoColorApi();
void setDecoColorAllApi();
void setHumidityColorApi();
void setClockBrightnessStateApi();
void setDecoBrightnessStateApi();
void setNightTimeApi();
void setAlarmApi();
void readTheTime();
void readTheTemperature();
void readThebrightnessValue();
void displayTheTime();
void displayTheDay();
void displayTheTemperature();
void displayTheHumidity();
String getConfigClock();
uint32_t hexStringToColor(const char* hexStr);
bool nightModeEnable();
void getDigits(int value, int &tens, int &units);
void displayCharacterMask(int offset, uint32_t colour, uint8_t mask);
void displayNumber(int digitToDisplay, int offsetBy, uint32_t colourToUse);
void checkAlarmTrigger();
void handleAlarmRinging();

void onConnected(const WiFiEventStationModeConnected& event) { TRACE("Wifi: Connected!"); }
void onGotIP(const WiFiEventStationModeGotIP& event) {
    localIp = WiFi.localIP().toString();
    TRACE("IP : %s | Gateway: %s | RSSI : %d\n", localIp.c_str(), WiFi.gatewayIP().toString().c_str(), WiFi.RSSI());
}

// --------------------------------------------------------------------------------
// ------------------------------ FUNÇÕES UTILITÁRIAS -----------------------------
// --------------------------------------------------------------------------------

void saveConfig() {
    EEPROM.put(0, dadosLedClock);
    EEPROM.commit();
    Serial.println("Configuração salva.");
}

bool loadConfig() {
    EEPROM.get(0, dadosLedClock);
    return (dadosLedClock.magic == CONFIG_MAGIC && dadosLedClock.version == CONFIG_VERSION);
}

void setBrightnessModeDefault(){
    dadosLedClock.brightnessMode.clockMode = ON;
    dadosLedClock.brightnessMode.decoMode = ON;
}

void loadConfigurationDefault() {
    memset(&dadosLedClock, 0, sizeof(Config));
    
    readTheTime();
    readTheTemperature();
    readThebrightnessValue();

    dadosLedClock.magic = CONFIG_MAGIC;
    dadosLedClock.version = CONFIG_VERSION;

    for (int i = 0; i < 2; i++) {
        dadosLedClock.clockColor[i] = AZUL;
        dadosLedClock.clockColor[i+2] = BRANCO;
    }

        for (int i = 0; i < 2; i++) {
        dadosLedClock.dayColor[i] = VERDE;
        dadosLedClock.dayColor[i+2] = BRANCO;
    }

        for (int i = 0; i < 2; i++) {
        dadosLedClock.tempColor[i] = VERMELHO;
        dadosLedClock.tempColor[i+2] = BRANCO;
    }

        for (int i = 0; i < 2; i++) {
        dadosLedClock.humidityColor[i] = AMARELO;
        dadosLedClock.humidityColor[i+2] = BRANCO;
    }

    for (int i = 0; i < 14; i++) {
        dadosLedClock.decoColor[i] = BRANCO;
    }  

    setBrightnessModeDefault();

    dadosLedClock.nightMode.enabled = ON;
    dadosLedClock.nightMode.start = {0, 0};
    dadosLedClock.nightMode.end = {5, 30}; 

    dadosLedClock.alarm.enabled = OFF;
    dadosLedClock.alarm.time = {6, 0};

    saveConfig();
}

uint32_t hexStringToColor(const char* hexStr) {
    if (hexStr[0] == '#') hexStr++;
    return strtoul(hexStr, NULL, 16);
}

bool nightModeEnable() {
    if (dadosLedClock.nightMode.enabled == 0) return false;

    int hourInt = dadosLedClockRuntimeData.time.hour * 100 + dadosLedClockRuntimeData.time.minute;
    
    int startHourToShow = dadosLedClock.nightMode.start.hour * 100 + dadosLedClock.nightMode.start.minute;
    int endHourToShow = dadosLedClock.nightMode.end.hour * 100 + dadosLedClock.nightMode.end.minute;

    return hourInt >= startHourToShow && hourInt <= endHourToShow;
}

Time convertToHHMM(String timeStr) {
    Time result{0, 0};
    int separator = timeStr.indexOf(':');
    if (separator < 0) return result;

    result.hour = timeStr.substring(0, separator).toInt();
    result.minute = timeStr.substring(separator + 1).toInt();
    return result;
}

// --------------------------------------------------------------------------------
// ----------------------------------- API WEB ------------------------------------
// --------------------------------------------------------------------------------
void setClockBrightnessStateApi() {
    String state = serverWeb.arg(0);
    state.toUpperCase();
    
    if (state == "OFF") dadosLedClock.brightnessMode.clockMode = OFF;
    else if (state == "ON") dadosLedClock.brightnessMode.clockMode = ON;
    else dadosLedClock.brightnessMode.clockMode = AUTO;
    
    String response = "{\"Status\": \"OK\"}";
    serverWeb.send(200, "application/json", response);
    saveConfig();
}

void setAlarmApi() {
    if (!serverWeb.hasArg("enable") || !serverWeb.hasArg("time")) {
        serverWeb.send(400, "application/json", "{\"error\": \"Parâmetros enable e time são obrigatórios\"}");
        return;
    }

    String startTime = serverWeb.arg("time");

    dadosLedClock.alarm.enabled = serverWeb.arg("enable").toInt();
    dadosLedClock.alarm.time = convertToHHMM(startTime);

    char response[120];
    snprintf(response, sizeof(response), "{\"Status\": \"Alarme alterado. Ativo: %d, Hora: %s\"}", dadosLedClock.alarm.enabled, startTime);
    
    serverWeb.send(200, "application/json", response);
    saveConfig();
}

void setNightTimeApi() {
    if (!serverWeb.hasArg("enable") || !serverWeb.hasArg("start") || !serverWeb.hasArg("end")) {
        serverWeb.send(400, "text/plain", "Parametros e, start e end são obrigatórios");
        return;
    }
    
    int enable = serverWeb.arg("enable").toInt();
    String startTime = serverWeb.arg("start");
    String endTime = serverWeb.arg("end");

    dadosLedClock.nightMode.enabled = enable == ON ? ON : OFF;
    dadosLedClock.nightMode.start = convertToHHMM(startTime);
    dadosLedClock.nightMode.end = convertToHHMM(endTime);

    char response[120];
    snprintf(response, sizeof(response), "{\"Status\": \"Night mode alterado. Ativo: %d, Inicio: %s Hora: %s\"}", enable, startTime, endTime);
    
    serverWeb.send(200, "application/json", response);
    saveConfig();
}

void setHourColorApi() {
    int i = serverWeb.arg(0).toInt();
    const char *color = serverWeb.arg(1).c_str();
    dadosLedClock.clockColor[i-1] = hexStringToColor(color);
    
    String response = "{\"Status\" : \"Hour color changed to " + String(color) + " on pos " + String(i) + "\"}";
    serverWeb.send(200, "application/json", response);
    saveConfig();
}

void setDayColorApi() {
    int i = serverWeb.arg(0).toInt();
    const char *color = serverWeb.arg(1).c_str();
    dadosLedClock.dayColor[i-1] = hexStringToColor(color);

    String response = "{\"Status\" : \"Day color changed to " + String(color) + " on pos " + String(i) + "\"}";
    serverWeb.send(200, "application/json", response);
    saveConfig();
}

void setTempColorApi() {
    int i = serverWeb.arg(0).toInt();
    const char *color = serverWeb.arg(1).c_str();
    dadosLedClock.tempColor[i-1] = hexStringToColor(color);

    String response = "{\"Status\" : \"Temperature color changed to " + String(color) + "\"}";
    serverWeb.send(200, "application/json", response);
    saveConfig();  
}

void setHumidityColorApi() {
    int i = serverWeb.arg(0).toInt();
    const char *color = serverWeb.arg(1).c_str();
    dadosLedClock.humidityColor[i-1] = hexStringToColor(color);

    String response = "{\"Status\" : \"Humidity color changed to " + String(color) + "\"}";
    serverWeb.send(200, "application/json", response);
    saveConfig();  
}

void setDecoColorApi() {
    int i = serverWeb.arg(0).toInt();
    const char *color = serverWeb.arg(1).c_str();
    dadosLedClock.decoColor[i - 1] = hexStringToColor(color);

    String response = "{\"Status\" : \"Decoration color " + String(i) + " changed to " + String(color) + "\"}";
    serverWeb.send(200, "application/json", response);
    saveConfig();
}

void setDecoColorAllApi() {
    if (serverWeb.args() < 2) {
        serverWeb.send(400, "application/json", "{\"error\":\"Missing parameters\"}");
        return;
    }

    int line = serverWeb.arg(0).toInt();
    const char *color = serverWeb.arg(1).c_str();

    int idxStart = (line - 1) * 7;
    int idxEnd = idxStart + 7;

    for (int i = idxStart; i < idxEnd; i++) {
        dadosLedClock.decoColor[i] = hexStringToColor(color);
    }

    char response[120];
    snprintf(response, sizeof(response), "{\"status\":\"Decoration color line %d changed to %s\"}", line, color);
    serverWeb.send(200, "application/json", response);
    saveConfig();
}

void getInfoApi() {
    serverWeb.send(200, "application/json", getConfigClock());
}

void getIndex() {
    if (LittleFS.exists("/index.html")) {
        File file = LittleFS.open("/index.html", "r");
        serverWeb.streamFile(file, "text/html");
        file.close();
    } else {
        serverWeb.send(404, "text/plain", "index nao encontrado");
    }
}

void getCss() {
    File file = LittleFS.open("/style.css", "r");
    serverWeb.streamFile(file, "text/css");
    file.close();
}

void getJs() {
    File file = LittleFS.open("/app.js", "r");
    serverWeb.streamFile(file, "application/javascript");
    file.close();
}

String getConfigClock() {
    DynamicJsonDocument doc(2048); 

    JsonObject objTime = doc.createNestedObject("time");
    objTime["hour"] = dadosLedClockRuntimeData.time.hour;
    objTime["minute"] = dadosLedClockRuntimeData.time.minute;

    JsonObject objDate = doc.createNestedObject("date");  
    objDate["day"] = dadosLedClockRuntimeData.date.day;
    objDate["month"] = dadosLedClockRuntimeData.date.month;
    objDate["year"] = dadosLedClockRuntimeData.date.year;

    doc["temperature"] = dadosLedClockRuntimeData.temperature;
    doc["humidity"] = dadosLedClockRuntimeData.humidity;
    doc["umbrellaAlert"] = dadosLedClockRuntimeData.umbrellaAlarm;

    auto fillHexColorArray = [](JsonArray arr, uint32_t *data, int size) {
        for (int i = 0; i < size; i++) arr.add(data[i]);
    };

    fillHexColorArray(doc.createNestedArray("hourColor"), dadosLedClock.clockColor, 4);
    fillHexColorArray(doc.createNestedArray("dayColor"), dadosLedClock.dayColor, 4);
    fillHexColorArray(doc.createNestedArray("tempColor"), dadosLedClock.tempColor, 4);
    fillHexColorArray(doc.createNestedArray("humidityColor"), dadosLedClock.humidityColor, 4);
    fillHexColorArray(doc.createNestedArray("decoColor"), dadosLedClock.decoColor, 14);

    JsonObject bm = doc.createNestedObject("brightnessMode");
    bm["clock"] = dadosLedClock.brightnessMode.clockMode;
    bm["deco"] = dadosLedClock.brightnessMode.decoMode;
    bm["brightValue"] = dadosLedClockRuntimeData.brightValue;

    JsonObject nm = doc.createNestedObject("nightMode");
    nm["enable"] = dadosLedClock.nightMode.enabled;

    JsonObject objStart = nm.createNestedObject("start");
    objStart["hour"] = dadosLedClock.nightMode.start.hour;
    objStart["minute"] = dadosLedClock.nightMode.start.minute;

    JsonObject objEnd = nm.createNestedObject("end");
    objEnd["hour"] = dadosLedClock.nightMode.end.hour;
    objEnd["minute"] = dadosLedClock.nightMode.end.minute;  

    JsonObject alm = doc.createNestedObject("alarm");
    alm["enable"] = dadosLedClock.alarm.enabled;
    alm["hour"] = dadosLedClock.alarm.time.hour;
    alm["minute"] = dadosLedClock.alarm.time.minute;

    String output;
    serializeJson(doc, output);
    return output;
}

void setDecoBrightnessStateApi() {
    String state = serverWeb.arg(0);
    state.toUpperCase();

    if (state == "OFF") dadosLedClock.brightnessMode.decoMode = OFF;
    else if (state == "ON") dadosLedClock.brightnessMode.decoMode = ON;
    else dadosLedClock.brightnessMode.decoMode = AUTO;

    String response = "{\"Status\" : \"OK\"}";
    serverWeb.send(200, "application/json", response);
    saveConfig();  
}

// --------------------------------------------------------------------------------
// --------------------------- LEITURA DE SENSORES/DATA ---------------------------
// --------------------------------------------------------------------------------

void readThebrightnessValue() {
    int valueReadFromSensor = analogRead(A0);
    dadosLedClockRuntimeData.brightnessSensorMap[currentReadIndexLdr] = valueReadFromSensor;
    currentReadIndexLdr = (currentReadIndexLdr + 1) % NUM_READINGS_LRD;

    int sumBrightness = 0;
    for (int i = 0; i < NUM_READINGS_LRD; i++) {
        sumBrightness += dadosLedClockRuntimeData.brightnessSensorMap[i];
    }

    int lightSensorValue = sumBrightness / NUM_READINGS_LRD;
    dadosLedClockRuntimeData.brightValue = map(lightSensorValue, 0, 1023, 200, 1);
}

void readTheTime() {
    time_t now = time(nullptr);
    struct tm *ptm = localtime(&now);

    dadosLedClockRuntimeData.time.hour = ptm->tm_hour;
    dadosLedClockRuntimeData.time.minute = ptm->tm_min;
    dadosLedClockRuntimeData.date.day = ptm->tm_mday; 
    dadosLedClockRuntimeData.date.month = ptm->tm_mon + 1; 
    dadosLedClockRuntimeData.date.year = ptm->tm_year + 1900;

    // Reseta a trava do alarme quando sair do minuto configurado
    if (dadosLedClockRuntimeData.time.minute != dadosLedClock.alarm.time.minute) {
        alarmTriggeredThisMinute = false;
    }
}

void readTheTemperature() {
    WiFiClient client;
    HTTPClient http;

    bool lerTemperatura = dadosLedClockRuntimeData.temperature == -1 || dadosLedClockRuntimeData.time.minute % 59 == 0;
    if (!lerTemperatura) return;

    dadosLedClockRuntimeData.temperature = 0;

    if (http.begin(client, urlTemp)) {
        int httpCode = http.GET();
        if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_MOVED_PERMANENTLY) {
            String payload = http.getString();
            
            DynamicJsonDocument doc(1024); 
            DeserializationError error = deserializeJson(doc, payload);

            if (!error) {
                dadosLedClockRuntimeData.temperature = doc["temp"] | 0;
                dadosLedClockRuntimeData.humidity = doc["humidity"] | 0;
                TRACE("Temperature value read: %03d\n", dadosLedClockRuntimeData.temperature);
                TRACE("Humididy value read: %03d\n", dadosLedClockRuntimeData.humidity);

                // Lógica de Alerta de Guarda-Chuva baseada no condition_slug da API
                if (doc.containsKey("condition_slug")) {
                    String cond = (const char*)doc["condition_slug"];
                    dadosLedClockRuntimeData.umbrellaAlarm = OFF;
                    if (cond == "rain" || cond == "storm") {
                        dadosLedClockRuntimeData.umbrellaAlarm = ON;
                    }
                }                
            }
        }
        http.end();
    }
}

// --------------------------------------------------------------------------------
// --------------------------- RENDERIZAÇÃO DOS DISPLAYS --------------------------
// --------------------------------------------------------------------------------

void displayInfo() {
    display.clearDisplay();
    display.setTextSize(2);
    display.setCursor(0, 0);
    display.println(" Led Clock");
    display.println(localIp);  
    display.display();
}

void displayTheDay() {
    int tensDay, unitsDay, tensMonth, unitsMonth;
    getDigits(dadosLedClockRuntimeData.date.day, tensDay, unitsDay);  
    getDigits(dadosLedClockRuntimeData.date.month, tensMonth, unitsMonth);  

    stripClock.clear();
    displayNumber(tensDay, IDX_FIRST_DIGIT, dadosLedClock.dayColor[0]);
    displayNumber(unitsDay, IDX_SECOND_DIGIT, dadosLedClock.dayColor[1]);  
    displayNumber(tensMonth, IDX_THIRD_DIGIT, dadosLedClock.dayColor[2]);  
    displayNumber(unitsMonth, IDX_FOURTH_DIGIT, dadosLedClock.dayColor[3]); 
}

void displayTheTime() {
    int tensHour, unitsHour, tensMinute, unitsMinute;
    getDigits(dadosLedClockRuntimeData.time.minute, tensMinute, unitsMinute);  
    getDigits(dadosLedClockRuntimeData.time.hour, tensHour, unitsHour);  

    stripClock.clear();
    displayNumber(tensHour, IDX_FIRST_DIGIT, dadosLedClock.clockColor[0]);
    displayNumber(unitsHour, IDX_SECOND_DIGIT, dadosLedClock.clockColor[1]);  
    displayNumber(tensMinute, IDX_THIRD_DIGIT, dadosLedClock.clockColor[2]);  
    displayNumber(unitsMinute, IDX_FOURTH_DIGIT, dadosLedClock.clockColor[3]); 
}

void displayTheHumidity() {
    int tens, units;
    getDigits(dadosLedClockRuntimeData.humidity, tens, units);
    stripClock.clear();

    displayCharacterMask(IDX_FIRST_DIGIT, dadosLedClock.humidityColor[0], 0x5D); 
    displayCharacterMask(IDX_SECOND_DIGIT, dadosLedClock.humidityColor[1], 0x5D); 
    displayNumber(tens, IDX_THIRD_DIGIT, dadosLedClock.humidityColor[2]);  
    displayNumber(units, IDX_FOURTH_DIGIT, dadosLedClock.humidityColor[3]);
}

void displayTheTemperature() {
    int tens, units;
    getDigits(dadosLedClockRuntimeData.temperature, tens, units);  
    stripClock.clear();

    displayNumber(tens, IDX_FIRST_DIGIT, dadosLedClock.tempColor[0]);
    displayNumber(units, IDX_SECOND_DIGIT, dadosLedClock.tempColor[1]);
    displayCharacterMask(IDX_THIRD_DIGIT, dadosLedClock.tempColor[2], 0x0F);  
    displayCharacterMask(IDX_FOURTH_DIGIT, dadosLedClock.tempColor[3], 0x66); 
}

void getDigits(int value, int &tens, int &units) {
    value = constrain(value, 0, 99);
    tens = value / 10;
    units = value % 10;
}

void displayCharacterMask(int offset, uint32_t colour, uint8_t mask) {
    for (int seg = 0; seg < 7; seg++) {
        if (mask & (1 << seg)) {
            stripClock.fill(colour, offset + (seg * 9), 9);
        }
    }
}

void displayNumber(int digitToDisplay, int offsetBy, uint32_t colourToUse) {
    const uint8_t DIGIT_MASKS[10] = {
        0x77, 0x11, 0x6B, 0x3B, 0x1D, 0x3E, 0x7E, 0x13, 0x7F, 0x1F  
    };

    if (digitToDisplay >= 0 && digitToDisplay <= 9) {
        displayCharacterMask(offsetBy, colourToUse, DIGIT_MASKS[digitToDisplay]);
    }
}

// --------------------------------------------------------------------------------
// --------------------------- CONTROLO DO ALARME ---------------------------------
// --------------------------------------------------------------------------------

void checkAlarmTrigger() {
    if (dadosLedClock.alarm.enabled == 1 && !alarmTriggeredThisMinute && !isAlarmRinging) {
        if (dadosLedClockRuntimeData.time.hour == dadosLedClock.alarm.time.hour &&
            dadosLedClockRuntimeData.time.minute == dadosLedClock.alarm.time.minute) {
            
            isAlarmRinging = true;
            alarmTriggeredThisMinute = true;
            alarmStartTimeMs = millis();
            lastAlarmBlinkMs = 0;
            alarmBlinkState = false;
            Serial.println("ALARME DISPARADO!");
        }
    }
}

void handleAlarmRinging() {
    uint32_t now = millis();

    // Desliga após 10 segundos
    if (now - alarmStartTimeMs >= 10000) {
        isAlarmRinging = false;
        noTone(BUZZER_PIN);
        Serial.println("Alarme finalizado.");
        return;
    }

    // Pisca os dígitos e toca o som a cada 300ms para um efeito mais dinâmico
    if (now - lastAlarmBlinkMs >= 300) {
        lastAlarmBlinkMs = now;
        alarmBlinkState = !alarmBlinkState;

        if (alarmBlinkState) {
            readTheTime();
            displayTheTime(); // Mostra a hora atualizada
            stripClock.setBrightness(100); // Força brilho alto para alertar
            stripClock.show();
            tone(BUZZER_PIN, 1800); // Toca o som (1800Hz)
        } else {
            stripClock.clear(); // Apaga os dígitos
            stripClock.show();
            noTone(BUZZER_PIN); // Pausa o som entre os bips
        }
    }
}

// --------------------------------------------------------------------------------
// ------------------------------------ SETUP -------------------------------------
// --------------------------------------------------------------------------------

void setup() {
    Serial.begin(9600);
    Wire.begin(OLED_SDA, OLED_SCL);
    Serial.setDebugOutput(false);
    delay(3000);
     
    TRACE("\nHELLO !\n");
    
    // Configuração do pino do Buzzer
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);

    EEPROM.begin(sizeof(Config));

    if (!loadConfig()) {
        Serial.println("Primeira execução ou versão inválida.");
        loadConfigurationDefault();
    }
    Serial.println("Configuração carregada.");  

    if (!display.begin(SSD1306_SWITCHCAPVCC,  0x3C)) {
        Serial.println(F("SSD1306 allocation failed"));
    }

    display.display();
    delay(2000);
    display.setTextColor(SSD1306_WHITE);  
    
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, passPhrase);
    WiFi.hostname("WIFI-Clock");

    static WiFiEventHandler onConnectedHandler = WiFi.onStationModeConnected(onConnected);
    static WiFiEventHandler onGotIPHandler = WiFi.onStationModeGotIP(onGotIP);

    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        TRACE(".");
    }
     
    configTime(-3 * 3600, 0, "br.pool.ntp.org");
    LittleFS.begin();
    timeClient.begin();

    serverWeb.on("/", HTTP_GET, getIndex);
    serverWeb.on("/style.css", HTTP_GET, getCss);
    serverWeb.on("/app.js", HTTP_GET, getJs);
    serverWeb.on("/getInfo", getInfoApi);
    serverWeb.on("/setHourColor", setHourColorApi);
    serverWeb.on("/setDayColor", setDayColorApi);
    serverWeb.on("/setTempColor", setTempColorApi);
    serverWeb.on("/setHumidityColor", setHumidityColorApi);    
    serverWeb.on("/setDecoColor", setDecoColorApi);
    serverWeb.on("/setDecoColorAll", setDecoColorAllApi);
    serverWeb.on("/setClockBrightnessState", setClockBrightnessStateApi);
    serverWeb.on("/setDecoBrightnessState", setDecoBrightnessStateApi);
    serverWeb.on("/setNightTime", setNightTimeApi);
    serverWeb.on("/setAlarm", setAlarmApi); // Nova rota registrada para configurar o alarme
          
    serverWeb.enableCORS(true);
    serverWeb.begin();
      
    stripClock.begin();
    //stripClock.setBrightness(BRIGHT_DEFAULT_VALUE);    
    //stripClock.fill(BRANCO);
    //stripClock.show();

      
    stripDeco.begin();
    //stripDeco.setBrightness(BRIGHT_DEFAULT_VALUE);    
    //stripDeco.fill(BRANCO);
    //stripDeco.show();
      
    timeToChangeMode = 0;

    inicializando = true;
}

// --------------------------------------------------------------------------------
// ------------------------------------- LOOP -------------------------------------
// --------------------------------------------------------------------------------

void loop() {
    if (!WiFi.isConnected()) {
        TRACE("waiting for wifi ...\n");
        delay(1000);
        return;
    }

    serverWeb.handleClient();
    uint32_t now = millis();

    if(inicializando){
        stripClock.setBrightness(BRIGHT_DEFAULT_VALUE);
        stripDeco.setBrightness(BRIGHT_DEFAULT_VALUE);

        for (size_t i = 0; i < LED_CLOCK_COUNT; i++)
        {
            stripClock.clear();            
            stripClock.setPixelColor(i, BRANCO);
            stripClock.show();
            delay(10);
        }

        for (size_t i = 0; i < LED_DECO_COUNT; i++)
        {
            stripDeco.clear();            
            stripDeco.setPixelColor(i, BRANCO);
            stripDeco.show();
            delay(10);
        }        

        inicializando = false;
    }

    // Prioridade Máxima 1: Executa a animação e o som do alarme se estiver ativo
    if (isAlarmRinging) {
        handleAlarmRinging();
        return; // Bloqueia o restante das animações durante o alarme
    }

    // Verificação contínua se o alarme deve disparar
    checkAlarmTrigger();    

    // ============================================================================
    // ANIMAÇÃO FLUIDA DE ALERTA DE CHUVA (Roda a cada 30ms se ativo fora da noite)
    // ============================================================================
    if (dadosLedClockRuntimeData.umbrellaAlarm == ON && !nightModeEnable()) {
        if (now - lastUmbrellaMs >= 30) {
            lastUmbrellaMs = now;

            // Gera uma curva seno suave para controlar o brilho
            float angle = now / 600.0; // Velocidade da pulsação
            float pulseRatio = (sin(angle) + 1.0) / 2.0;

            // Brilho varia suavemente entre 10 e 70
            uint8_t bright = 10 + (pulseRatio * 60); 

            stripDeco.setBrightness(bright);
            for (int i = 0; i < LED_DECO_COUNT; i++) {
                stripDeco.setPixelColor(i, AZUL); // Força cor Azul nos leds de decoração
            }

            stripDeco.show();
        }
    }    

    // Animação de respiração noturna
    if (nightModeEnable()) {
        stripClock.setBrightness(0);
        stripClock.show();

        if (now - lastBreathMs >= BREATH_INTERVAL_MS) {
            lastBreathMs = now;
            float angle = now / 1500.0; 
            float pulseRatio = (sin(angle) + 1.0) / 2.0; 
            uint8_t currentBright = BREATH_MIN_BRIGHT + (pulseRatio * (BREATH_MAX_BRIGHT - BREATH_MIN_BRIGHT));

            stripDeco.setBrightness(currentBright);
            for (int i = 0; i < LED_DECO_COUNT; i++) {
                stripDeco.setPixelColor(i, dadosLedClock.decoColor[i]);
            }
            stripDeco.show();
        }
    }

    // Execução regular do Relógio (1 em 1 segundo)
    if (now - lastSecondMs >= 1000) {
        lastSecondMs = now;
        timeToChangeMode++;

        if (!nightModeEnable()) {
            switch (timeToChangeMode) {
                case TIME_TO_DISPLAY_CLOCK:
                    readTheTime();
                    displayTheTime();    
                    break;
                case TIME_TO_DISPLAY_DAY:
                    displayTheDay();
                    break;
                case TIME_TO_DISPLAY_TEMPERATURE:
                    readTheTemperature();
                    displayTheTemperature();    
                    break;
                case TIME_TO_DISPLAY_HUMIDITY:
                    displayTheHumidity();
                    break;                  
            }

            readThebrightnessValue();

            switch (dadosLedClock.brightnessMode.decoMode) {
                case OFF:  stripDeco.setBrightness(0); break;
                case ON:   stripDeco.setBrightness(BRIGHT_DEFAULT_VALUE); break;
                case AUTO:  stripDeco.setBrightness(dadosLedClockRuntimeData.brightValue); break;
            }
            
            switch (dadosLedClock.brightnessMode.clockMode) {
                case OFF:  stripClock.setBrightness(0); break;
                case ON:   stripClock.setBrightness(BRIGHT_DEFAULT_VALUE); break;
                case AUTO: stripClock.setBrightness(dadosLedClockRuntimeData.brightValue); break;
            }

            for (int i = 0; i < LED_DECO_COUNT; i++) {
                stripDeco.setPixelColor(i, dadosLedClock.decoColor[i]);
            }

            stripClock.show();
            stripDeco.show();
        } else {
            // Garante que a hora continua a ser atualizada internamente mesmo no modo noturno
            readTheTime(); 
        }

        if (timeToChangeMode >= 60) {
            timeToChangeMode = 0;
        }

        displayInfo();
    }
}