// TRACE output simplified, can be deactivated here
#define TRACE(...) Serial.printf(__VA_ARGS__)

// choose the brightness Clock Mode
#define BRIGHT_OFF 0
#define BRIGHT_ON 1
#define BRIGHT_AUTO 2
#define BRIGHT_DEFAULT_VALUE 50

#define RAINBOW_MODE_OFF 0
#define RAINBOW_MODE_ON 1

// Which pin on the Arduino is connected to the NeoPixels?
#define LEDCLOCK_PIN 14 // pin D5 sur esp8266/arduino nano
#define LEDDECO_PIN  12 // pin D6 sur esp8266/arduino nano

// How many NeoPixels are attached to the Arduino?
#define LEDCLOCK_COUNT 252
#define LEDDECO_COUNT 14

#define LEDS_PER_SEGMENT 9
#define DIGIT_OFFSET 63 // = 7 seg × 9 LEDs

typedef struct {
  uint8_t r;
  uint8_t g;
  uint8_t b;
} RGB;

// 7 segmentos por dígito
typedef struct {
  uint32_t color;
} Digit;

// 4 dígitos
typedef struct {
  Digit d[4]; // d1..d4
} Digits;

// Tipos de display
typedef struct {
  Digits digits;
} DisplayType;

// Display completo
typedef struct {
  DisplayType clock;
  DisplayType day;
  DisplayType temp;
} Display;

// Decoration (l1, l2)
typedef struct {
  uint32_t l1[7];
  uint32_t l2[7];
} Decoration;

// Brightness
typedef struct {
  uint8_t clock;       // 1-ON / 2-OFF / 3-AUTO
  uint8_t decoration;  // 1-ON / 2-OFF / 3-AUTO
} Brightness;

// Rainbow
typedef struct {
  uint8_t state; // 1-ON / 2-OFF
  int speed;
} Rainbow;

// Estrutura principal
typedef struct {
  Display display;
  Decoration decoration;
  Brightness brightness;
  Rainbow rainbow;
  char temperature_url[200];
} Config;

// URL raw do HTML no GitHub (HTTPS)
const char* HTML_URL = "https://raw.githubusercontent.com/marcoaureliorb/LedClock/refs/heads/main/WebApi/index.html";
// Timeout para requisição HTTP ao GitHub (ms)
const int   HTTP_TIMEOUT_MS = 8000;

const String urlTemp = "http://api.hgbrasil.com/weather?woeid=455831&format=json-cors&array_limit=2&fields=only_results,temp,city_name&key=3b983af0";

Config GetDefaultConfiguration();
void onConnected(const WiFiEventStationModeConnected& event);
void onGotIP(const WiFiEventStationModeGotIP& event);

void setRainbowModeApi();
void readThebrightnessValue();
void handleRoot();
void handleGetDefaultConfig();
void handleSetDefaultConfig();
void parseDisplayType(JsonObject obj, DisplayType& dt);

const char* stateRainbowToString(uint8_t value);
const char* brightnessToString(uint8_t value);

uint8_t stringToStateRainbow(const char* value);
uint8_t stringToBrightness(const char* value);

uint32_t hexToColor(const char* hex);
String colorToHex(uint32_t color);

String serializeConfig(const Config& config);

void readTheTime();
void displayTheTime();
void displayTheDay();

void displayTheTemperature();
void readTheTemperature();

RGB wheelColor(uint8_t pos);
void applyRainbow();

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
void symbolDegrees(int offset, uint32_t colour);

Config GetDefaultConfiguration();






