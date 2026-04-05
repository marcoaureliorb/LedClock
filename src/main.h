#include <cstdint>
#include <StreamString.h>
#include "Utils.h"

void getInfo();
void getTime();
void getTemperature();
void getInfoApi();
void getTimeApi();
void getTemperatureApi();
void setHourColorApi();
void setDayColorApi();
void setTempColorApi();
void setDecoColorApi();
void setDecoColorAllApi();
void setHumidityColorApi();
void setClockBrightnessStateApi();
void setDecoBrightnessStateApi();
void setNightTimeApi();

void setRainbowClockEffects();
void setRainbowDecoEffects();

void readTheTime();
void displayTheTime();
void displayTheDay();
void displayTheTemperature();
void displayTheHumidity();
void readTheTemperature();
void readThebrightnessValue();

String rainbowModeToStr(int mode);
String getConfigClock();
String brightnessModeToStr(int mode);

uint32_t colorToInt(RGB color);
void applyRainbowToLedClock();
void applyRainbowToLedDeco();
uint32_t applyBrightnessToColor(uint32_t color, uint8_t brightness);

void getDigits(int value, int &tens, int &units);

void displayInfo(String texto, String value);

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