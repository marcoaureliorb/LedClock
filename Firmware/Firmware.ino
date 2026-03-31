#include <WiFiUdp.h>
#include <NTPClient.h>
#include <Arduino_JSON.h>
#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <Adafruit_NeoPixel.h>
#include <LittleFS.h>
#include <ESP8266HTTPClient.h>

#include "Utils.h"
#include "secrets.h"  // add WLAN Credentials in here.

// TRACE output simplified, can be deactivated here
#define TRACE(...) Serial.printf(__VA_ARGS__)

// Time zone
const char * timeServer = "br.pool.ntp.org";
int timeZone = -3 * 3600;

// choose the brightness Clock Mode
#define BRIGHT_OFF 0
#define BRIGHT_ON 1
#define BRIGHT_AUTO 2
#define BRIGHT_DEFAULT_VALUE 50

int brightnessClockMode = BRIGHT_ON;
int brightnessSensor = BRIGHT_DEFAULT_VALUE;
int brightnessDecoMode = BRIGHT_ON;

// Settings led strip
// Which pin on the Arduino is connected to the NeoPixels?
#define LEDCLOCK_PIN 14 // pin D5 sur esp8266/arduino nano
#define LEDDECO_PIN  12 // pin D6 sur esp8266/arduino nano

// How many NeoPixels are attached to the Arduino?
#define LEDCLOCK_COUNT 252
#define LEDDECO_COUNT 14

// Declare our NeoPixel objects:
Adafruit_NeoPixel stripClock(LEDCLOCK_COUNT, LEDCLOCK_PIN, NEO_RGB + NEO_KHZ800);
Adafruit_NeoPixel stripDeco(LEDDECO_COUNT, LEDDECO_PIN, NEO_RGB + NEO_KHZ800);

//Smoothing of the readings from the light sensor so it is not too twitchy
const int numReadings = 12;

int readings[numReadings]; // the readings from the analog input
int readIndex = 0;         // the index of the current reading
long total = 0;            // the running total
long average = 0;          // the average

// RGB variables for clock mode
RGB dayColor[4];
RGB clockColor[4];
RGB tempColor[4];
RGB clockDecoColor[14];

int day = 0;
int month = 0;
int hour = 0;
int minute = 0;
int second = 0;

String urlTemp = "http://api.hgbrasil.com/weather?woeid=455831&format=json-cors&array_limit=2&fields=only_results,temp,city_name&key=3b983af0";
int temperature = -1;
int timeToChangeMode = 0;

// ── Rainbow config ──────────────────────────────────────────
#define RAINBOW_MODE_OFF 0
#define RAINBOW_MODE_ON 1

int rainbowMode = 0;
int rainbowOffset = 0;      // offset animado do arco-íris (0-255)

// ── Temporização não-bloqueante ─────────────────────────────
uint32_t lastSecondMs  = 0;   // última vez que 1 segundo passou
uint32_t lastRainbowMs = 0;   // última atualização do rainbow

// gestion des evenements du wifi
void onConnected(const WiFiEventStationModeConnected& event);
void onGotIP(const WiFiEventStationModeGotIP& event);

// webserver
ESP8266WebServer serverWeb(80);

WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, timeServer, timeZone, 60000); // time is refreshed every minute (60000ms)

int startHourToShow = 0 * 0 + 0; // hour * 100 + minute
int endHourToShow = 5 * 100 + 30;

void setup() {

   // wait for serial monitor to start completely.
   delay(3000);

   Serial.begin(115200);
   Serial.setDebugOutput(false);

   TRACE("HELLO !\n");

   WiFi.mode(WIFI_STA);
   WiFi.begin(ssid, passPhrase);
   WiFi.hostname("WIFI-Clock");

   static WiFiEventHandler onConnectedHandler = WiFi.onStationModeConnected(onConnected);
   static WiFiEventHandler onGotIPHandler = WiFi.onStationModeGotIP(onGotIP);

   // Wait for connection
   while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    TRACE(".");
   }

   LittleFS.begin();

   Dir dir = LittleFS.openDir("/");
   TRACE("List of file in directory data\n");
   while (dir.next()) {
      TRACE("File: %s | Size: %d\n", dir.fileName(), dir.fileSize());
   }

   serverWeb.on("/", HTTP_GET, []() {
       if (LittleFS.exists("/index.html")) {
           File file = LittleFS.open("/index.html", "r");
           TRACE("Tamanho do arquivo index.html %d. Tamanho Original: %d", file.size(), 16712);
           serverWeb.streamFile(file, "text/html");
           file.close();
       } else {
           serverWeb.send(404, "text/plain", "index nao encontrado");
       }
    });

    serverWeb.on("/style.css", HTTP_GET, []() {
        File file = LittleFS.open("/style.css", "r");
        serverWeb.streamFile(file, "text/css");
        file.close();
    });
    
    serverWeb.on("/app.js", HTTP_GET, []() {
        File file = LittleFS.open("/app.js", "r");
        serverWeb.streamFile(file, "application/javascript");
        file.close();
    });


    serverWeb.on("/getInfo", getInfoApi);
    serverWeb.on("/getTime", getTimeApi);
    serverWeb.on("/getTemperature", getTemperatureApi);
    
    serverWeb.on("/setHourColor", setHourColorApi);
    serverWeb.on("/setDayColor", setDayColorApi);
    serverWeb.on("/setTempColor", setTempColorApi);
    serverWeb.on("/setDecoColor", setDecoColorApi);
    serverWeb.on("/setDecoColorAll", setDecoColorAllApi);
    
    serverWeb.on("/setClockBrightnessState", setClockBrightnessStateApi);
    serverWeb.on("/setDecoBrightnessState", setDecoBrightnessStateApi);
    
    serverWeb.on("/setNightTime", setNightTimeApi);
    serverWeb.on("/setRainbowMode", setRainbowModeApi);
    
    // enable CORS header in webserver results
    serverWeb.enableCORS(true);
    
    serverWeb.begin();
    
    timeClient.begin();
    
    stripClock.begin();
    stripClock.show();
    stripClock.setBrightness(BRIGHT_DEFAULT_VALUE);
    
    stripDeco.begin();
    stripDeco.show();
    stripDeco.setBrightness(BRIGHT_DEFAULT_VALUE);
    
    //smoothing
    // initialize all the readings to 0:
    for (int thisReading = 0; thisReading < numReadings; thisReading++)
    {
      readings[thisReading] = 0;
    }
    
    for(int i=0; i<LEDDECO_COUNT; i++) {
        clockDecoColor[i] = (RGB){ 255 , 255 , 255 };
    }
    
    dayColor[0] = (RGB){ 0 , 255 , 0 };
    dayColor[1] = (RGB){ 0 , 255 , 0 };
    dayColor[2] = (RGB){ 255 , 255 , 255 };
    dayColor[3] = (RGB){ 255 , 255 , 255 };
    
    clockColor[0] = (RGB){ 0 , 0 , 255 };
    clockColor[1] = (RGB){ 0 , 0 , 255 };
    clockColor[2] = (RGB){ 255 , 255 , 255 };
    clockColor[3] = (RGB){ 255 , 255 , 255 };
    
    tempColor[0] = (RGB){ 255 , 0 , 0 };
    tempColor[1] = (RGB){ 255 , 0 , 0 };
    tempColor[2] = (RGB){ 255 , 255 , 255 };
    tempColor[3] = (RGB){ 255 , 255 , 255 };
    
    timeToChangeMode = 0;
}

void loop() {

  if (!WiFi.isConnected()) {
    TRACE("waiting for wifi ...\n");
    delay(1000);
    return;
  }

  serverWeb.handleClient();

  uint32_t now = millis();

  // ── Lógica de 1 segundo ─────────────────────────────────────
  if (now - lastSecondMs >= 1000) {
    lastSecondMs = now;

    timeToChangeMode++;

    if (timeToChangeMode == 1) {
      readTheTime();
      displayTheTime();
    }

    if (timeToChangeMode == 50) {
      displayTheDay();
    }

    if (timeToChangeMode == 55) {
      readTheTemperature();
      displayTheTemperature();
    }

    if (timeToChangeMode >= 60) {
      timeToChangeMode = 0;
    }

    // Brilho
    switch (brightnessDecoMode) {
      case BRIGHT_OFF:  stripDeco.setBrightness(0); break;
      case BRIGHT_ON:   stripDeco.setBrightness(BRIGHT_DEFAULT_VALUE); break;
      case BRIGHT_AUTO: readThebrightnessValue(); stripDeco.setBrightness(brightnessSensor); break;
    }
    switch (brightnessClockMode) {
      case BRIGHT_OFF:  stripClock.setBrightness(0); break;
      case BRIGHT_ON:   stripClock.setBrightness(BRIGHT_DEFAULT_VALUE); break;
      case BRIGHT_AUTO: readThebrightnessValue(); stripClock.setBrightness(brightnessSensor); break;
    }

    // Deco LEDs
   for(int i=0; i<LEDDECO_COUNT; i++) {
       stripDeco.setPixelColor(i, colorToInt(clockDecoColor[i]));
   }

    // Modo noturno — força apagado
    int hourInt = hour * 100 + minute;
    if (hourInt >= startHourToShow && hourInt <= endHourToShow) {
      stripDeco.setBrightness(0);
      stripClock.setBrightness(0);
    }

    stripDeco.show();

    // Se rainbow está desligado, mostra o clock aqui (1x/s, igual ao comportamento original)
    if (rainbowMode == RAINBOW_MODE_OFF) {
      stripClock.show();
    }
  }

  // ── Animação rainbow: atualiza ~50x por segundo ─────────────
  if (rainbowMode == RAINBOW_MODE_ON && (now - lastRainbowMs >= 20)) {
    lastRainbowMs = now;
    rainbowOffset += rainbowOffset;   // estoura de 255→0 naturalmente
    applyRainbow();
    stripClock.show();
  }
}

void readThebrightnessValue(){
    //Record a reading from the light sensor and add it to the array
    int valueReadFromSensor = analogRead(A0);

    TRACE("Light sensor value = %03d\n", valueReadFromSensor);

    readings[readIndex] = valueReadFromSensor;
    readIndex = readIndex + 1; // advance to the next position in the array:

    if (readIndex >= numReadings) {
      readIndex = 0;
    }

    //now work out the sum of all the values in the array
    int sumBrightness = 0;
    for (int i=0; i < numReadings; i++) {
          sumBrightness += readings[i];
    }

    // and calculate the average:
    int lightSensorValue = sumBrightness / numReadings;
    brightnessSensor = map(lightSensorValue, 0, 1023, 200, 1);

    TRACE("Mapped brightness value = %04d\n", brightnessSensor);
}

void onConnected(const WiFiEventStationModeConnected& event){
    TRACE("Wifi connected!\n");
}

void onGotIP(const WiFiEventStationModeGotIP& event){
    TRACE("IP : %s | Gateway: %s | RSSI : %d\n", WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str(), WiFi.RSSI());
}

void setClockBrightnessStateApi(){

    String response;
    String contentType = "application/json";
    
    String state = String(serverWeb.arg(0));
    state.toUpperCase();
    
    if(state == "OFF"){
        brightnessClockMode = BRIGHT_OFF;
    }
    else if(state == "ON"){
        brightnessClockMode = BRIGHT_ON;
    }
    else{
        brightnessClockMode = BRIGHT_AUTO;
    }
    
    response = String("{\"Status\": \"") + "State clock bright changed to " + brightnessModeToStr(brightnessClockMode) + "\"}";
    
    serverWeb.send(200, contentType , response);
    TRACE("%s\n", response.c_str());
}

// ── Rainbow helpers ──────────────────────────────────────────

/**
 * Roda de cores: converte posição 0-255 no espectro RGB completo.
 */
RGB wheelColor(uint8_t pos) {
  pos = 255 - pos;
  if (pos < 85) {
    return (RGB){ (uint8_t)(255 - pos * 3), 0, (uint8_t)(pos * 3) };
  } else if (pos < 170) {
    pos -= 85;
    return (RGB){ 0, (uint8_t)(pos * 3), (uint8_t)(255 - pos * 3) };
  } else {
    pos -= 170;
    return (RGB){ (uint8_t)(pos * 3), (uint8_t)(255 - pos * 3), 0 };
  }
}

/**
 * Percorre todos os LEDs da fita do relógio.
 * Para cada LED que está ACESO (cor != 0, ou seja pertence a um
 * segmento ativo), substitui a cor pela cor arco-íris calculada
 * a partir da posição do LED + rainbowOffset.
 * LEDs APAGADOS (segmentos inativos) permanecem pretos, preservando
 * a forma dos dígitos.
 */
void applyRainbow() {
  for (int i = 0; i < LEDCLOCK_COUNT; i++) {
    if (stripClock.getPixelColor(i) != 0) {
      uint8_t hue = (uint8_t)((i * 255 / LEDCLOCK_COUNT) + rainbowOffset);
      RGB c = wheelColor(hue);
      stripClock.setPixelColor(i, stripClock.Color(c.g, c.r, c.b));
    }
  }
}

void getTimeApi(){
  String response;
  String contentType = "application/json";

  response = String("{ \"Time\" : \"") + String(hour) + ":" + String(minute) + ":" + String(second) + "\"}";

  serverWeb.send(200, contentType , response);
  TRACE("%s\n", response);
}

void getTemperatureApi(){
  String response;
  String contentType = "application/json";

  response = String("{ \"Temperature\" : \"") + String(temperature) + " ºC\"}";

  serverWeb.send(200, contentType , response);
  TRACE("%s\n", response.c_str());
}

void getTemperatureUrlApi(){
  String response;
  String contentType = "application/json";

  response = String("{ \"Url Temperature\" : \"") + urlTemp + "\"}";

  serverWeb.send(200, contentType , response);
  TRACE("%s\n", response.c_str());
}

int convertToHHMM(String timeStr) {
  int separator = timeStr.indexOf(':');

  int hour = timeStr.substring(0, separator).toInt();
  int minute = timeStr.substring(separator + 1).toInt();

  return hour * 100 + minute;
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

  startHourToShow = convertToHHMM(startTime);
  endHourToShow = convertToHHMM(endTime);

  response = String("{ \"Status\" : \"") + "NightTime change to " + startTime + " and " + endTime + "\"}";
  serverWeb.send(200, contentType , response);
  TRACE("%s\n", response.c_str());
}

void setRainbowModeApi(){
  String response;
  String contentType = "application/json";

  rainbowMode = serverWeb.arg(0) == "ON"? RAINBOW_MODE_ON : RAINBOW_MODE_OFF;

  response = String("{ \"Rainbow state\" : \"") + rainbowModeToStr(rainbowMode) + "\"}";

  serverWeb.send(200, contentType , response);

  TRACE("%s\n", response.c_str());
}

void setHourColorApi(){
  String response;
  String contentType = "application/json";

  int i = serverWeb.arg(0).toInt();
  String r = serverWeb.arg(1);
  String g = serverWeb.arg(2);
  String b = serverWeb.arg(3);
  clockColor[i-1] = getColor(r,g,b);
  response = String("{ \"Status\" : \"") + "Hour color changed to " + colorToStr(clockColor[i-1]) + " on pos " + i + "\"}";

  serverWeb.send(200, contentType , response);
  TRACE("%s\n", response.c_str());
}

void setDayColorApi(){
  String response;
  String contentType = "application/json";

  int i = serverWeb.arg(0).toInt();
  String r = serverWeb.arg(1);
  String g = serverWeb.arg(2);
  String b = serverWeb.arg(3);

  dayColor[i-1] = getColor(r,g,b);

  response = String("{ \"Status\" : \"") + "Day color changed to " + colorToStr(dayColor[i-1]) + " on pos " + i + "\"}";

  serverWeb.send(200, contentType , response);
  TRACE("%s\n", response.c_str());
}

void setTempColorApi(){
  String response;
  String contentType = "application/json";

  int i = serverWeb.arg(0).toInt();
  String r = serverWeb.arg(1);
  String g = serverWeb.arg(2);
  String b = serverWeb.arg(3);

  tempColor[i-1] = getColor(r,g,b);
  response = String("{\"Status\" : \"") + "Temperature color changed to " + colorToStr(tempColor[i-1]) + "\"}";

  serverWeb.send(200, contentType , response);
  TRACE("%s\n", response.c_str());
}

void setDecoColorApi(){
  String response;
  String contentType = "application/json";

  int i = serverWeb.arg(0).toInt();
  String r = serverWeb.arg(1);
  String g = serverWeb.arg(2);
  String b = serverWeb.arg(3);
  clockDecoColor[i - 1] = getColor(r,g,b);
  response = String("{\"Status\" : \"") + "Decoration color " + (i) + " changed to " + colorToStr(clockDecoColor[i]) + "\"}";

  serverWeb.send(200, contentType , response);
  TRACE("%s\n", response.c_str());
}

void setDecoColorAllApi(){
  const char* contentType = "application/json";

   // Validação básica dos parâmetros
  if (serverWeb.args() < 4) {
    serverWeb.send(400, contentType, "{\"error\":\"Missing parameters\"}");
    return;
  }

  int line = serverWeb.arg(0).toInt();
  int r = serverWeb.arg(1).toInt();
  int g = serverWeb.arg(2).toInt();
  int b = serverWeb.arg(3).toInt();

  // Define faixa de LEDs
  int idxStart = (line - 1) * 7;
  int idxEnd   = idxStart + 7;

  RGB color = getColor(r,g,b);

  // Atualiza LEDs
  for (int i = idxStart; i < idxEnd; i++) {
    clockDecoColor[i] = color;
  }

  // Monta resposta sem usar muitas Strings
  char response[120];
  snprintf(response, sizeof(response),
           "{\"status\":\"Decoration color line %d changed to %s\"}",
           line,
           colorToStr(color).c_str());

  serverWeb.send(200, contentType, response);
  TRACE("%s\n", response);
}

void getInfoApi(){
  String contentType = "application/json";

  String response = getConfigClock();

  serverWeb.send(200, contentType , response);

  TRACE("%s\n", response.c_str());
}

String getConfigClock(){

  String sensorLightValues = "";

  for (int i=0; i < numReadings; i++){
    sensorLightValues += String(readings[i]) + " - ";
  }

  String clockDecoColorStr = "";
  for (int i=0; i < LEDDECO_COUNT; i++)
  {
    clockDecoColorStr += colorToStr(clockDecoColor[i]) + " - ";
  }

  // Time formatado (2 dígitos)
  char timeStr[9];
  sprintf(timeStr, "%02d:%02d:%02d", hour, minute, second);

   // Night mode (2 dígitos)
  char startStr[3];
  char endStr[3];

  sprintf(startStr, "%02d", startHourToShow);
  sprintf(endStr, "%02d", endHourToShow);

  return String("{") +
         String("\"time\": \"") + timeStr + "\"," +
         String("\"clockFirstDayColor\": \"#") + colorToStr(dayColor[0]) + "\"," +
         String("\"clockSecondDayColor\": \"#") + colorToStr(dayColor[1]) + "\"," +
         String("\"clockFirstMonthColor\": \"#") + colorToStr(dayColor[2]) + "\"," +
         String("\"clockSecodMonthColor\": \"#") + colorToStr(dayColor[3]) + "\"," +
         String("\"clockFirstHourColor\": \"#") + colorToStr(clockColor[0]) + "\"," +
         String("\"clockSecondHourColor\": \"#") + colorToStr(clockColor[1]) + "\"," +
         String("\"clockFirstMinuteColor\": \"#") + colorToStr(clockColor[2]) + "\"," +
         String("\"clockSecodMinuteColor\": \"#") + colorToStr(clockColor[3]) + "\"," +
         String("\"tempFirstValueColor\": \"#") + colorToStr(tempColor[0]) + "\"," +
         String("\"tempSecondValueColor\": \"#") + colorToStr(tempColor[1]) + "\"," +
         String("\"tempFirstSymbolColor\": \"#") + colorToStr(tempColor[2]) + "\"," +
         String("\"tempSecondSymbolColor\": \"#") + colorToStr(tempColor[3]) + "\"," +
         String("\"decoColor\": \"") + clockDecoColorStr + "\"," +
            String("\"clockBrightnessMode\": \"") + brightnessModeToStr(brightnessClockMode) + "\"," +
         String("\"decoBrightnessMode\": \"") + brightnessModeToStr(brightnessDecoMode) + "\"," +
         String("\"brightnessSensorMap\": ") + brightnessSensor + "," +
         String("\"rainbowMode\": \"") + rainbowModeToStr(rainbowMode) + "\"," +
         String("\"temperature\": \"") + String(temperature) + " ºC" + "\"," +
         String("\"urlTemperature\": \"") + urlTemp + "\"," +
         String("\"nightModeStart\": \"") + startStr + "\"," +
         String("\"nightModeEnd\": \"") + endStr + "\"" +
         String("}");
}

void setDecoBrightnessStateApi(){
  String response;
  String contentType = "application/json";

  String state = String(serverWeb.arg(0));
  state.toUpperCase();

  if (state == "OFF"){
    brightnessDecoMode = BRIGHT_OFF;
  }
  else if(state == "ON"){
    brightnessDecoMode = BRIGHT_ON;
  }
  else{
    brightnessDecoMode = BRIGHT_AUTO;
  }

  response = String("{\"Status\" : \"") + "State decoration bright changed to " + brightnessModeToStr(brightnessDecoMode) + "\"}";

  serverWeb.send(200, contentType , response);
  TRACE("%s\n", response.c_str());
}

void readTheTime(){
  timeClient.update();

  hour = timeClient.getHours();
  minute = timeClient.getMinutes();
  second = timeClient.getSeconds();

 // Timestamp completo
  unsigned long epochTime = timeClient.getEpochTime();

  // Converte para data
  struct tm *ptm = gmtime((time_t *)&epochTime);

  day = ptm->tm_mday;
  month = ptm->tm_mon + 1;

  // Exibe no Serial
  TRACE("Data: %02d/%02d  Hora: %02d:%02d:%02d\n", day, month, hour, minute, second);
}

void displayTheDay(){
  stripClock.clear(); //clear the clock face

  int firstDigit = month % 10; //work out the value of the first digit and then display it
  displayNumber(firstDigit, 0, colorToInt(dayColor[3]));

  int secondDigit = floor(month / 10); //work out the value for the second digit and then display it
  displayNumber(secondDigit, 63, colorToInt(dayColor[2]));

  int thirdDigit = day % 10; //work out the value for the third digit and then display it
  displayNumber(thirdDigit, 126, colorToInt(dayColor[1]));

  int fourthDigit = floor(day/ 10); //work out the value for the fourth digit and then display it
  displayNumber(fourthDigit, 189, colorToInt(dayColor[0]));
}

void displayTheTime(){
  stripClock.clear(); //clear the clock face

  int firstminuteDigit = minute % 10; //work out the value of the first digit and then display it
  displayNumber(firstminuteDigit, 0, colorToInt(clockColor[3]));

  int secondminuteDigit = floor(minute / 10); //work out the value for the second digit and then display it
  displayNumber(secondminuteDigit, 63, colorToInt(clockColor[2]));

  int firstHourDigit = hour % 10; //work out the value for the third digit and then display it
  displayNumber(firstHourDigit, 126, colorToInt(clockColor[1]));

  int secondHourDigit = floor(hour/ 10); //work out the value for the fourth digit and then display it
  displayNumber(secondHourDigit, 189, colorToInt(clockColor[0]));
}

void readTheTemperature(){
    WiFiClient client;
    HTTPClient http;

    bool lerTemperatura = temperature == -1 || minute % 59 == 0;

    if(!lerTemperatura){
        return;
    }

    temperature = 0;

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
          temperature = (int)myObject["temp"];
          TRACE("Temperature value read: %03d\n", temperature);
        }
      } else {
        TRACE("Error reading temperature\n");
      }

      http.end();
    } else {
      TRACE("[HTTP} Unable to connect to read temperature\n");
    }
}

void displayTheTemperature(){
  stripClock.clear(); //clear the clock face

  letterC(0, colorToInt(tempColor[3]));

  symbolDegrees(63, colorToInt(tempColor[2]));

  int firstTempDigit = temperature % 10; //work out the value for the third digit and then display it
  displayNumber(firstTempDigit, 126, colorToInt(tempColor[1]));

  int secondTempDigit = floor(temperature/ 10); //work out the value for the fourth digit and then display it
  displayNumber(secondTempDigit, 189, colorToInt(tempColor[0]));
}

uint32_t colorToInt(RGB color){
  return stripClock.Color(color.g, color.r, color.b);
}

String rainbowModeToStr(int mode){
  switch(mode){
    case 0:
      return "0 - off";
    case 1:
      return "1 - on";
  }

  return "invalid";
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

void symbolDegrees(int offset, uint32_t colour){
  stripClock.fill(colour, (0 + offset), 36);
}
