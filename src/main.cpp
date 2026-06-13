#include <WiFiUdp.h>
#include <NTPClient.h>
#include <Arduino_JSON.h>
#include <ArduinoJson.h>
#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <Adafruit_NeoPixel.h>
#include <LittleFS.h>
#include <ESP8266HTTPClient.h>
#include <time.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <SPI.h>
#include <cstdint>
#include <StreamString.h>
#include <EEPROM.h>

// --------------------------------------------------------------------------------
// ------------------------------------ DEFINE ------------------------------------
// --------------------------------------------------------------------------------

#define TRACE(...) Serial.printf(__VA_ARGS__, "\n") // TRACE output simplified, can be deactivated here

#define OLED_SDA 12
#define OLED_SCL 14
#define SCREEN_WIDTH 128 // OLED display width, in pixels
#define SCREEN_HEIGHT 64 // OLED display height, in pixels

#define OLED_RESET     -1 // Reset pin # (or -1 if sharing Arduino reset pin)
#define SCREEN_ADDRESS 0x3C ///< See datasheet for Address; 0x3D for 128x64, 0x3C for 128x32

#define BRIGHT_OFF 0 // choose off the brightness Clock Mode
#define BRIGHT_ON 1  // choose on the brightness Clock Mode
#define BRIGHT_AUTO 2  // choose auto the brightness Clock Mode
#define BRIGHT_DEFAULT_VALUE 50  // default vale for  brightness Clock Mode

#define NIGHT_MODE_OFF 0 // Night mode config off
#define NIGHT_MODE_ON 1 // Night mode config on

#define LEDCLOCK_COUNT 252 // Count for neopixel attached to the ESP8266 to clock
#define LEDDECO_COUNT 14  // Count for neopixel attached to the ESP8266 to decoration

#define TIME_TO_DISPLAY_CLOCK 1
#define TIME_TO_DISPLAY_DAY 45    
#define TIME_TO_DISPLAY_TEMPERATURE 50
#define TIME_TO_DISPLAY_HUMIDITY 55

#define IDX_FIRST_DIGIT 189
#define IDX_SECOND_DIGIT 126
#define IDX_THIRD_DIGIT 63
#define IDX_FOURTH_DIGIT 0

#define NUM_READINGS_LRD 12 // Smoothing of the readings from the light sensor so it is not too twitchy

#define AZUL 0x0000ff
#define VERDE 0x00ff00
#define VERMELHO 0xff0000
#define AMARELO 0xffff00
#define BRANCO 0xffffff

#define CONFIG_MAGIC   0xCAFEBABE
#define CONFIG_VERSION 1

// --------------------------------------------------------------------------------
// -----------------------------------  CONST  ------------------------------------
// --------------------------------------------------------------------------------

const char *ssid = "Biscoitao2.4G";
const char *passPhrase = "4luci184";
const String urlTemp = "http://api.hgbrasil.com/weather?woeid=455831&format=json-cors&array_limit=2&fields=only_results,temp,humidity,city_name&key=3b983af0";

// --------------------------------------------------------------------------------
// ------------------------------------ STRUCTS------------------------------------
// --------------------------------------------------------------------------------

struct Time {
    int hour;
    int minute;
};

struct NightMode{
    int enabled;
    Time start;
    Time end;
};

struct Date{
    int day;
    int month;
    int year;
};

struct BrightnessMode{
    int clockMode;
    int decoMode; 
    int brightValue; 
    int brightnessSensorMap[NUM_READINGS_LRD];
};

struct RuntimeData {
    Time time;
    Date date;
    int temperature;
    int humidity;
};

struct Config{
    
  uint32_t magic;
  uint16_t version;

  uint32_t  clockColor[4];
  uint32_t  dayColor[4];
  uint32_t  tempColor[4];
  uint32_t  humidityColor[4];
  uint32_t  decoColor[14];

  BrightnessMode brightnessMode;
  NightMode nightMode;
};

// --------------------------------------------------------------------------------
// -------------------------- FUNCTIONS DECLARATIONS ------------------------------
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

void readTheTime();
void readTheTemperature();
void readThebrightnessValue();

void displayTheTime();
Time parseTime(JsonObject obj);
void displayTheDay();
void displayTheTemperature();
void displayTheHumidity();

String getConfigClock();
String brightnessModeToStr(int mode);
uint32_t hexStringToColor(const char* hexStr);
bool nightModeEnable();

void getDigits(int value, int &tens, int &units);
void displayNumber(int digitToDisplay, int offsetBy, uint32_t colourToUse);
void digitZero(int offset, uint32_t colour);
void digitOne(int offset, uint32_t colour);
void digitTwo(int offset, uint32_t colour);
void digitThree(int offset, uint32_t colour);
void digitFour(int offset, uint32_t colour);
void digitFive(int offset, uint32_t colour);
void digitSix(int offset, uint32_t colour);
void digitSeven(int offset, uint32_t colour);
void digitEight(int offset, uint32_t colour);
void digitNine(int offset, uint32_t colour);
void letterC(int offset, uint32_t colour);
void letterH(int offset, uint32_t colour);
void symbolDegrees(int offset, uint32_t colour);

// --------------------------------------------------------------------------------
// -------------------------------- GLOBAL VARIABLES ------------------------------
// --------------------------------------------------------------------------------

Config  dadosLedClock;
RuntimeData dadosLedClockRuntimeData;

Adafruit_NeoPixel stripClock(LEDCLOCK_COUNT, D7, NEO_RGB + NEO_KHZ800);
Adafruit_NeoPixel stripDeco(LEDDECO_COUNT, D8, NEO_RGB + NEO_KHZ800);

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

int currentReadIndexLdr = 0; // the index of the current reading

int timeToChangeMode = 0;

uint32_t lastSecondMs  = 0;  // Temporização não-bloqueante -  última vez que 1 segundo passou

void onConnected(const WiFiEventStationModeConnected& event);
void onGotIP(const WiFiEventStationModeGotIP& event);

ESP8266WebServer serverWeb(80);

WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "br.pool.ntp.org", -3 * 3600, 60000); // time is refreshed every minute (60000ms)
String localIp=  "000.000.000.00";

int nightMode = NIGHT_MODE_ON;
int startHourToShow = 0 * 0 + 0; // hour * 100 + minute
int endHourToShow = 5 * 100 + 30;

// --------------------------------------------------------------------------------
// -------------------------------- UTILS FUNCTIONS  ------------------------------
// --------------------------------------------------------------------------------
void saveConfig()
{
    EEPROM.put(0, dadosLedClock);
    EEPROM.commit();
    Serial.println("Configuração salva.");
}

bool loadConfig()
{
    EEPROM.get(0, dadosLedClock);

    if (dadosLedClock.magic != CONFIG_MAGIC || dadosLedClock.version != CONFIG_VERSION)
    {
        return false;
    }

    return true;
}

Time parseTime(JsonObject obj) {
    Time t;
    t.hour = obj["hour"] | 0;
    t.minute = obj["minute"] | 0;
    return t;
}

void loadConfigurationDefault(){
  
  memset(&dadosLedClock, 0, sizeof(Config));
  
  readTheTime();
  readTheTemperature();
  readThebrightnessValue();

  dadosLedClock.magic = CONFIG_MAGIC;
  dadosLedClock.version = CONFIG_VERSION;

  dadosLedClock.clockColor[0] = AZUL;
  dadosLedClock.clockColor[1] = AZUL;
  dadosLedClock.clockColor[2] = BRANCO;
  dadosLedClock.clockColor[3] = BRANCO;

  dadosLedClock.dayColor[0] = VERDE;
  dadosLedClock.dayColor[1] = VERDE;
  dadosLedClock.dayColor[2] = BRANCO;
  dadosLedClock.dayColor[3] = BRANCO;
  
  dadosLedClock.tempColor[0] = VERMELHO;
  dadosLedClock.tempColor[1] = VERMELHO;
  dadosLedClock.tempColor[2] = BRANCO;
  dadosLedClock.tempColor[3] = BRANCO;
  
  dadosLedClock.humidityColor[0] = AMARELO;
  dadosLedClock.humidityColor[1] = AMARELO;
  dadosLedClock.humidityColor[2] = BRANCO;
  dadosLedClock.humidityColor[3] = BRANCO;

  for (int i = 0; i < 14; i++) {
    dadosLedClock.decoColor[i] = BRANCO;
  }  

  dadosLedClock.brightnessMode.clockMode = BRIGHT_ON;
  dadosLedClock.brightnessMode.decoMode = BRIGHT_ON;

  dadosLedClock.nightMode.enabled = NIGHT_MODE_ON;
  dadosLedClock.nightMode.start.hour = 0;
  dadosLedClock.nightMode.start.minute = 0;
  dadosLedClock.nightMode.end.hour = 5;
  dadosLedClock.nightMode.end.minute = 30; 

  saveConfig();
}

uint32_t hexStringToColor(const char* hexStr) {
  if (hexStr[0] == '#') hexStr++;
  return strtoul(hexStr, NULL, 16);
}

bool nightModeEnable(){
  if(dadosLedClock.nightMode.enabled == 0){
    return false;
  }

  int hourInt = dadosLedClockRuntimeData.time.hour * 100 + dadosLedClockRuntimeData.time.minute;

  return nightMode == NIGHT_MODE_ON && hourInt >= startHourToShow && hourInt <= endHourToShow;
}

void onConnected(const WiFiEventStationModeConnected& event){
  TRACE("Wifi: Connected!");
}

void onGotIP(const WiFiEventStationModeGotIP& event){

  localIp = WiFi.localIP().toString();
  
  TRACE("IP : %s | Gateway: %s | RSSI : %d\n", WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str(), WiFi.RSSI());
}

void setClockBrightnessStateApi(){

    String response;
    String contentType = "application/json";
    
    String state = String(serverWeb.arg(0));
    state.toUpperCase();
    
    if(state == "OFF"){
      dadosLedClock.brightnessMode.clockMode = BRIGHT_OFF;
    }
    else if(state == "ON"){
      dadosLedClock.brightnessMode.clockMode = BRIGHT_ON;
    }
    else{
      dadosLedClock.brightnessMode.clockMode = BRIGHT_AUTO;
    }
    
    response = String("{\"Status\": \"") + "State clock bright changed to " + brightnessModeToStr(dadosLedClock.brightnessMode.clockMode) + "\"}";
    
    serverWeb.send(200, contentType , response);
    TRACE("%s\n", response.c_str());
    saveConfig();
}

Time convertToHHMM(String timeStr) {
    Time result{0, 0};

    int separator = timeStr.indexOf(':');

    if (separator < 0)
        return result;

    result.hour = timeStr.substring(0, separator).toInt();
    result.minute = timeStr.substring(separator + 1).toInt();

    return result;
}

void setNightTimeApi(){
  String response;
  String contentType = "application/json";

  if (!serverWeb.hasArg("s") || !serverWeb.hasArg("e")) {
    serverWeb.send(400, "text/plain", "Parametros s e e são obrigatórios");
    return;
  }
  
  String startTime = serverWeb.arg("s"); // exemplo: "00:00"
  String endTime   = serverWeb.arg("e"); // exemplo: "05:30"

  nightMode = NIGHT_MODE_ON;

  dadosLedClock.nightMode.start = convertToHHMM(startTime);
  dadosLedClock.nightMode.end = convertToHHMM(endTime);

  startHourToShow = dadosLedClock.nightMode.start.hour * 100 + dadosLedClock.nightMode.start.minute;
  endHourToShow = dadosLedClock.nightMode.end.hour * 100 + dadosLedClock.nightMode.end.minute;

  response = String("{ \"Status\" : \"") + "NightTime change to between [" + startTime + "] and [" + endTime + "]\"}";

  serverWeb.send(200, contentType , response);

  TRACE("%s\n", response.c_str());

  saveConfig();
}

void setHourColorApi(){
  String response;
  String contentType = "application/json";

  int i = serverWeb.arg(0).toInt();
  const char *color = serverWeb.arg(1).c_str();

  dadosLedClock.clockColor[i-1] = hexStringToColor(color);
  response = String("{ \"Status\" : \"") + "Hour color changed to " + color + " on pos " + i + "\"}";

  serverWeb.send(200, contentType , response);

  TRACE("%s\n", response.c_str());

  saveConfig();
}

void setDayColorApi(){
  String response;
  String contentType = "application/json";

  int i = serverWeb.arg(0).toInt();
  const char *color = serverWeb.arg(1).c_str();

  dadosLedClock.dayColor[i-1] = hexStringToColor(color);

  response = String("{ \"Status\" : \"") + "Day color changed to " + color + " on pos " + i + "\"}";

  serverWeb.send(200, contentType , response);
  TRACE("%s\n", response.c_str());
  saveConfig();
}

void setTempColorApi(){
  String response;
  String contentType = "application/json";

  int i = serverWeb.arg(0).toInt();
  const char *color = serverWeb.arg(1).c_str();

  dadosLedClock.tempColor[i-1] = hexStringToColor(color);
  response = String("{\"Status\" : \"") + "Temperature color changed to " + color + "\"}";

  serverWeb.send(200, contentType , response);
  TRACE("%s\n", response.c_str());
  saveConfig();  
}

void setHumidityColorApi(){
  String response;
  String contentType = "application/json";

  int i = serverWeb.arg(0).toInt();
  const char *color = serverWeb.arg(1).c_str();

  dadosLedClock.humidityColor[i-1] = hexStringToColor(color);
  response = String("{\"Status\" : \"") + "Humidity color changed to " + color + "\"}";

  serverWeb.send(200, contentType , response);
  TRACE("%s\n", response.c_str());
  saveConfig();  
}

void setDecoColorApi(){
  String response;
  String contentType = "application/json";

  int i = serverWeb.arg(0).toInt();
  const char *color = serverWeb.arg(1).c_str();

  dadosLedClock.decoColor[i - 1] = hexStringToColor(color);
  response = String("{\"Status\" : \"") + "Decoration color " + (i) + " changed to " + color + "\"}";

  serverWeb.send(200, contentType , response);
  TRACE("%s\n", response.c_str());
  saveConfig();
}

void setDecoColorAllApi(){
  const char* contentType = "application/json";

   // Validação básica dos parâmetros
  if (serverWeb.args() < 2) {
    serverWeb.send(400, contentType, "{\"error\":\"Missing parameters\"}");
    return;
  }

  int line = serverWeb.arg(0).toInt();
  const char *color = serverWeb.arg(1).c_str();

  // Define faixa de LEDs
  int idxStart = (line - 1) * 7;
  int idxEnd   = idxStart + 7;

  // Atualiza LEDs
  for (int i = idxStart; i < idxEnd; i++) {
    dadosLedClock.decoColor[i] = hexStringToColor(color);
  }

  // Monta resposta sem usar muitas Strings
  char response[120];
  snprintf(response, sizeof(response),
           "{\"status\":\"Decoration color line %d changed to %s\"}",
           line,
           color);

  serverWeb.send(200, contentType, response);
  TRACE("%s\n", response);
  saveConfig();
}

void getInfoApi(){
  String contentType = "application/json";

  String response = getConfigClock();

  serverWeb.send(200, contentType , response);

  TRACE("%s\n", response.c_str());
}

void getIndex(){
       if (LittleFS.exists("/index.html")) {
           File file = LittleFS.open("/index.html", "r");
           serverWeb.streamFile(file, "text/html");
           file.close();
       } else {
           serverWeb.send(404, "text/plain", "index nao encontrado");
       }
}

void getCss(){
        File file = LittleFS.open("/style.css", "r");
        serverWeb.streamFile(file, "text/css");
        file.close();
}

void getJs(){
        File file = LittleFS.open("/app.js", "r");
        serverWeb.streamFile(file, "application/javascript");
        file.close();
}

String getConfigClock(){

  TRACE("getConfigClock start");
  DynamicJsonDocument doc(4096);

    TRACE("time");
  // ===== TIME =====
  JsonObject objTime = doc.createNestedObject("time");
  objTime["hour"] = dadosLedClockRuntimeData.time.hour;
  objTime["minute"] = dadosLedClockRuntimeData.time.minute;

    TRACE("date");  
  // ===== DATE =====  
  JsonObject objDate = doc.createNestedObject("date");  
  objDate["day"] = dadosLedClockRuntimeData.date.day;
  objDate["month"] = dadosLedClockRuntimeData.date.month;
  objDate["year"] = dadosLedClockRuntimeData.date.year;

    TRACE("temp");  
  // ===== TEMPERATURE =====    
  doc["temperature"] = dadosLedClockRuntimeData.temperature;

    TRACE("humd");  
  // ===== HUMIDITY =====      
  doc["humidity"] = dadosLedClockRuntimeData.humidity;

  // ===== ARRAYS RGB TO JSON =====
  auto fillHexColorArray = [](JsonArray arr, uint32_t *data, int size) {
    for (int i = 0; i < size; i++) {
      arr.add(data[i]);
    }
  };

  TRACE("hour color");  
  fillHexColorArray(doc.createNestedArray("hourColor"), dadosLedClock.clockColor, 4);
  TRACE("dayColor");    
  fillHexColorArray(doc.createNestedArray("dayColor"), dadosLedClock.dayColor, 4);
  TRACE("tempColor");    
  fillHexColorArray(doc.createNestedArray("tempColor"), dadosLedClock.tempColor, 4);
  TRACE("humidityColor");    
  fillHexColorArray(doc.createNestedArray("humidityColor"), dadosLedClock.humidityColor, 4);
  TRACE("decoColor");    
  fillHexColorArray(doc.createNestedArray("decoColor"), dadosLedClock.decoColor, 14);

  // ===== BRIGHTNESS MODE =====
  JsonObject bm = doc.createNestedObject("brightnessMode");
  bm["clock"] = dadosLedClock.brightnessMode.clockMode;
  bm["deco"] = dadosLedClock.brightnessMode.decoMode;
  bm["brightValue"] = dadosLedClock.brightnessMode.brightValue;

  // ===== NIGHT MODE =====
  JsonObject nm = doc.createNestedObject("nightMode");
  nm["enable"] = dadosLedClock.nightMode.enabled;

  JsonObject objStart = nm.createNestedObject("start");
  objStart["hour"] = dadosLedClock.nightMode.start.hour;
  objStart["minute"] = dadosLedClock.nightMode.start.minute;

  JsonObject objEnd = nm.createNestedObject("end");
  objEnd["hour"] = dadosLedClock.nightMode.end.hour;
  objEnd["minute"] = dadosLedClock.nightMode.end.minute;  

  String output;
  serializeJson(doc, output);

  TRACE("getConfigClock end");  

  return output;
}

void setDecoBrightnessStateApi(){
  String response;
  String contentType = "application/json";

  String state = String(serverWeb.arg(0));
  state.toUpperCase();

  if (state == "OFF"){
    dadosLedClock.brightnessMode.decoMode = BRIGHT_OFF;
  }
  else if(state == "ON"){
    dadosLedClock.brightnessMode.decoMode = BRIGHT_ON;
  }
  else{
    dadosLedClock.brightnessMode.decoMode = BRIGHT_AUTO;
  }

  response = String("{\"Status\" : \"") + "State decoration bright changed to " + brightnessModeToStr(dadosLedClock.brightnessMode.decoMode) + "\"}";

  serverWeb.send(200, contentType , response);
  TRACE("%s\n", response.c_str());
  saveConfig();  
}

void readThebrightnessValue(){
    //Record a reading from the light sensor and add it to the array
    int valueReadFromSensor = analogRead(A0);

    TRACE("Light sensor value = %03d\n", valueReadFromSensor);

    dadosLedClock.brightnessMode.brightnessSensorMap[currentReadIndexLdr] = valueReadFromSensor;
    currentReadIndexLdr = currentReadIndexLdr + 1;

    if (currentReadIndexLdr >= NUM_READINGS_LRD) {
      currentReadIndexLdr = 0;
    }

    //now work out the sum of all the values in the array
    int sumBrightness = 0;
    for (int i=0; i < NUM_READINGS_LRD; i++) {
          sumBrightness += dadosLedClock.brightnessMode.brightnessSensorMap[i];
    }

    // and calculate the average:
    int lightSensorValue = sumBrightness / NUM_READINGS_LRD;
    
    dadosLedClock.brightnessMode.brightValue = map(lightSensorValue, 0, 1023, 200, 1);

    TRACE("Mapped brightness value = %04d\n", dadosLedClock.brightnessMode.brightValue);
}

void readTheTime(){

  time_t now = time(nullptr);
  struct tm *ptm = localtime(&now);

  dadosLedClockRuntimeData.time.hour = ptm->tm_hour;
  dadosLedClockRuntimeData.time.minute = ptm->tm_min;
  //second = ptm->tm_sec;
  dadosLedClockRuntimeData.date.day = ptm->tm_mday; 
  dadosLedClockRuntimeData.date.month = ptm->tm_mon + 1; 
  dadosLedClockRuntimeData.date.year = ptm->tm_year + 1900;

  TRACE("Data: %02d/%02d/%04d  | Hora: %02d:%02d\n", dadosLedClockRuntimeData.date.day, dadosLedClockRuntimeData.date.month, dadosLedClockRuntimeData.date.year, dadosLedClockRuntimeData.time.hour, dadosLedClockRuntimeData.time.minute);
}

void readTheTemperature(){
    WiFiClient client;
    HTTPClient http;

    bool lerTemperatura = dadosLedClockRuntimeData.temperature == -1 || dadosLedClockRuntimeData.time.minute % 59 == 0;

    if(!lerTemperatura){
        return;
    }

    dadosLedClockRuntimeData.temperature = 0;

    if (http.begin(client, urlTemp)) {

      // start connection and send HTTP header
      int httpCode = http.GET();

      // httpCode will be negative on error
      if (httpCode > 0) {
        // file found at server
        if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_MOVED_PERMANENTLY) {
          String payload = http.getString();
          JSONVar myObject = JSON.parse(payload);

          // JSON.typeof(jsonVar) can be used to get the type of the var
          if (JSON.typeof(myObject) == "undefined") {
            return;
          }

          JSONVar keys = myObject.keys();
          dadosLedClockRuntimeData.temperature = (int)myObject["temp"];
          dadosLedClockRuntimeData.humidity = (int)myObject["humidity"];
          TRACE("Temperature value read: %03d\n", dadosLedClockRuntimeData.temperature);
          TRACE("Humididy value read: %03d\n", dadosLedClockRuntimeData.humidity);
        }
      } else {
        TRACE("Error reading temperature\n");
      }

      http.end();
    } else {
      TRACE("[HTTP} Unable to connect to read temperature\n");
    }
}

void displayInfo(){
    // Clear the buffer
  display.clearDisplay();

  display.setTextSize(2);
  display.setCursor(0,0) ;
  display.println(" Led Clock");
  display.println(localIp);  

  //char dateStr[17];
  //sprintf(dateStr, "Date: %02d/%02d/%04d", dadosLedClockRuntimeData.date.day, dadosLedClockRuntimeData.date.month, dadosLedClockRuntimeData.date.year);  //Date: 10/10/2026
  //display.println(dateStr);

  //char timeStr[15];
  //sprintf(timeStr, "Time: %02d:%02d", dadosLedClockRuntimeData.time.hour, dadosLedClockRuntimeData.time.minute); // Time: 23:45
  //display.println(timeStr);

  //char tempStr[11];
  //sprintf(tempStr, "Temp: %02d C", dadosLedClockRuntimeData.temperature);  // Temp: 34 C
  //display.println(tempStr);

  //char humidStr[15];
  //sprintf(humidStr, "Humidity: %02d %%", dadosLedClockRuntimeData.humidity);  // Humidity: 99 %
  //display.println(humidStr);

  //char sensorStr[19];
  //sprintf(sensorStr, "Bright Sensor: %02d", dadosLedClock.brightnessMode.brightValue);  // Bright Sensor: 255
  //display.println(sensorStr);  

  display.display();
 }

void displayTheDay(){
  int tensDay, unitsDay, tensMonth, unitsMonth;

  getDigits(dadosLedClockRuntimeData.date.day, tensDay, unitsDay);  
  getDigits(dadosLedClockRuntimeData.date.month, tensMonth, unitsMonth);  

  stripClock.clear(); //clear the clock face

  displayNumber(tensDay, IDX_FIRST_DIGIT, dadosLedClock.dayColor[0]);
  displayNumber(unitsDay, IDX_SECOND_DIGIT, dadosLedClock.dayColor[1]);  
  displayNumber(tensMonth, IDX_THIRD_DIGIT, dadosLedClock.dayColor[2]);  
  displayNumber(unitsMonth, IDX_FOURTH_DIGIT, dadosLedClock.dayColor[3]); 
}

void displayTheTime(){
  int tensHour, unitsHour, tensMinute, unitsMinute;

  getDigits(dadosLedClockRuntimeData.time.minute, tensMinute, unitsMinute);  
  getDigits(dadosLedClockRuntimeData.time.hour, tensHour, unitsHour);  

  stripClock.clear(); //clear the clock face
  
  displayNumber(tensHour, IDX_FIRST_DIGIT, dadosLedClock.clockColor[0]);
  displayNumber(unitsHour, IDX_SECOND_DIGIT, dadosLedClock.clockColor[1]);  
  displayNumber(tensMinute, IDX_THIRD_DIGIT, dadosLedClock.clockColor[2]);  
  displayNumber(unitsMinute, IDX_FOURTH_DIGIT, dadosLedClock.clockColor[3]); 
}

void displayTheHumidity(){

  int tens, units;

  getDigits(dadosLedClockRuntimeData.humidity, tens, units);
  stripClock.clear();

  letterH(IDX_FIRST_DIGIT, dadosLedClock.humidityColor[0]);
  letterH(IDX_SECOND_DIGIT, dadosLedClock.humidityColor[1]);
  displayNumber(tens, IDX_THIRD_DIGIT, dadosLedClock.humidityColor[2]);  
  displayNumber(units, IDX_FOURTH_DIGIT, dadosLedClock.humidityColor[3]);
}

void displayTheTemperature(){

  int tens, units;

  getDigits(dadosLedClockRuntimeData.temperature, tens, units);  
  stripClock.clear();

  displayNumber(tens, IDX_FIRST_DIGIT, dadosLedClock.tempColor[0]);
  displayNumber(units, IDX_SECOND_DIGIT, dadosLedClock.tempColor[1]);
  symbolDegrees(IDX_THIRD_DIGIT, dadosLedClock.tempColor[2]);  
  letterC(IDX_FOURTH_DIGIT, dadosLedClock.tempColor[3]);
}

void getDigits(int value, int &tens, int &units) {
  value = constrain(value, 0, 99);

  tens = value / 10;
  units = value % 10;
}

String brightnessModeToStr(int mode){
  switch(mode){
    case 0:
      return "0 - off";
    case 1:
      return "1 - on";
    case 2:
      return "2 - auto";
  }

  return "invalid";
}

void displayNumber(int digitToDisplay, int offsetBy, uint32_t colourToUse){
    switch (digitToDisplay){
    case 0:
    digitZero(offsetBy,colourToUse);
      break;
    case 1:
      digitOne(offsetBy,colourToUse);
      break;
    case 2:
    digitTwo(offsetBy,colourToUse);
      break;
    case 3:
    digitThree(offsetBy,colourToUse);
      break;
    case 4:
    digitFour(offsetBy,colourToUse);
      break;
    case 5:
    digitFive(offsetBy,colourToUse);
      break;
    case 6:
    digitSix(offsetBy,colourToUse);
      break;
    case 7:
    digitSeven(offsetBy,colourToUse);
      break;
    case 8:
    digitEight(offsetBy,colourToUse);
      break;
    case 9:
    digitNine(offsetBy,colourToUse);
      break;
    default:
     break;
  }
}

void digitZero(int offset, uint32_t colour){
  stripClock.fill(colour, (0 + offset), 27);
  stripClock.fill(colour, (36 + offset), 27);
}

void digitOne(int offset, uint32_t colour){
  stripClock.fill(colour, (0 + offset), 9);
  stripClock.fill(colour, (36 + offset), 9);
}

void digitTwo(int offset, uint32_t colour){
  stripClock.fill(colour, (0 + offset), 18);
  stripClock.fill(colour, (27 + offset), 9);
  stripClock.fill(colour, (45 + offset), 18);
}

void digitThree(int offset, uint32_t colour){
  stripClock.fill(colour, (0 + offset), 18);
  stripClock.fill(colour, (27 + offset), 27);
}

void digitFour(int offset, uint32_t colour){
  stripClock.fill(colour, (0 + offset), 9);
  stripClock.fill(colour, (18 + offset), 27);
}

void digitFive(int offset, uint32_t colour){
  stripClock.fill(colour, (9 + offset), 45);
}

void digitSix(int offset, uint32_t colour){
  stripClock.fill(colour, (9 + offset), 54);
}

void digitSeven(int offset, uint32_t colour){
  stripClock.fill(colour, (0 + offset), 18);
  stripClock.fill(colour, (36 + offset), 9);
}

void digitEight(int offset, uint32_t colour){
  stripClock.fill(colour, (0 + offset), 63);
}

void digitNine(int offset, uint32_t colour){
  stripClock.fill(colour, (0 + offset), 45);
}

void letterC(int offset, uint32_t colour){
  stripClock.fill(colour, (9 + offset), 18);
  stripClock.fill(colour, (45 + offset), 18);
}

void letterH(int offset, uint32_t colour){
  stripClock.fill(colour, (0 + offset), 9);
  stripClock.fill(colour, (18 + offset), 27);
  stripClock.fill(colour, (54 + offset), 9);
}

void symbolDegrees(int offset, uint32_t colour){
  stripClock.fill(colour, (0 + offset), 36);
}

// --------------------------------------------------------------------------------
// ----------------------------- SETUP FUNCION ------------------------------------
// --------------------------------------------------------------------------------

void setup() {

  Serial.begin(9600);
  // Inicializa I2C nos pinos personalizados
  Wire.begin(OLED_SDA, OLED_SCL);

  Serial.setDebugOutput(false);

  // wait for serial monitor to start completely.
  delay(3000);
   
  TRACE("\nHELLO !\n");

  EEPROM.begin(sizeof(Config));

  if(!loadConfig())
  {
        Serial.println("Primeira execução ou versão inválida.");
        loadConfigurationDefault();
  }

  Serial.println("Configuração carregada.");  

  // SSD1306_SWITCHCAPVCC = generate display voltage from 3.3V internally
  if(!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println(F("SSD1306 allocation failed"));
  }

  // Show initial display buffer contents on the screen the library initializes this with an Adafruit splash screen.
  display.display();
  delay(2000);
  
  display.setTextColor(SSD1306_WHITE);  
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, passPhrase);
  WiFi.hostname("WIFI-Clock");

  static WiFiEventHandler onConnectedHandler = WiFi.onStationModeConnected(onConnected);
  static WiFiEventHandler onGotIPHandler = WiFi.onStationModeGotIP(onGotIP);

  TRACE("\n");
  
  // Wait for connection
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
        
   // enable CORS header in webserver results
   serverWeb.enableCORS(true);
   serverWeb.begin();
    
   stripClock.begin();
   stripClock.fill(BRANCO);
   stripClock.show();
   stripClock.setBrightness(BRIGHT_DEFAULT_VALUE);
    
   stripDeco.begin();
   stripDeco.fill(BRANCO);
   stripDeco.show();
   stripDeco.setBrightness(BRIGHT_DEFAULT_VALUE);
    
   timeToChangeMode = 0;
}

// --------------------------------------------------------------------------------
// ------------------------------ LOOP FUNCION ------------------------------------
// --------------------------------------------------------------------------------
void loop() {

  if (!WiFi.isConnected()) {
    TRACE("waiting for wifi ...\n");
    delay(1000);
    return;
  }

  serverWeb.handleClient();

  uint32_t now = millis();

  if (now - lastSecondMs >= 1000) { // ── Lógica de 1 segundo
    lastSecondMs = now;

    timeToChangeMode++;

    switch (timeToChangeMode)
    {
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

    if (timeToChangeMode >= 60) {
      timeToChangeMode = 0;
    }

    // Brilho
    switch (dadosLedClock.brightnessMode.decoMode) {
      case BRIGHT_OFF:  stripDeco.setBrightness(0); break;
      case BRIGHT_ON:   stripDeco.setBrightness(BRIGHT_DEFAULT_VALUE); break;
      case BRIGHT_AUTO: readThebrightnessValue(); stripDeco.setBrightness(dadosLedClock.brightnessMode.brightValue); break;
    }
    switch (dadosLedClock.brightnessMode.clockMode) {
      case BRIGHT_OFF:  stripClock.setBrightness(0); break;
      case BRIGHT_ON:   stripClock.setBrightness(BRIGHT_DEFAULT_VALUE); break;
      case BRIGHT_AUTO: readThebrightnessValue(); stripClock.setBrightness(dadosLedClock.brightnessMode.brightValue); break;
    }

    // Deco LEDs
   for(int i=0; i<LEDDECO_COUNT; i++) {
       stripDeco.setPixelColor(i, dadosLedClock.decoColor[i]);
   }

    // Modo noturno — força apagado
    if (nightModeEnable()) {
      stripDeco.setBrightness(0);
      stripClock.setBrightness(0);
    }

    stripClock.show();
    stripDeco.show();

    displayInfo();
  }
}