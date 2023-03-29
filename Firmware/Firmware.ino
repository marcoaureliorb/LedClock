#include <WiFiUdp.h>
#include <NTPClient.h>
#include <Arduino_JSON.h>
#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <Adafruit_NeoPixel.h>
#include "Utils.h"
#include <ESP8266HTTPClient.h>
#include "builtinfiles.h"
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

/////////////////////////////////////////////////////////////////////////////// SETTINGS ///////////////////////////////////////////////////////////////////////////////

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

RGB clockColor[4];
RGB tempColor[4];
RGB clockDecoColor[14];

int hour = 0;
int minute = 0;
int second = 0;

String urlTemp = "http://api.hgbrasil.com/weather?woeid=455831&format=json-cors&array_limit=2&fields=only_results,temp,city_name&key=3b983af0";
int temperature = 0;
int timeToChangeMode = 0;

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
   delay(3000);  // wait for serial monitor to start completely.
   
   Serial.begin(115200);
   Serial.setDebugOutput(false);
   
   Serial.println("HELLO !");

   WiFi.mode(WIFI_STA);
   WiFi.begin(ssid, passPhrase);
   WiFi.hostname("WIFI-Clock");
   
   static WiFiEventHandler onConnectedHandler = WiFi.onStationModeConnected(onConnected);
   static WiFiEventHandler onGotIPHandler = WiFi.onStationModeGotIP(onGotIP);

   // Wait for connection
   while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
   }

   serverWeb.on("/", [](){
     serverWeb.send(200, "text/html", FPSTR(homeHtml));
   });
   
   serverWeb.on("/getinfo", getInfoApi);
   serverWeb.on("/gettime", getTimeApi);
   serverWeb.on("/gettemperature", getTemperatureApi);
   serverWeb.on("/gettemperatureurl", getTemperatureUrlApi);  
   serverWeb.on("/setHourColor", setHourColorApi);  
   serverWeb.on("/setcolortemp", setTempColorApi);
   serverWeb.on("/setclockbrightnessstate", setClockBrightnessState);
   serverWeb.on("/setdecobrightnessstate", setDecoBrightnessState);
   serverWeb.on("/setdecocolor", setDecoColorApi);
   serverWeb.on("/setHourMinuteToShow", sethourminutetoshow);
   serverWeb.on("/showTemperature", showTemperature);
   
   serverWeb.onNotFound([](){
     serverWeb.send(404, "text/html", FPSTR(notFoundContent));
   });
   
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
   
   tempColor[0] = (RGB){ 0 , 0 , 255 };
   tempColor[1] = (RGB){ 0 , 0 , 255 };
   tempColor[2] = (RGB){ 255 , 255 , 255 };
   tempColor[3] = (RGB){ 255 , 255 , 255 };
   
   clockColor[0] = (RGB){ 0 , 0 , 255 };
   clockColor[1] = (RGB){ 0 , 0 , 255 };
   clockColor[2] = (RGB){ 255 , 255 , 255 };
   clockColor[3] = (RGB){ 255 , 255 , 255 }; 
}

void loop() {
  if (WiFi.isConnected())
  {
    serverWeb.handleClient();

    if(timeToChangeMode <= 5){
        readTheTime();
        displayTheTime();
    }
    else{
      readTheTemperature();
      displayTheTemperature();
    }

    if(timeToChangeMode >= 10){
      timeToChangeMode = -1;
    }

    timeToChangeMode++;

    switch (brightnessDecoMode)
    {
      case BRIGHT_OFF:
        stripDeco.setBrightness(0);
        Serial.println("LED DECO OFF");
        break;
      case BRIGHT_ON:
        stripDeco.setBrightness(BRIGHT_DEFAULT_VALUE);
        Serial.println("LED DECO ON");
        break;    
      case BRIGHT_AUTO:
        readThebrightnessValue();
        stripDeco.setBrightness(brightnessSensor);
        Serial.println("LED DECO AUTO ON");
        break;
    }

    switch (brightnessClockMode)
    {
      case BRIGHT_OFF:
        stripClock.setBrightness(0);
        Serial.println("LED CLOCK OFF");
        break;
      case BRIGHT_ON:
        stripClock.setBrightness(BRIGHT_DEFAULT_VALUE);
        Serial.println("LED CLOCK ON");
        break;     
      case BRIGHT_AUTO:
        readThebrightnessValue();
        stripClock.setBrightness(brightnessSensor);
        Serial.println("LED CLOCK AUTO ON");
        break;
    }

    for(int i=0; i<LEDDECO_COUNT; i++) {
      RGB cor = clockDecoColor[i];
      stripDeco.setPixelColor(i, stripDeco.Color(cor.g, cor.r, cor.b));
    }

    int hourInt = hour * 100 + minute;
    if( hourInt > startHourToShow && hourInt < endHourToShow){
      stripDeco.setBrightness(0);
      stripClock.setBrightness(0);
      Serial.println("Clock bright automatc to off. ");
    }

    stripDeco.show(); 
    stripClock.show();
  }
  else
  {
    Serial.println("waiting for wifi ...");
  }

  delay(1000);
  Serial.println("");
}

void readThebrightnessValue(){
    //Record a reading from the light sensor and add it to the array
    int valueReadFromSensor = analogRead(A0);
    
    Serial.print("Light sensor value = ");
    Serial.println(valueReadFromSensor);

    readings[readIndex] = valueReadFromSensor;
    Serial.print("Light sensor value added to array = ");
    Serial.println(readings[readIndex]);
    readIndex = readIndex + 1; // advance to the next position in the array:

    if (readIndex >= numReadings) {
      readIndex = 0;
    }
  
    //now work out the sum of all the values in the array
    int sumBrightness = 0;
    for (int i=0; i < numReadings; i++) {
          sumBrightness += readings[i];
    }
    
    Serial.print("Sum of the brightness array = ");
    Serial.println(sumBrightness);
  
    // and calculate the average: 
    int lightSensorValue = sumBrightness / numReadings;
    Serial.print("Average light sensor value = ");
    Serial.println(lightSensorValue);

    brightnessSensor = map(lightSensorValue, 0, 1023, 200, 1); 

    Serial.print("Mapped brightness value = ");
    Serial.println(brightnessSensor);
}

void onConnected(const WiFiEventStationModeConnected& event)
{
  Serial.println("");
  Serial.println("Wifi connected!");
  Serial.println("");
}

void onGotIP(const WiFiEventStationModeGotIP& event)
{
  Serial.println("");
  Serial.println("IP : " + WiFi.localIP().toString());
  Serial.println("Gateway: " + WiFi.gatewayIP().toString());
  Serial.print("RSSI : ");
  Serial.println(WiFi.RSSI());
  Serial.println("");
}

void setClockBrightnessState(){

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
  Serial.println(response);      
}

void getTimeApi(){
  String response;
  String contentType = "application/json";
  
  response = String("{ \"Time\" : \"") + String(hour) + ":" + String(minute) + ":" + String(second) + "\"}";
  
  serverWeb.send(200, contentType , response);
  Serial.println(response);
}

void getTemperatureApi(){
  String response;
  String contentType = "application/json";
  
  response = String("{ \"Temperature\" : \"") + String(temperature) + " ºC\"}";
  
  serverWeb.send(200, contentType , response);
  Serial.println(response);
}

void getTemperatureUrlApi(){
  String response;
  String contentType = "application/json";
  
  response = String("{ \"Url Temperature\" : \"") + urlTemp + "\"}";
  
  serverWeb.send(200, contentType , response);
  Serial.println(response);
}

void showTemperature(){
  
  timeToChangeMode = 5;

  String response;
  String contentType = "application/json";
  response = String("{ \"ShowTemperature\" : \"") + "OK" + "\"}";
  serverWeb.send(200, contentType , response); 
  Serial.println(response); 
}

void sethourminutetoshow(){
  String response;
  String contentType = "application/json";
  
  startHourToShow = serverWeb.arg(0).toInt() * 100 + serverWeb.arg(1).toInt();
  endHourToShow = serverWeb.arg(2).toInt() * 100 + serverWeb.arg(3).toInt();
  
  response = String("{ \"Status\" : \"") + "Hour and minute to show led changed between " + startHourToShow + " and " + endHourToShow + "\"}";
  serverWeb.send(200, contentType , response);
  Serial.println(response);
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
  Serial.println(response);
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
  Serial.println(response);
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
  Serial.println(response);
}

void getInfoApi(){
  String contentType = "application/json";
  
  String response = getConfigClock();
    
  serverWeb.send(200, contentType , response);
  
  Serial.println(response);
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
    
    return String("{") + 
           
           String("\"Time\": \"") + String(hour) + ":" + String(minute) + ":" + String(second) + "\"," + 
           
           String("\"Clock_First_Hour_Color\": \"#") + colorToStr(clockColor[0]) + "\"," + 
           String("\"Clock_Second_Hour_Color\": \"#") + colorToStr(clockColor[1]) + "\"," +   
           
           String("\"Clock_First_Minute_Color\": \"#") + colorToStr(clockColor[2]) + "\"," + 
           String("\"Clock_Secod_Minute_Color\": \"#") + colorToStr(clockColor[3]) + "\"," + 
           
           String("\"Clock_Brightness_Mode\": \"") + brightnessModeToStr(brightnessClockMode) + "\"," + 
           String("\"Brightness_Sensor_Values\": \"") + sensorLightValues + "\"," + 
           String("\"Brightness_Sensor_map\": ") + brightnessSensor + "," + 
                 
           String("\"Temperature\": \"") + String(temperature) + " ºC" + "\"," + 
           String("\"Url_Temperature\": \"") + urlTemp + "\"," + 
           
           String("\"Temp_First_Value_Color\": \"#") + colorToStr(tempColor[0]) + "\"," + 
           String("\"Temp_Second_Value_Color\": \"#") + colorToStr(tempColor[1]) + "\"," + 
           String("\"Temp_First_Symbol_Color\": \"#") + colorToStr(tempColor[2]) + "\"," + 
           String("\"Temp_Second_Symbol_Color\": \"#") + colorToStr(tempColor[3]) + "\"," +
           
           String("\"Deco_Color\": \"") + clockDecoColorStr + "\"," + 
           String("\"Deco_Brightness_Mode\": \"") + brightnessModeToStr(brightnessDecoMode) + "\"," +
           
           String("\"Hour_and_minute_to_show\": \"") + String(startHourToShow) + " and " + String(endHourToShow) + "\"" + 
           "}";  
}

void setDecoBrightnessState()
{
  String response;
  String contentType = "application/json";
  
  String state = String(serverWeb.arg(1));
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
  Serial.println(response);
}

void readTheTime()
{
  timeClient.update();
  
  hour = timeClient.getHours();
  minute = timeClient.getMinutes();
  second = timeClient.getSeconds();

  Serial.print("Time is: ");   
  Serial.print(hour);
  Serial.print(":");
  Serial.print(minute);
  Serial.print(":");
  Serial.println(second);
}

void displayTheTime(){
  stripClock.clear(); //clear the clock face 
 
  int firstminuteDigit = minute % 10; //work out the value of the first digit and then display it
  displayNumber(firstminuteDigit, 0, colorToInt(clockColor[3]));
  printRGB("Color second minute: ", clockColor[3]);  

  int secondminuteDigit = floor(minute / 10); //work out the value for the second digit and then display it
  displayNumber(secondminuteDigit, 63, colorToInt(clockColor[2]));  
  printRGB("Color first minute: ", clockColor[2]);  

  int firstHourDigit = hour % 10; //work out the value for the third digit and then display it
  displayNumber(firstHourDigit, 126, colorToInt(clockColor[1]));
  printRGB("Color second hour: ", clockColor[1]);

  int secondHourDigit = floor(hour/ 10); //work out the value for the fourth digit and then display it
  displayNumber(secondHourDigit, 189, colorToInt(clockColor[0]));
  printRGB("Color first hour: ", clockColor[0]);  
}

void readTheTemperature(){
    WiFiClient client;
    HTTPClient http;

    Serial.println("Reading the temperature");

    bool lerTemperatura = temperature == 0 || (hour % 3 == 0 && minute % 15 == 0);

    if(!lerTemperatura){
        return;
    }

    Serial.println("[HTTP] begin...\n");
    temperature = 0;
    
    if (http.begin(client, urlTemp)) {

      Serial.print("[HTTP] GET...\n");
      // start connection and send HTTP header
      int httpCode = http.GET();

      // httpCode will be negative on error
      if (httpCode > 0) {
        // HTTP header has been send and Server response header has been handled
        Serial.printf("[HTTP] GET... code: %d\n", httpCode);

        // file found at server
        if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_MOVED_PERMANENTLY) {
          String payload = http.getString();
          JSONVar myObject = JSON.parse(payload);
          Serial.println(payload);
          
          // JSON.typeof(jsonVar) can be used to get the type of the var
          if (JSON.typeof(myObject) == "undefined") {
            Serial.println("Parsing input failed!");
            return;
          }

          Serial.print("JSON object = ");
          Serial.println(myObject);
          JSONVar keys = myObject.keys();
          temperature = (int)myObject["temp"];
          Serial.print(keys[0]);
          Serial.print(" = ");
          Serial.println(temperature);
        }
      } else {
        Serial.printf("[HTTP] GET... failed, error: %s\n", http.errorToString(httpCode).c_str());
      }

      http.end();
    } else {
      Serial.printf("[HTTP} Unable to connect\n");
    }
}

void displayTheTemperature(){
  stripClock.clear(); //clear the clock face 

  letterC(0, colorToInt(tempColor[3]));
  printRGB("Color letter: ", tempColor[3]);

  symbolDegrees(63, colorToInt(tempColor[2]));  
  printRGB("Color symbol: ", tempColor[2]);
  
  int firstTempDigit = temperature % 10; //work out the value for the third digit and then display it
  displayNumber(firstTempDigit, 126, colorToInt(tempColor[1]));
  printRGB("Color second digit: ", tempColor[1]);

  int secondTempDigit = floor(temperature/ 10); //work out the value for the fourth digit and then display it
  displayNumber(secondTempDigit, 189, colorToInt(tempColor[0]));
  printRGB("Color first digit: ", tempColor[0]);
}

uint32_t colorToInt(RGB color){
  return stripClock.Color(color.g, color.r, color.b);
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
