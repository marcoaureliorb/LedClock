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
#include <user_interface.h>

// --------------------------------------------------------------------------------
// ------------------------------------ LOG ---------------------------------------
// --------------------------------------------------------------------------------
//
// Formato: [segundos.milis] [TAG] mensagem
// As strings de formato ficam na flash (PSTR) para não consumir RAM.
// Cada linha vai para a Serial e também para um buffer circular em RAM,
// consultado pela rota /getLogs.
//
// Memória do buffer: LOG_BUFFER_LINES x LOG_LINE_LEN = 50 x 160 = 8000 bytes (estático).
// O ESP8266 tem ~80 KB de RAM; o firmware usa ~34 KB estáticos, então sobra heap suficiente.
constexpr uint32_t LOG_BUFFER_LINES = 50;
constexpr uint32_t LOG_LINE_LEN = 160;   // linhas maiores são truncadas no buffer (a Serial recebe completa)

char logBuffer[LOG_BUFFER_LINES][LOG_LINE_LEN];
uint32_t logSeq = 0;          // número sequencial da última linha gravada (1, 2, 3, ...)
char bootSummary[220] = "";   // resumo do boot (motivo do reset, último checkpoint) - não sai do buffer

void logPrintf(PGM_P fmt, ...) __attribute__((format(printf, 1, 2)));
void logPrintf(PGM_P fmt, ...) {
    char line[320];
    va_list args;
    va_start(args, fmt);
    vsnprintf_P(line, sizeof(line), fmt, args);
    va_end(args);

    Serial.println(line);

    logSeq++;
    char* slot = logBuffer[logSeq % LOG_BUFFER_LINES];
    strncpy(slot, line, LOG_LINE_LEN - 1);
    slot[LOG_LINE_LEN - 1] = '\0';
}

#define LOG(tag, fmt, ...) \
    logPrintf(PSTR("[%7lu.%03lu] [%-6s] " fmt), millis() / 1000UL, millis() % 1000UL, tag, ##__VA_ARGS__)

// Operações que demorarem mais que isso são logadas como lentas
constexpr uint32_t SLOW_OP_MS = 50;
// Intervalo entre duas entradas no loop() acima disso é logado como "loop lento"
constexpr uint32_t SLOW_LOOP_MS = 250;
// Tempo máximo sem progresso no envio TCP de um arquivo (index.html, app.js, style.css)
constexpr uint32_t FILE_SEND_TIMEOUT_MS = 10000;
// Intervalo do log periódico de saúde do sistema
constexpr uint32_t HEALTH_INTERVAL_MS = 10000;

// Mede o tempo de uma expressão e loga se passar de SLOW_OP_MS
#define TIMED(tag, label, expr)                                                     \
    do {                                                                            \
        uint32_t _t0 = millis();                                                    \
        expr;                                                                       \
        uint32_t _dt = millis() - _t0;                                              \
        if (_dt >= SLOW_OP_MS) LOG(tag, "LENTO: %s levou %lu ms", label, _dt);      \
    } while (0)

// --------------------------------------------------------------------------------
// ------------------------- CHECKPOINTS (BREADCRUMB) -----------------------------
// --------------------------------------------------------------------------------
//
// Antes de cada trecho importante gravamos um "checkpoint" na memória RTC.
// A memória RTC sobrevive a reset por watchdog/exceção (mas não a falta de energia).
// No boot seguinte imprimimos o último checkpoint -> mostra ONDE o código travou.
//
enum Checkpoint : uint32_t {
    CP_NONE = 0,
    CP_SETUP,
    CP_SETUP_EEPROM,
    CP_SETUP_OLED,
    CP_SETUP_WIFI_WAIT,
    CP_SETUP_FS,
    CP_SETUP_SERVER,
    CP_SETUP_STRIPS,
    CP_LOOP_START,
    CP_LOOP_WIFI_DOWN,
    CP_HANDLE_CLIENT,
    CP_INIT_ANIMATION,
    CP_ALARM_RINGING,
    CP_ALARM_CHECK,
    CP_UMBRELLA_ANIM,
    CP_NIGHT_MODE,
    CP_SECOND_TICK,
    CP_READ_TIME,
    CP_READ_TEMP_BEGIN,
    CP_READ_TEMP_GET,
    CP_READ_TEMP_PAYLOAD,
    CP_READ_TEMP_PARSE,
    CP_READ_TEMP_END,
    CP_READ_LDR,
    CP_DISPLAY_TIME,
    CP_DISPLAY_DAY,
    CP_DISPLAY_TEMP,
    CP_DISPLAY_HUMIDITY,
    CP_SHOW_CLOCK,
    CP_SHOW_DECO,
    CP_OLED_UPDATE,
    CP_EEPROM_SAVE,
    CP_API,
    CP_API_GETINFO_JSON,
    CP_API_STREAM_FILE,
    CP_LOOP_END,
    CP_COUNT
};

const char* const CHECKPOINT_NAMES[CP_COUNT] = {
    "NONE", "SETUP", "SETUP_EEPROM", "SETUP_OLED", "SETUP_WIFI_WAIT", "SETUP_FS",
    "SETUP_SERVER", "SETUP_STRIPS", "LOOP_START", "LOOP_WIFI_DOWN", "HANDLE_CLIENT",
    "INIT_ANIMATION", "ALARM_RINGING", "ALARM_CHECK", "UMBRELLA_ANIM", "NIGHT_MODE",
    "SECOND_TICK", "READ_TIME", "READ_TEMP_BEGIN", "READ_TEMP_GET", "READ_TEMP_PAYLOAD",
    "READ_TEMP_PARSE", "READ_TEMP_END", "READ_LDR", "DISPLAY_TIME", "DISPLAY_DAY",
    "DISPLAY_TEMP", "DISPLAY_HUMIDITY", "SHOW_CLOCK", "SHOW_DECO", "OLED_UPDATE",
    "EEPROM_SAVE", "API", "API_GETINFO_JSON", "API_STREAM_FILE", "LOOP_END"
};

const char* checkpointName(uint32_t cp) {
    return cp < CP_COUNT ? CHECKPOINT_NAMES[cp] : "INVALIDO";
}

constexpr uint32_t RTC_MAGIC = 0xB00B1E55;
// Os primeiros 128 bytes (32 blocos) da memória RTC de usuário são usados pelo OTA
constexpr uint32_t RTC_OFFSET = 32;

struct RtcBreadcrumb {
    uint32_t magic;
    uint32_t bootCount;
    uint32_t checkpoint;
    uint32_t uptimeMs;
    uint32_t freeHeap;
    char lastApi[24];       // última rota HTTP chamada (truncada)
};

RtcBreadcrumb breadcrumb;
uint32_t currentCheckpoint = CP_NONE;

inline void CP(Checkpoint cp) {
    currentCheckpoint = cp;
    breadcrumb.checkpoint = cp;
    breadcrumb.uptimeMs = millis();
    breadcrumb.freeHeap = ESP.getFreeHeap();
    ESP.rtcUserMemoryWrite(RTC_OFFSET, (uint32_t*)&breadcrumb, sizeof(breadcrumb));
}

// --------------------------------------------------------------------------------
// ---------------------------------- CONSTANTES ----------------------------------
// --------------------------------------------------------------------------------

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

// ----------------------- Variáveis de diagnóstico (log) -------------------------
bool oledOk = false;
bool timeSynced = false;
// true enquanto não houver uma leitura de temperatura bem-sucedida (força nova tentativa)
bool temperaturePending = true;
bool lastNightModeState = false;
bool lastUmbrellaState = false;
int lastLoggedMinute = -1;
int lastClockBrightApplied = -1;
int lastDecoBrightApplied = -1;

uint32_t lastLoopEntryMs = 0;
uint32_t lastHealthMs = 0;
uint32_t loopCount = 0;
uint32_t maxLoopGapMs = 0;
uint32_t maxLoopGapCp = CP_NONE;
uint32_t slowLoopCount = 0;
uint32_t showClockCount = 0;
uint32_t showDecoCount = 0;
uint32_t showClockTotalMs = 0;
uint32_t showDecoTotalMs = 0;
uint32_t apiRequestCount = 0;
uint32_t getLogsCount = 0;      // requisições /getLogs (não entram no log)
uint32_t wifiDisconnectCount = 0;
uint32_t minFreeHeap = UINT32_MAX;

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

// --------------------------------------------------------------------------------
// ----------------------------- FUNÇÕES DE DIAGNÓSTICO ---------------------------
// --------------------------------------------------------------------------------

const char* wifiStatusName(wl_status_t s) {
    switch (s) {
        case WL_IDLE_STATUS:     return "IDLE";
        case WL_NO_SSID_AVAIL:   return "NO_SSID_AVAIL";
        case WL_SCAN_COMPLETED:  return "SCAN_COMPLETED";
        case WL_CONNECTED:       return "CONNECTED";
        case WL_CONNECT_FAILED:  return "CONNECT_FAILED";
        case WL_CONNECTION_LOST: return "CONNECTION_LOST";
        case WL_WRONG_PASSWORD:  return "WRONG_PASSWORD";
        case WL_DISCONNECTED:    return "DISCONNECTED";
        default:                 return "DESCONHECIDO";
    }
}

const char* modeName(int mode) {
    switch (mode) {
        case OFF:  return "OFF";
        case ON:   return "ON";
        case AUTO: return "AUTO";
        default:   return "INVALIDO";
    }
}

void logHeap(const char* where) {
    LOG("HEAP", "%s: livre=%u maiorBloco=%u frag=%u%% stackLivre=%u",
        where, ESP.getFreeHeap(), ESP.getMaxFreeBlockSize(), ESP.getHeapFragmentation(), ESP.getFreeContStack());
}

void logBootInfo() {
    LOG("BOOT", "==================================================");
    LOG("BOOT", "LED Clock iniciando");
    LOG("BOOT", "Motivo do reset: %s", ESP.getResetReason().c_str());

    rst_info* ri = ESP.getResetInfoPtr();
    if (ri) {
        // reason: 0=PowerOn 1=HW WDT 2=Exception 3=SW WDT 4=Soft restart 5=Deep sleep 6=Ext reset
        LOG("BOOT", "ResetInfo: reason=%u exccause=%u epc1=0x%08x epc2=0x%08x epc3=0x%08x excvaddr=0x%08x depc=0x%08x",
            ri->reason, ri->exccause, ri->epc1, ri->epc2, ri->epc3, ri->excvaddr, ri->depc);
        if (ri->reason == REASON_WDT_RST)       LOG("BOOT", "!!! RESET POR WATCHDOG DE HARDWARE (codigo travou com interrupcoes desligadas ou loop infinito sem yield)");
        if (ri->reason == REASON_SOFT_WDT_RST)  LOG("BOOT", "!!! RESET POR WATCHDOG DE SOFTWARE (loop() ficou > ~3s sem devolver controle)");
        if (ri->reason == REASON_EXCEPTION_RST) LOG("BOOT", "!!! RESET POR EXCECAO (crash). Use o exception decoder com epc1=0x%08x", ri->epc1);
    }

    LOG("BOOT", "ChipId=%08X  CPU=%uMHz  Flash=%u bytes (real=%u)  Core=%s  SDK=%s",
        ESP.getChipId(), ESP.getCpuFreqMHz(), ESP.getFlashChipSize(), ESP.getFlashChipRealSize(),
        ESP.getCoreVersion().c_str(), ESP.getSdkVersion());
    LOG("BOOT", "Sketch=%u bytes  Livre p/ sketch=%u  sizeof(Config)=%u",
        ESP.getSketchSize(), ESP.getFreeSketchSpace(), (unsigned)sizeof(Config));
    logHeap("boot");

    // Breadcrumb do boot anterior
    RtcBreadcrumb prev;
    if (ESP.rtcUserMemoryRead(RTC_OFFSET, (uint32_t*)&prev, sizeof(prev)) && prev.magic == RTC_MAGIC) {
        LOG("BOOT", ">>> Boot anterior #%u: ultimo checkpoint = %s (%u) aos %u ms de uptime, heap livre=%u",
            prev.bootCount, checkpointName(prev.checkpoint), prev.checkpoint, prev.uptimeMs, prev.freeHeap);
        prev.lastApi[sizeof(prev.lastApi) - 1] = 0;
        LOG("BOOT", ">>> Ultima rota HTTP chamada no boot anterior: '%s'", prev.lastApi);
        breadcrumb = prev;
        breadcrumb.bootCount = prev.bootCount + 1;

        snprintf(bootSummary, sizeof(bootSummary),
            "Boot #%u | Reset: %s (exccause=%u epc1=0x%08x) | Anterior: checkpoint %s aos %u ms, heap %u, rota '%s'",
            breadcrumb.bootCount, ESP.getResetReason().c_str(), ri ? ri->exccause : 0, ri ? ri->epc1 : 0,
            checkpointName(prev.checkpoint), prev.uptimeMs, prev.freeHeap, prev.lastApi);
    } else {
        LOG("BOOT", "Sem breadcrumb anterior na RTC (power-on ou primeira execucao)");
        memset(&breadcrumb, 0, sizeof(breadcrumb));
        breadcrumb.magic = RTC_MAGIC;
        breadcrumb.bootCount = 1;

        snprintf(bootSummary, sizeof(bootSummary), "Boot #1 | Reset: %s | Sem dados do boot anterior",
            ESP.getResetReason().c_str());
    }
    breadcrumb.lastApi[0] = 0;
    LOG("BOOT", "Boot numero %u desde o ultimo power-on", breadcrumb.bootCount);
    LOG("BOOT", "==================================================");
}

void logConfig(const char* where) {
    LOG("CONFIG", "--- %s ---", where);
    LOG("CONFIG", "magic=0x%08X version=%u", dadosLedClock.magic, dadosLedClock.version);
    LOG("CONFIG", "clockColor=  %06X %06X %06X %06X", dadosLedClock.clockColor[0], dadosLedClock.clockColor[1], dadosLedClock.clockColor[2], dadosLedClock.clockColor[3]);
    LOG("CONFIG", "dayColor=    %06X %06X %06X %06X", dadosLedClock.dayColor[0], dadosLedClock.dayColor[1], dadosLedClock.dayColor[2], dadosLedClock.dayColor[3]);
    LOG("CONFIG", "tempColor=   %06X %06X %06X %06X", dadosLedClock.tempColor[0], dadosLedClock.tempColor[1], dadosLedClock.tempColor[2], dadosLedClock.tempColor[3]);
    LOG("CONFIG", "humidColor=  %06X %06X %06X %06X", dadosLedClock.humidityColor[0], dadosLedClock.humidityColor[1], dadosLedClock.humidityColor[2], dadosLedClock.humidityColor[3]);
    for (int i = 0; i < 14; i += 7) {
        LOG("CONFIG", "decoColor[%2d..%2d]= %06X %06X %06X %06X %06X %06X %06X", i, i + 6,
            dadosLedClock.decoColor[i], dadosLedClock.decoColor[i + 1], dadosLedClock.decoColor[i + 2], dadosLedClock.decoColor[i + 3],
            dadosLedClock.decoColor[i + 4], dadosLedClock.decoColor[i + 5], dadosLedClock.decoColor[i + 6]);
    }
    LOG("CONFIG", "brightness: clock=%s(%d) deco=%s(%d)",
        modeName(dadosLedClock.brightnessMode.clockMode), dadosLedClock.brightnessMode.clockMode,
        modeName(dadosLedClock.brightnessMode.decoMode), dadosLedClock.brightnessMode.decoMode);
    LOG("CONFIG", "nightMode: enabled=%d %02d:%02d -> %02d:%02d", dadosLedClock.nightMode.enabled,
        dadosLedClock.nightMode.start.hour, dadosLedClock.nightMode.start.minute,
        dadosLedClock.nightMode.end.hour, dadosLedClock.nightMode.end.minute);
    LOG("CONFIG", "alarm: enabled=%d %02d:%02d", dadosLedClock.alarm.enabled,
        dadosLedClock.alarm.time.hour, dadosLedClock.alarm.time.minute);
}

// Loga a requisição HTTP recebida com todos os argumentos
void logRequest(const char* handler) {
    apiRequestCount++;
    CP(CP_API);
    strncpy(breadcrumb.lastApi, serverWeb.uri().c_str(), sizeof(breadcrumb.lastApi) - 1);
    breadcrumb.lastApi[sizeof(breadcrumb.lastApi) - 1] = 0;
    ESP.rtcUserMemoryWrite(RTC_OFFSET, (uint32_t*)&breadcrumb, sizeof(breadcrumb));

    LOG("HTTP", "#%u %s %s (handler=%s) de %s, %d arg(s), heap=%u", apiRequestCount,
        serverWeb.method() == HTTP_GET ? "GET" : (serverWeb.method() == HTTP_POST ? "POST" : "OUTRO"),
        serverWeb.uri().c_str(), handler, serverWeb.client().remoteIP().toString().c_str(),
        serverWeb.args(), ESP.getFreeHeap());
    for (int i = 0; i < serverWeb.args(); i++) {
        LOG("HTTP", "   arg[%d] %s = '%s'", i, serverWeb.argName(i).c_str(), serverWeb.arg(i).c_str());
    }
}

// Lê e valida os argumentos (posição, cor) das APIs de cor.
// Em caso de erro já responde 400 e retorna false.
// colorStr guarda a String da cor (evita ponteiro para String temporária destruída).
bool readColorArgs(const char* api, int minIdx, int maxIdx, int &idx, String &colorStr, uint32_t &color) {
    if (serverWeb.args() < 2) {
        LOG("API", "%s: parametros faltando -> 400", api);
        serverWeb.send(400, "application/json", "{\"error\":\"Missing parameters\"}");
        return false;
    }

    idx = serverWeb.arg(0).toInt();
    if (idx < minIdx || idx > maxIdx) {
        LOG("API", "!!! %s: indice %d fora da faixa [%d..%d] -> 400", api, idx, minIdx, maxIdx);
        char response[96];
        snprintf(response, sizeof(response), "{\"error\":\"Invalid position %d (expected %d..%d)\"}", idx, minIdx, maxIdx);
        serverWeb.send(400, "application/json", response);
        return false;
    }

    colorStr = serverWeb.arg(1);
    color = hexStringToColor(colorStr.c_str());
    return true;
}

void logHealth(uint32_t now) {
    uint32_t heap = ESP.getFreeHeap();
    if (heap < minFreeHeap) minFreeHeap = heap;

    LOG("HEALTH", "uptime=%lus loops=%u (%.0f/s) maiorGapLoop=%ums em %s loopsLentos=%u",
        now / 1000, loopCount, loopCount * 1000.0 / HEALTH_INTERVAL_MS, maxLoopGapMs, checkpointName(maxLoopGapCp), slowLoopCount);
    LOG("HEALTH", "heap=%u minHeap=%u maiorBloco=%u frag=%u%% stack=%u",
        heap, minFreeHeap, ESP.getMaxFreeBlockSize(), ESP.getHeapFragmentation(), ESP.getFreeContStack());
    LOG("HEALTH", "wifi=%s rssi=%d ip=%s quedasWifi=%u reqsHTTP=%u reqsLog=%u",
        wifiStatusName(WiFi.status()), WiFi.RSSI(), WiFi.localIP().toString().c_str(), wifiDisconnectCount, apiRequestCount, getLogsCount);
    LOG("HEALTH", "show(): clock=%u vezes/%ums  deco=%u vezes/%ums (tempo com interrupcoes desligadas)",
        showClockCount, showClockTotalMs, showDecoCount, showDecoTotalMs);
    LOG("HEALTH", "hora=%02d:%02d %02d/%02d/%04d temp=%d umid=%d chuva=%d ldrBrilho=%d noturno=%d alarmeTocando=%d modo=%d",
        dadosLedClockRuntimeData.time.hour, dadosLedClockRuntimeData.time.minute,
        dadosLedClockRuntimeData.date.day, dadosLedClockRuntimeData.date.month, dadosLedClockRuntimeData.date.year,
        dadosLedClockRuntimeData.temperature, dadosLedClockRuntimeData.humidity, dadosLedClockRuntimeData.umbrellaAlarm,
        dadosLedClockRuntimeData.brightValue, nightModeEnable(), isAlarmRinging, timeToChangeMode);

    if (heap < 8000) LOG("HEALTH", "!!! HEAP BAIXO (%u bytes) - risco de falha de alocacao/crash", heap);
    if (ESP.getHeapFragmentation() > 50) LOG("HEALTH", "!!! FRAGMENTACAO ALTA (%u%%)", ESP.getHeapFragmentation());

    loopCount = 0;
    maxLoopGapMs = 0;
    maxLoopGapCp = CP_NONE;
    slowLoopCount = 0;
    showClockCount = showDecoCount = 0;
    showClockTotalMs = showDecoTotalMs = 0;
}

// Wrappers de show() com medição (show() desliga interrupções: ~7.6ms para 252 LEDs)
void showClock() {
    CP(CP_SHOW_CLOCK);
    uint32_t t0 = millis();
    stripClock.show();
    uint32_t dt = millis() - t0;
    showClockCount++;
    showClockTotalMs += dt;
    if (dt >= SLOW_OP_MS) LOG("LED", "LENTO: stripClock.show() levou %u ms", dt);
}

void showDeco() {
    CP(CP_SHOW_DECO);
    uint32_t t0 = millis();
    stripDeco.show();
    uint32_t dt = millis() - t0;
    showDecoCount++;
    showDecoTotalMs += dt;
    if (dt >= SLOW_OP_MS) LOG("LED", "LENTO: stripDeco.show() levou %u ms", dt);
}

// --------------------------------------------------------------------------------
// --------------------------------- EVENTOS WIFI ---------------------------------
// --------------------------------------------------------------------------------

void onConnected(const WiFiEventStationModeConnected& event) {
    LOG("WIFI", "Conectado ao AP '%s' canal %u", event.ssid.c_str(), event.channel);
}

void onDisconnected(const WiFiEventStationModeDisconnected& event) {
    wifiDisconnectCount++;
    LOG("WIFI", "!!! DESCONECTADO de '%s' motivo=%u (total de quedas=%u)", event.ssid.c_str(), event.reason, wifiDisconnectCount);
}

void onGotIP(const WiFiEventStationModeGotIP& event) {
    localIp = WiFi.localIP().toString();
    LOG("WIFI", "IP: %s | Mascara: %s | Gateway: %s | RSSI: %d",
        localIp.c_str(), event.mask.toString().c_str(), event.gw.toString().c_str(), WiFi.RSSI());
}

void onDhcpTimeout() {
    LOG("WIFI", "!!! DHCP timeout");
}

// --------------------------------------------------------------------------------
// ------------------------------ FUNÇÕES UTILITÁRIAS -----------------------------
// --------------------------------------------------------------------------------

void saveConfig() {
    CP(CP_EEPROM_SAVE);
    uint32_t t0 = millis();
    EEPROM.put(0, dadosLedClock);
    bool ok = EEPROM.commit();
    LOG("EEPROM", "Configuracao salva: %s (%lu ms)", ok ? "OK" : "FALHOU", millis() - t0);
}

bool loadConfig() {
    CP(CP_SETUP_EEPROM);
    EEPROM.get(0, dadosLedClock);
    bool ok = (dadosLedClock.magic == CONFIG_MAGIC && dadosLedClock.version == CONFIG_VERSION);
    LOG("EEPROM", "Config lida: magic=0x%08X (esperado 0x%08X) version=%u (esperado %u) -> %s",
        dadosLedClock.magic, CONFIG_MAGIC, dadosLedClock.version, CONFIG_VERSION, ok ? "VALIDA" : "INVALIDA");
    return ok;
}

void setBrightnessModeDefault(){
    dadosLedClock.brightnessMode.clockMode = ON;
    dadosLedClock.brightnessMode.decoMode = ON;
}

void loadConfigurationDefault() {
    LOG("CONFIG", "Carregando configuracao padrao");
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

    // Intervalo no mesmo dia (ex.: 00:00 -> 05:30)
    if (startHourToShow <= endHourToShow) {
        return hourInt >= startHourToShow && hourInt <= endHourToShow;
    }

    // Intervalo que cruza a meia-noite (ex.: 22:00 -> 05:30)
    return hourInt >= startHourToShow || hourInt <= endHourToShow;
}

Time convertToHHMM(String timeStr) {
    Time result{0, 0};
    int separator = timeStr.indexOf(':');
    if (separator < 0) {
        LOG("PARSE", "!!! Horario '%s' sem ':' -> usando 00:00", timeStr.c_str());
        return result;
    }

    result.hour = timeStr.substring(0, separator).toInt();
    result.minute = timeStr.substring(separator + 1).toInt();
    LOG("PARSE", "Horario '%s' -> %02d:%02d", timeStr.c_str(), result.hour, result.minute);
    return result;
}

// --------------------------------------------------------------------------------
// ----------------------------------- API WEB ------------------------------------
// --------------------------------------------------------------------------------
void setClockBrightnessStateApi() {
    logRequest("setClockBrightnessState");
    String state = serverWeb.arg(0);
    state.toUpperCase();

    if (state == "OFF") dadosLedClock.brightnessMode.clockMode = OFF;
    else if (state == "ON") dadosLedClock.brightnessMode.clockMode = ON;
    else dadosLedClock.brightnessMode.clockMode = AUTO;

    LOG("API", "Brilho do relogio -> %s (recebido '%s')", modeName(dadosLedClock.brightnessMode.clockMode), state.c_str());

    String response = "{\"Status\": \"OK\"}";
    serverWeb.send(200, "application/json", response);
    saveConfig();
}

void setAlarmApi() {
    logRequest("setAlarm");
    if (!serverWeb.hasArg("enable") || !serverWeb.hasArg("time")) {
        LOG("API", "setAlarm: parametros faltando -> 400");
        serverWeb.send(400, "application/json", "{\"error\": \"Parâmetros enable e time são obrigatórios\"}");
        return;
    }

    String startTime = serverWeb.arg("time");

    dadosLedClock.alarm.enabled = serverWeb.arg("enable").toInt();
    dadosLedClock.alarm.time = convertToHHMM(startTime);

    LOG("API", "Alarme -> enabled=%d %02d:%02d", dadosLedClock.alarm.enabled,
        dadosLedClock.alarm.time.hour, dadosLedClock.alarm.time.minute);

    char response[120];
    snprintf(response, sizeof(response), "{\"Status\": \"Alarme alterado. Ativo: %d, Hora: %s\"}", dadosLedClock.alarm.enabled, startTime.c_str());

    serverWeb.send(200, "application/json", response);
    saveConfig();
}

void setNightTimeApi() {
    logRequest("setNightTime");
    if (!serverWeb.hasArg("enable") || !serverWeb.hasArg("start") || !serverWeb.hasArg("end")) {
        LOG("API", "setNightTime: parametros faltando -> 400");
        serverWeb.send(400, "text/plain", "Parametros e, start e end são obrigatórios");
        return;
    }

    int enable = serverWeb.arg("enable").toInt();
    String startTime = serverWeb.arg("start");
    String endTime = serverWeb.arg("end");

    dadosLedClock.nightMode.enabled = enable == ON ? ON : OFF;
    dadosLedClock.nightMode.start = convertToHHMM(startTime);
    dadosLedClock.nightMode.end = convertToHHMM(endTime);

    LOG("API", "Modo noturno -> enabled=%d %02d:%02d -> %02d:%02d", dadosLedClock.nightMode.enabled,
        dadosLedClock.nightMode.start.hour, dadosLedClock.nightMode.start.minute,
        dadosLedClock.nightMode.end.hour, dadosLedClock.nightMode.end.minute);
    if (dadosLedClock.nightMode.start.hour * 100 + dadosLedClock.nightMode.start.minute >
        dadosLedClock.nightMode.end.hour * 100 + dadosLedClock.nightMode.end.minute) {
        LOG("API", "Intervalo do modo noturno cruza a meia-noite");
    }

    char response[120];
    snprintf(response, sizeof(response), "{\"Status\": \"Night mode alterado. Ativo: %d, Inicio: %s Hora: %s\"}", enable, startTime.c_str(), endTime.c_str());

    serverWeb.send(200, "application/json", response);
    saveConfig();
}

void setHourColorApi() {
    logRequest("setHourColor");
    int i;
    String colorStr;
    uint32_t color;
    if (!readColorArgs("setHourColor", 1, 4, i, colorStr, color)) return;

    dadosLedClock.clockColor[i - 1] = color;
    LOG("API", "clockColor[%d] = %06X", i - 1, color);

    String response = "{\"Status\" : \"Hour color changed to " + colorStr + " on pos " + String(i) + "\"}";
    serverWeb.send(200, "application/json", response);
    saveConfig();
}

void setDayColorApi() {
    logRequest("setDayColor");
    int i;
    String colorStr;
    uint32_t color;
    if (!readColorArgs("setDayColor", 1, 4, i, colorStr, color)) return;

    dadosLedClock.dayColor[i - 1] = color;
    LOG("API", "dayColor[%d] = %06X", i - 1, color);

    String response = "{\"Status\" : \"Day color changed to " + colorStr + " on pos " + String(i) + "\"}";
    serverWeb.send(200, "application/json", response);
    saveConfig();
}

void setTempColorApi() {
    logRequest("setTempColor");
    int i;
    String colorStr;
    uint32_t color;
    if (!readColorArgs("setTempColor", 1, 4, i, colorStr, color)) return;

    dadosLedClock.tempColor[i - 1] = color;
    LOG("API", "tempColor[%d] = %06X", i - 1, color);

    String response = "{\"Status\" : \"Temperature color changed to " + colorStr + "\"}";
    serverWeb.send(200, "application/json", response);
    saveConfig();
}

void setHumidityColorApi() {
    logRequest("setHumidityColor");
    int i;
    String colorStr;
    uint32_t color;
    if (!readColorArgs("setHumidityColor", 1, 4, i, colorStr, color)) return;

    dadosLedClock.humidityColor[i - 1] = color;
    LOG("API", "humidityColor[%d] = %06X", i - 1, color);

    String response = "{\"Status\" : \"Humidity color changed to " + colorStr + "\"}";
    serverWeb.send(200, "application/json", response);
    saveConfig();
}

void setDecoColorApi() {
    logRequest("setDecoColor");
    int i;
    String colorStr;
    uint32_t color;
    if (!readColorArgs("setDecoColor", 1, 14, i, colorStr, color)) return;

    dadosLedClock.decoColor[i - 1] = color;
    LOG("API", "decoColor[%d] = %06X", i - 1, color);

    String response = "{\"Status\" : \"Decoration color " + String(i) + " changed to " + colorStr + "\"}";
    serverWeb.send(200, "application/json", response);
    saveConfig();
}

void setDecoColorAllApi() {
    logRequest("setDecoColorAll");
    int line;
    String colorStr;
    uint32_t color;
    if (!readColorArgs("setDecoColorAll", 1, 2, line, colorStr, color)) return;

    int idxStart = (line - 1) * 7;
    int idxEnd = idxStart + 7;

    for (int i = idxStart; i < idxEnd; i++) {
        dadosLedClock.decoColor[i] = color;
    }
    LOG("API", "decoColor[%d..%d] = %06X", idxStart, idxEnd - 1, color);

    char response[120];
    snprintf(response, sizeof(response), "{\"status\":\"Decoration color line %d changed to %s\"}", line, colorStr.c_str());
    serverWeb.send(200, "application/json", response);
    saveConfig();
}

void getInfoApi() {
    logRequest("getInfo");
    String json = getConfigClock();
    LOG("API", "getInfo: JSON com %u bytes", json.length());
    serverWeb.send(200, "application/json", json);
}

void streamFileLogged(const char* path, const char* contentType) {
    bool exists = LittleFS.exists(path);
    LOG("FS", "Servindo %s (existe=%d)", path, exists);
    if (!exists) LOG("FS", "!!! %s nao existe no LittleFS (faltou 'Upload Filesystem Image'?)", path);
    CP(CP_API_STREAM_FILE);
    uint32_t t0 = millis();
    File file = LittleFS.open(path, "r");
    if (!file) LOG("FS", "!!! Falha ao abrir %s", path);

    // streamFile() usa o timeout do ARQUIVO (padrão 1000 ms) como limite para o envio TCP.
    // Uma retransmissão no WiFi já passa de 1 s e o envio é cortado no meio, mas o
    // Content-Length já foi enviado -> navegador acusa ERR_CONTENT_LENGTH_MISMATCH.
    file.setTimeout(FILE_SEND_TIMEOUT_MS);

    size_t total = file ? file.size() : 0;
    size_t sent = serverWeb.streamFile(file, contentType);
    uint32_t dt = millis() - t0;
    if (sent != total) {
        LOG("FS", "!!! TRANSFERENCIA INCOMPLETA de %s: %u de %u bytes em %lu ms (cliente desconectou ou timeout) heap=%u",
            path, sent, total, dt, ESP.getFreeHeap());
    } else {
        LOG("FS", "%s: %u bytes enviados em %lu ms", path, sent, dt);
    }
    file.close();
}

void getIndex() {
    logRequest("getIndex");
    if (LittleFS.exists("/index.html")) {
        streamFileLogged("/index.html", "text/html");
    } else {
        LOG("FS", "!!! /index.html nao encontrado -> 404");
        serverWeb.send(404, "text/plain", "index nao encontrado");
    }
}

void getCss() {
    logRequest("getCss");
    streamFileLogged("/style.css", "text/css");
}

void getJs() {
    logRequest("getJs");
    streamFileLogged("/app.js", "application/javascript");
}

// Acrescenta uma string em formato JSON (com aspas e escapes) ao final de out
void appendJsonString(String& out, const char* s) {
    out += '"';
    for (; *s; s++) {
        char c = *s;
        if (c == '"' || c == '\\') {
            out += '\\';
            out += c;
        } else if ((uint8_t)c < 0x20) {
            out += ' ';   // caracteres de controle (\n, \r, \t...) viram espaço
        } else {
            out += c;
        }
    }
    out += '"';
}

// GET /getLogs?since=N
// Retorna as linhas do buffer de log com número sequencial > N (since=0 ou ausente -> todas).
// Resposta (JSON, enviada em pedaços para não alocar 8 KB de uma vez):
//   { "seq": última linha, "first": mais antiga disponível, "uptime": s, "heap": bytes,
//     "boot": nº do boot, "bootInfo": "...", "lines": ["...", ...] }
// Esta rota NÃO passa por logRequest(): a interface consulta a cada poucos segundos
// e isso encheria o próprio buffer de log com as requisições de log.

void getLogsApi() {
    getLogsCount++;

    uint32_t since = 0;
    if (serverWeb.hasArg("since")) since = strtoul(serverWeb.arg("since").c_str(), nullptr, 10);

    const uint32_t last = logSeq;
    const uint32_t first = last >= LOG_BUFFER_LINES ? last - LOG_BUFFER_LINES + 1 : 1;
    if (since > last) since = 0;  // dispositivo reiniciou desde a última consulta
    const uint32_t start = since + 1 > first ? since + 1 : first;

    serverWeb.setContentLength(CONTENT_LENGTH_UNKNOWN);
    serverWeb.send(200, "application/json", "");

    String chunk;
    chunk.reserve(1200);
    chunk = "{\"seq\":";
    chunk += last;
    chunk += ",\"first\":";
    chunk += first;
    chunk += ",\"uptime\":";
    chunk += millis() / 1000;
    chunk += ",\"heap\":";
    chunk += ESP.getFreeHeap();
    chunk += ",\"boot\":";
    chunk += breadcrumb.bootCount;
    chunk += ",\"bootInfo\":";
    appendJsonString(chunk, bootSummary);
    chunk += ",\"lines\":[";

    bool firstItem = true;
    char line[LOG_LINE_LEN];
    for (uint32_t s = start; s <= last; s++) {
        // Linha pode ter sido sobrescrita por um log gerado durante o envio (ex.: evento de WiFi)
        if (logSeq - s >= LOG_BUFFER_LINES) continue;
        memcpy(line, logBuffer[s % LOG_BUFFER_LINES], LOG_LINE_LEN);
        line[LOG_LINE_LEN - 1] = '\0';

        if (!firstItem) chunk += ',';
        firstItem = false;
        appendJsonString(chunk, line);

        if (chunk.length() > 1000) {
            serverWeb.sendContent(chunk);
            chunk = "";
        }
    }
    chunk += "]}";
    serverWeb.sendContent(chunk);
    serverWeb.sendContent("");  // finaliza a resposta chunked
}

void notFoundApi() {
    logRequest("notFound");
    LOG("HTTP", "404 para %s", serverWeb.uri().c_str());
    serverWeb.send(404, "text/plain", "Not found: " + serverWeb.uri());
}

String getConfigClock() {
    CP(CP_API_GETINFO_JSON);
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

    if (doc.overflowed()) LOG("JSON", "!!! JsonDocument de getInfo estourou (sem memoria)");

    String output;
    serializeJson(doc, output);
    return output;
}

void setDecoBrightnessStateApi() {
    logRequest("setDecoBrightnessState");
    String state = serverWeb.arg(0);
    state.toUpperCase();

    if (state == "OFF") dadosLedClock.brightnessMode.decoMode = OFF;
    else if (state == "ON") dadosLedClock.brightnessMode.decoMode = ON;
    else dadosLedClock.brightnessMode.decoMode = AUTO;

    LOG("API", "Brilho da decoracao -> %s (recebido '%s')", modeName(dadosLedClock.brightnessMode.decoMode), state.c_str());

    String response = "{\"Status\" : \"OK\"}";
    serverWeb.send(200, "application/json", response);
    saveConfig();
}

// --------------------------------------------------------------------------------
// --------------------------- LEITURA DE SENSORES/DATA ---------------------------
// --------------------------------------------------------------------------------

void readThebrightnessValue() {
    CP(CP_READ_LDR);
    int valueReadFromSensor = analogRead(A0);
    dadosLedClockRuntimeData.brightnessSensorMap[currentReadIndexLdr] = valueReadFromSensor;
    currentReadIndexLdr = (currentReadIndexLdr + 1) % NUM_READINGS_LRD;

    int sumBrightness = 0;
    for (int i = 0; i < NUM_READINGS_LRD; i++) {
        sumBrightness += dadosLedClockRuntimeData.brightnessSensorMap[i];
    }

    int lightSensorValue = sumBrightness / NUM_READINGS_LRD;
    int previous = dadosLedClockRuntimeData.brightValue;
    dadosLedClockRuntimeData.brightValue = map(lightSensorValue, 0, 1023, 200, 1);

    if (abs(dadosLedClockRuntimeData.brightValue - previous) >= 10) {
        LOG("LDR", "Brilho calculado mudou: %d -> %d (leitura=%d media=%d)",
            previous, dadosLedClockRuntimeData.brightValue, valueReadFromSensor, lightSensorValue);
    }
}

void readTheTime() {
    CP(CP_READ_TIME);
    time_t now = time(nullptr);
    struct tm *ptm = localtime(&now);
    if (ptm == nullptr) {
        LOG("TIME", "!!! localtime() retornou NULL (now=%ld)", (long)now);
        return;
    }

    dadosLedClockRuntimeData.time.hour = ptm->tm_hour;
    dadosLedClockRuntimeData.time.minute = ptm->tm_min;
    dadosLedClockRuntimeData.date.day = ptm->tm_mday;
    dadosLedClockRuntimeData.date.month = ptm->tm_mon + 1;
    dadosLedClockRuntimeData.date.year = ptm->tm_year + 1900;

    bool synced = dadosLedClockRuntimeData.date.year >= 2020;
    if (synced != timeSynced) {
        timeSynced = synced;
        if (synced) {
            LOG("TIME", "Hora sincronizada via NTP: %02d:%02d:%02d %02d/%02d/%04d",
                ptm->tm_hour, ptm->tm_min, ptm->tm_sec, ptm->tm_mday, ptm->tm_mon + 1, ptm->tm_year + 1900);
        } else {
            LOG("TIME", "!!! Hora deixou de ser valida: %02d:%02d:%02d %02d/%02d/%04d",
                ptm->tm_hour, ptm->tm_min, ptm->tm_sec, ptm->tm_mday, ptm->tm_mon + 1, ptm->tm_year + 1900);
        }
    }

    if (dadosLedClockRuntimeData.time.minute != lastLoggedMinute) {
        lastLoggedMinute = dadosLedClockRuntimeData.time.minute;
        LOG("TIME", "Hora: %02d:%02d:%02d %02d/%02d/%04d%s",
            ptm->tm_hour, ptm->tm_min, ptm->tm_sec, ptm->tm_mday, ptm->tm_mon + 1, ptm->tm_year + 1900,
            synced ? "" : " (AINDA NAO SINCRONIZADA - NTP pendente)");
    }

    // Reseta a trava do alarme quando sair do minuto configurado
    if (dadosLedClockRuntimeData.time.minute != dadosLedClock.alarm.time.minute) {
        if (alarmTriggeredThisMinute) LOG("ALARM", "Trava do alarme liberada (saiu do minuto do alarme)");
        alarmTriggeredThisMinute = false;
    }
}

void readTheTemperature() {
    WiFiClient client;
    HTTPClient http;

    bool lerTemperatura = temperaturePending || dadosLedClockRuntimeData.time.minute % 59 == 0;
    if (!lerTemperatura) {
        LOG("TEMP", "Leitura de temperatura pulada (minuto=%d, temp atual=%d)",
            dadosLedClockRuntimeData.time.minute, dadosLedClockRuntimeData.temperature);
        return;
    }

    LOG("TEMP", "Iniciando leitura da temperatura (pendente=%d wifi=%s heap=%u)",
        temperaturePending, wifiStatusName(WiFi.status()), ESP.getFreeHeap());
    uint32_t t0 = millis();

    // Até que a leitura dê certo, a próxima chamada tenta de novo (mantém o último valor válido)
    temperaturePending = true;

    CP(CP_READ_TEMP_BEGIN);
    if (http.begin(client, urlTemp)) {
        LOG("TEMP", "http.begin OK, executando GET...");
        CP(CP_READ_TEMP_GET);
        uint32_t tGet = millis();
        int httpCode = http.GET();
        LOG("TEMP", "GET retornou %d (%s) em %lu ms", httpCode,
            httpCode < 0 ? http.errorToString(httpCode).c_str() : "HTTP", millis() - tGet);

        if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_MOVED_PERMANENTLY) {
            CP(CP_READ_TEMP_PAYLOAD);
            uint32_t tPay = millis();
            String payload = http.getString();
            LOG("TEMP", "Payload: %u bytes em %lu ms, heap=%u", payload.length(), millis() - tPay, ESP.getFreeHeap());
            LOG("TEMP", "Payload: %s", payload.c_str());

            CP(CP_READ_TEMP_PARSE);
            DynamicJsonDocument doc(1024);
            DeserializationError error = deserializeJson(doc, payload);

            if (!error) {
                dadosLedClockRuntimeData.temperature = doc["temp"] | 0;
                dadosLedClockRuntimeData.humidity = doc["humidity"] | 0;
                temperaturePending = false;
                LOG("TEMP", "Temperatura lida: %d", dadosLedClockRuntimeData.temperature);
                LOG("TEMP", "Umidade lida: %d", dadosLedClockRuntimeData.humidity);

                // Lógica de Alerta de Guarda-Chuva baseada no condition_slug da API
                if (doc.containsKey("condition_slug")) {
                    String cond = (const char*)doc["condition_slug"];
                    dadosLedClockRuntimeData.umbrellaAlarm = OFF;
                    if (cond == "rain" || cond == "storm") {
                        dadosLedClockRuntimeData.umbrellaAlarm = ON;
                    }
                    LOG("TEMP", "Condicao='%s' -> alerta de chuva=%d", cond.c_str(), dadosLedClockRuntimeData.umbrellaAlarm);
                } else {
                    LOG("TEMP", "Resposta sem 'condition_slug'");
                }
            } else {
                LOG("TEMP", "!!! Erro ao interpretar JSON: %s", error.c_str());
            }
        } else {
            LOG("TEMP", "!!! Codigo HTTP inesperado: %d", httpCode);
        }
        CP(CP_READ_TEMP_END);
        http.end();
    } else {
        LOG("TEMP", "!!! http.begin falhou");
    }
    LOG("TEMP", "Leitura de temperatura finalizada em %lu ms (%s)", millis() - t0,
        temperaturePending ? "FALHOU - nova tentativa no proximo ciclo" : "OK");
}

// --------------------------------------------------------------------------------
// --------------------------- RENDERIZAÇÃO DOS DISPLAYS --------------------------
// --------------------------------------------------------------------------------

void displayInfo() {
    CP(CP_OLED_UPDATE);
    uint32_t t0 = millis();
    display.clearDisplay();
    display.setTextSize(2);
    display.setCursor(0, 0);
    display.println(" Led Clock");
    display.println(localIp);
    display.display();
    uint32_t dt = millis() - t0;
    if (dt >= SLOW_OP_MS) LOG("OLED", "LENTO: atualizacao do OLED levou %lu ms (I2C travando?)", dt);
}

void displayTheDay() {
    CP(CP_DISPLAY_DAY);
    int tensDay, unitsDay, tensMonth, unitsMonth;
    getDigits(dadosLedClockRuntimeData.date.day, tensDay, unitsDay);
    getDigits(dadosLedClockRuntimeData.date.month, tensMonth, unitsMonth);
    LOG("DISP", "Exibindo data %02d/%02d", dadosLedClockRuntimeData.date.day, dadosLedClockRuntimeData.date.month);

    stripClock.clear();
    displayNumber(tensDay, IDX_FIRST_DIGIT, dadosLedClock.dayColor[0]);
    displayNumber(unitsDay, IDX_SECOND_DIGIT, dadosLedClock.dayColor[1]);
    displayNumber(tensMonth, IDX_THIRD_DIGIT, dadosLedClock.dayColor[2]);
    displayNumber(unitsMonth, IDX_FOURTH_DIGIT, dadosLedClock.dayColor[3]);
}

void displayTheTime() {
    CP(CP_DISPLAY_TIME);
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
    CP(CP_DISPLAY_HUMIDITY);
    int tens, units;
    getDigits(dadosLedClockRuntimeData.humidity, tens, units);
    LOG("DISP", "Exibindo umidade %d", dadosLedClockRuntimeData.humidity);
    stripClock.clear();

    displayCharacterMask(IDX_FIRST_DIGIT, dadosLedClock.humidityColor[0], 0x5D);
    displayCharacterMask(IDX_SECOND_DIGIT, dadosLedClock.humidityColor[1], 0x5D);
    displayNumber(tens, IDX_THIRD_DIGIT, dadosLedClock.humidityColor[2]);
    displayNumber(units, IDX_FOURTH_DIGIT, dadosLedClock.humidityColor[3]);
}

void displayTheTemperature() {
    CP(CP_DISPLAY_TEMP);
    int tens, units;
    getDigits(dadosLedClockRuntimeData.temperature, tens, units);
    LOG("DISP", "Exibindo temperatura %d", dadosLedClockRuntimeData.temperature);
    stripClock.clear();

    displayNumber(tens, IDX_FIRST_DIGIT, dadosLedClock.tempColor[0]);
    displayNumber(units, IDX_SECOND_DIGIT, dadosLedClock.tempColor[1]);
    displayCharacterMask(IDX_THIRD_DIGIT, dadosLedClock.tempColor[2], 0x0F);
    displayCharacterMask(IDX_FOURTH_DIGIT, dadosLedClock.tempColor[3], 0x66);
}

void getDigits(int value, int &tens, int &units) {
    if (value < 0 || value > 99) LOG("DISP", "AVISO: valor %d fora de 0..99, sera limitado", value);
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
    } else {
        LOG("DISP", "!!! Digito invalido %d no offset %d", digitToDisplay, offsetBy);
    }
}

// --------------------------------------------------------------------------------
// --------------------------- CONTROLO DO ALARME ---------------------------------
// --------------------------------------------------------------------------------

void checkAlarmTrigger() {
    CP(CP_ALARM_CHECK);
    if (dadosLedClock.alarm.enabled == 1 && !alarmTriggeredThisMinute && !isAlarmRinging) {
        if (dadosLedClockRuntimeData.time.hour == dadosLedClock.alarm.time.hour &&
            dadosLedClockRuntimeData.time.minute == dadosLedClock.alarm.time.minute) {

            isAlarmRinging = true;
            alarmTriggeredThisMinute = true;
            alarmStartTimeMs = millis();
            lastAlarmBlinkMs = 0;
            alarmBlinkState = false;
            LOG("ALARM", "ALARME DISPARADO! (%02d:%02d)", dadosLedClock.alarm.time.hour, dadosLedClock.alarm.time.minute);
        }
    }
}

void handleAlarmRinging() {
    CP(CP_ALARM_RINGING);
    uint32_t now = millis();

    // Desliga após 10 segundos
    if (now - alarmStartTimeMs >= 10000) {
        isAlarmRinging = false;
        noTone(BUZZER_PIN);
        LOG("ALARM", "Alarme finalizado apos %lu ms", now - alarmStartTimeMs);
        return;
    }

    // Pisca os dígitos e toca o som a cada 300ms para um efeito mais dinâmico
    if (now - lastAlarmBlinkMs >= 300) {
        lastAlarmBlinkMs = now;
        alarmBlinkState = !alarmBlinkState;

        if (alarmBlinkState) {
            stripClock.setBrightness(100); // Força brilho alto para alertar (antes de desenhar)
            readTheTime();
            displayTheTime(); // Mostra a hora atualizada
            showClock();
            tone(BUZZER_PIN, 1800); // Toca o som (1800Hz)
        } else {
            stripClock.clear(); // Apaga os dígitos
            showClock();
            noTone(BUZZER_PIN); // Pausa o som entre os bips
        }
    }
}

// --------------------------------------------------------------------------------
// ------------------------------------ SETUP -------------------------------------
// --------------------------------------------------------------------------------

void setup() {
    Serial.begin(115200);
    Wire.begin(OLED_SDA, OLED_SCL);
    // true = imprime também mensagens internas do SDK (WiFi, DHCP, etc.)
    Serial.setDebugOutput(true);
    delay(3000);

    logBootInfo();
    CP(CP_SETUP);
    LOG("SETUP", "Wire iniciado (SDA=%u SCL=%u)", OLED_SDA, OLED_SCL);

    // Configuração do pino do Buzzer
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);
    LOG("SETUP", "Buzzer configurado no pino %u", BUZZER_PIN);

    CP(CP_SETUP_EEPROM);
    EEPROM.begin(sizeof(Config));
    LOG("SETUP", "EEPROM iniciada com %u bytes", (unsigned)sizeof(Config));

    if (!loadConfig()) {
        LOG("SETUP", "Primeira execucao ou versao invalida.");
        loadConfigurationDefault();
    }
    LOG("SETUP", "Configuracao carregada.");
    logConfig("Configuracao em uso");

    CP(CP_SETUP_OLED);
    oledOk = display.begin(SSD1306_SWITCHCAPVCC,  0x3C);
    if (!oledOk) {
        LOG("SETUP", "!!! SSD1306 falhou na alocacao (display.begin retornou false) - chamadas ao display podem crashar");
    } else {
        LOG("SETUP", "OLED SSD1306 iniciado");
    }
    Wire.beginTransmission(0x3C);
    uint8_t i2cErr = Wire.endTransmission();
    LOG("SETUP", "Teste I2C no endereco 0x3C: %s (codigo %u)", i2cErr == 0 ? "RESPONDEU" : "SEM RESPOSTA", i2cErr);
    logHeap("apos OLED");

    display.display();
    delay(2000);
    display.setTextColor(SSD1306_WHITE);

    LOG("SETUP", "Conectando ao WiFi '%s'...", ssid);
    WiFi.mode(WIFI_STA);
    // Desliga a economia de energia do WiFi (modem sleep): reduz a latência das respostas
    // do servidor web e evita envios TCP travando. O relógio é ligado na tomada.
    WiFi.setSleepMode(WIFI_NONE_SLEEP);
    LOG("SETUP", "WiFi sleep mode: NONE");
    WiFi.begin(ssid, passPhrase);
    WiFi.hostname("WIFI-Clock");

    static WiFiEventHandler onConnectedHandler = WiFi.onStationModeConnected(onConnected);
    static WiFiEventHandler onDisconnectedHandler = WiFi.onStationModeDisconnected(onDisconnected);
    static WiFiEventHandler onGotIPHandler = WiFi.onStationModeGotIP(onGotIP);
    static WiFiEventHandler onDhcpTimeoutHandler = WiFi.onStationModeDHCPTimeout(onDhcpTimeout);

    CP(CP_SETUP_WIFI_WAIT);
    uint32_t wifiStart = millis();
    uint32_t tentativas = 0;
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        tentativas++;
        if (tentativas % 10 == 0) {
            LOG("SETUP", "Aguardando WiFi... %lu s, status=%s", (millis() - wifiStart) / 1000, wifiStatusName(WiFi.status()));
        }
    }
    LOG("SETUP", "WiFi conectado em %lu ms, IP=%s RSSI=%d", millis() - wifiStart, WiFi.localIP().toString().c_str(), WiFi.RSSI());

    configTime(-3 * 3600, 0, "br.pool.ntp.org");
    LOG("SETUP", "configTime chamado (NTP br.pool.ntp.org, UTC-3)");

    CP(CP_SETUP_FS);
    bool fsOk = LittleFS.begin();
    LOG("SETUP", "LittleFS.begin: %s", fsOk ? "OK" : "FALHOU");
    if (fsOk) {
        FSInfo fsInfo;
        LittleFS.info(fsInfo);
        LOG("SETUP", "LittleFS: total=%u usado=%u", fsInfo.totalBytes, fsInfo.usedBytes);
        Dir dir = LittleFS.openDir("/");
        while (dir.next()) {
            LOG("SETUP", "   arquivo: %s (%u bytes)", dir.fileName().c_str(), dir.fileSize());
        }
    }
    timeClient.begin();

    CP(CP_SETUP_SERVER);
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
    serverWeb.on("/getLogs", HTTP_GET, getLogsApi);
    serverWeb.onNotFound(notFoundApi);

    serverWeb.enableCORS(true);
    serverWeb.begin();
    LOG("SETUP", "Servidor web iniciado na porta 80");

    CP(CP_SETUP_STRIPS);
    stripClock.begin();
    //stripClock.setBrightness(BRIGHT_DEFAULT_VALUE);
    //stripClock.fill(BRANCO);
    //stripClock.show();


    stripDeco.begin();
    //stripDeco.setBrightness(BRIGHT_DEFAULT_VALUE);
    //stripDeco.fill(BRANCO);
    //stripDeco.show();
    LOG("SETUP", "Fitas de LED iniciadas: clock=%u LEDs (D7) deco=%u LEDs (D8)", LED_CLOCK_COUNT, LED_DECO_COUNT);

    timeToChangeMode = 0;

    inicializando = true;
    logHeap("fim do setup");
    LOG("SETUP", "Setup concluido em %lu ms", millis());
    lastHealthMs = millis();
    lastLoopEntryMs = millis();
}

// --------------------------------------------------------------------------------
// ------------------------------------- LOOP -------------------------------------
// --------------------------------------------------------------------------------

void loop() {
    uint32_t now = millis();

    // ---- Diagnóstico: tempo entre duas entradas no loop() ----
    // O checkpoint atual ainda é o da iteração anterior -> diz onde o tempo foi gasto
    uint32_t gap = now - lastLoopEntryMs;
    lastLoopEntryMs = now;
    loopCount++;
    if (gap > maxLoopGapMs) {
        maxLoopGapMs = gap;
        maxLoopGapCp = currentCheckpoint;
    }
    if (gap >= SLOW_LOOP_MS && !inicializando) {
        slowLoopCount++;
        LOG("LOOP", "LOOP LENTO: %lu ms desde a ultima iteracao (ultimo checkpoint: %s)", gap, checkpointName(currentCheckpoint));
    }
    if (now - lastHealthMs >= HEALTH_INTERVAL_MS) {
        lastHealthMs = now;
        logHealth(now);
    }

    CP(CP_LOOP_START);

    if (!WiFi.isConnected()) {
        CP(CP_LOOP_WIFI_DOWN);
        LOG("LOOP", "Aguardando WiFi... status=%s", wifiStatusName(WiFi.status()));
        delay(1000);
        return;
    }

    CP(CP_HANDLE_CLIENT);
    TIMED("HTTP", "serverWeb.handleClient()", serverWeb.handleClient());
    now = millis();

    if(inicializando){
        CP(CP_INIT_ANIMATION);
        LOG("LOOP", "Animacao de inicializacao: inicio");
        uint32_t t0 = millis();
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
        LOG("LOOP", "Animacao de inicializacao: fim (%lu ms)", millis() - t0);
        lastLoopEntryMs = millis();
    }

    // Prioridade Máxima 1: Executa a animação e o som do alarme se estiver ativo
    if (isAlarmRinging) {
        handleAlarmRinging();
        return; // Bloqueia o restante das animações durante o alarme
    }

    // Verificação contínua se o alarme deve disparar
    checkAlarmTrigger();

    // ---- Diagnóstico: transições de estado ----
    bool nightNow = nightModeEnable();
    if (nightNow != lastNightModeState) {
        lastNightModeState = nightNow;
        LOG("MODE", "Modo noturno %s as %02d:%02d", nightNow ? "ATIVADO" : "DESATIVADO",
            dadosLedClockRuntimeData.time.hour, dadosLedClockRuntimeData.time.minute);
        if (nightNow) {
            // Entrou no modo noturno: apaga a fita do relógio uma única vez
            stripClock.setBrightness(0);
            showClock();
        } else {
            // Saiu do modo noturno: setBrightness(0) apaga o buffer de pixels,
            // então redesenha a hora imediatamente (senão fica apagado até o próximo modo).
            // O brilho precisa ser restaurado ANTES de desenhar: pixels gravados com brilho 0 ficam pretos.
            // O brilho correto do modo (ON/OFF/AUTO) é aplicado no próximo tick de 1 s.
            stripClock.setBrightness(BRIGHT_DEFAULT_VALUE);
            readTheTime();
            displayTheTime();
        }
    }
    bool umbrellaNow = dadosLedClockRuntimeData.umbrellaAlarm == ON && !nightNow;
    if (umbrellaNow != lastUmbrellaState) {
        lastUmbrellaState = umbrellaNow;
        LOG("MODE", "Animacao de alerta de chuva %s", umbrellaNow ? "ATIVADA" : "DESATIVADA");
    }

    // ============================================================================
    // ANIMAÇÃO FLUIDA DE ALERTA DE CHUVA (Roda a cada 30ms se ativo fora da noite)
    // ============================================================================
    if (dadosLedClockRuntimeData.umbrellaAlarm == ON && !nightModeEnable()) {
        if (now - lastUmbrellaMs >= 30) {
            CP(CP_UMBRELLA_ANIM);
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

            showDeco();
        }
    }

    // Animação de respiração noturna
    if (nightModeEnable()) {
        CP(CP_NIGHT_MODE);

        if (now - lastBreathMs >= BREATH_INTERVAL_MS) {
            lastBreathMs = now;
            float angle = now / 1500.0;
            float pulseRatio = (sin(angle) + 1.0) / 2.0;
            uint8_t currentBright = BREATH_MIN_BRIGHT + (pulseRatio * (BREATH_MAX_BRIGHT - BREATH_MIN_BRIGHT));

            stripDeco.setBrightness(currentBright);
            for (int i = 0; i < LED_DECO_COUNT; i++) {
                stripDeco.setPixelColor(i, dadosLedClock.decoColor[i]);
            }
            showDeco();
        }
    }

    // Execução regular do Relógio (1 em 1 segundo)
    if (now - lastSecondMs >= 1000) {
        CP(CP_SECOND_TICK);
        uint32_t tickStart = millis();
        lastSecondMs = now;
        timeToChangeMode++;

        if (!nightModeEnable()) {
            switch (timeToChangeMode) {
                case TIME_TO_DISPLAY_CLOCK:
                    LOG("DISP", "Modo: RELOGIO");
                    readTheTime();
                    displayTheTime();
                    break;
                case TIME_TO_DISPLAY_DAY:
                    LOG("DISP", "Modo: DATA");
                    displayTheDay();
                    break;
                case TIME_TO_DISPLAY_TEMPERATURE:
                    LOG("DISP", "Modo: TEMPERATURA");
                    TIMED("TEMP", "readTheTemperature()", readTheTemperature());
                    displayTheTemperature();
                    break;
                case TIME_TO_DISPLAY_HUMIDITY:
                    LOG("DISP", "Modo: UMIDADE");
                    displayTheHumidity();
                    break;
            }

            readThebrightnessValue();

            switch (dadosLedClock.brightnessMode.decoMode) {
                case OFF:  stripDeco.setBrightness(0); break;
                case ON:   stripDeco.setBrightness(BRIGHT_DEFAULT_VALUE); break;
                case AUTO:  stripDeco.setBrightness(dadosLedClockRuntimeData.brightValue); break;
                default: LOG("LED", "!!! decoMode invalido: %d", dadosLedClock.brightnessMode.decoMode); break;
            }

            switch (dadosLedClock.brightnessMode.clockMode) {
                case OFF:  stripClock.setBrightness(0); break;
                case ON:   stripClock.setBrightness(BRIGHT_DEFAULT_VALUE); break;
                case AUTO: stripClock.setBrightness(dadosLedClockRuntimeData.brightValue); break;
                default: LOG("LED", "!!! clockMode invalido: %d", dadosLedClock.brightnessMode.clockMode); break;
            }

            int clockBright = stripClock.getBrightness();
            int decoBright = stripDeco.getBrightness();
            if (clockBright != lastClockBrightApplied || decoBright != lastDecoBrightApplied) {
                LOG("LED", "Brilho aplicado: clock=%d (%s) deco=%d (%s)",
                    clockBright, modeName(dadosLedClock.brightnessMode.clockMode),
                    decoBright, modeName(dadosLedClock.brightnessMode.decoMode));
                lastClockBrightApplied = clockBright;
                lastDecoBrightApplied = decoBright;
            }

            for (int i = 0; i < LED_DECO_COUNT; i++) {
                stripDeco.setPixelColor(i, dadosLedClock.decoColor[i]);
            }

            showClock();
            showDeco();
        } else {
            // Garante que a hora continua a ser atualizada internamente mesmo no modo noturno
            readTheTime();

            // Reforça a fita do relógio apagada 1x por segundo (ex.: após o alarme tocar de madrugada)
            stripClock.setBrightness(0);
            showClock();
        }

        if (timeToChangeMode >= 60) {
            LOG("DISP", "Ciclo de 60 s concluido, reiniciando contador");
            timeToChangeMode = 0;
        }

        if (!oledOk) {
            static bool avisado = false;
            if (!avisado) { avisado = true; LOG("OLED", "AVISO: OLED nao iniciado, mas displayInfo() continua sendo chamado (comportamento original)"); }
        }
        displayInfo();

        uint32_t tickDt = millis() - tickStart;
        if (tickDt >= 100) LOG("LOOP", "LENTO: tick de 1 s levou %lu ms (modo=%d)", tickDt, timeToChangeMode);
    }

    CP(CP_LOOP_END);
}
