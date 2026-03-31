# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LED-ClockShelf is a DIY LED clock built on an ESP8266 microcontroller driving two WS2812b LED strips:
- **Clock strip** (`LEDCLOCK_PIN D5`): 252 LEDs arranged as four 7-segment digits
- **Decoration strip** (`LEDDECO_PIN D6`): 14 LEDs split into two lines of 7

The device hosts a web interface and REST API over WiFi. The device IP is hardcoded in the web UI as `192.168.100.7`.

## Two Separate UIs

There are **two distinct web interfaces**:

1. **`Firmware/builtinfiles.h`** — The UI that runs *on the ESP8266 itself*, served via `homeHtml` PROGMEM string. This is what users see when they visit the device IP. Changes here must be compiled and flashed.

2. **`WebApi/index.html`** — A standalone modern UI (Bootstrap 5.3, dark theme) for development/preview. Uses Vite as a dev server. Changes here do **not** automatically sync to the firmware.

When fixing UI bugs, confirm which file the user is referring to — they diverge in style and feature set.

## Firmware Build & Flash

The firmware is an Arduino sketch for ESP8266. There is no automated build command — use the **Arduino IDE** or **arduino-cli**:

- Board: `esp8266:esp8266:nodemcuv2`
- Required libraries: `NTPClient`, `Arduino_JSON`, `Adafruit NeoPixel`, `ESP8266WiFi`, `ESP8266WebServer`, `ESP8266HTTPClient`
- Configure WiFi credentials in `Firmware/secrets.h` before flashing

## WebApi Dev Server

```bash
npm install
npm run dev      # Vite dev server
npm run build    # Production build
npm run preview  # Preview production build
```

## Architecture

### Main Loop (non-blocking)
The `loop()` uses `millis()` timers instead of `delay()`:
- Every 1 second: reads time, updates LEDs, handles brightness
- At second 50: displays day/month
- At second 55: fetches temperature (hgbrasil.com API) and displays it
- At second 60: resets the 60-second cycle
- Rainbow mode: independent 20ms timer (~50fps) via `lastRainbowMs`

### Display System
Each digit occupies 63 LEDs (`LEDCLOCK_COUNT / 4`). `displayNumber()` calls digit-specific functions that use `stripClock.fill()` with an `offsetBy` of 0, 63, 126, or 189 for the four digit positions (right to left: second-minute, first-minute, second-hour, first-hour).

Color arrays use 4 elements each — one per digit position:
- `clockColor[4]` — hour/minute digits
- `dayColor[4]` — day/month digits
- `tempColor[4]` — temperature digits

### Color Handling Quirk
The NeoPixel strip is wired in `NEO_RGB` order, but the hardware expects GRB. `colorToInt()` compensates by swapping R and G: `stripClock.Color(color.g, color.r, color.b)`. Keep this in mind when adding new color-related code.

### REST API Endpoints
All endpoints live in `Firmware/Firmware.ino` and are registered in `setup()`:

| Endpoint | Args | Description |
|---|---|---|
| `/getInfo` | — | Returns full config JSON |
| `/getTime` | — | Current time |
| `/getTemperature` | — | Current temperature |
| `/setHourColor` | `p, r, g, b` | Set clock digit color (p=1–4) |
| `/setDayColor` | `p, r, g, b` | Set day/month digit color (p=1–4) |
| `/setTempColor` | `p, r, g, b` | Set temperature digit color (p=1–4) |
| `/setDecoColor` | `p, r, g, b` | Set individual deco LED (p=1–14) |
| `/setDecoColorAll` | `line, r, g, b` | Set all 7 LEDs on a line (line=0 or 1) |
| `/setClockBrightnessState` | `p=ON/OFF/AUTO` | Clock strip brightness mode |
| `/setDecoBrightnessState` | `p1=ON/OFF/AUTO` | Deco strip brightness mode |
| `/setNightTime` | `s=HH:MM, e=HH:MM` | Night mode (both strips off) |
| `/setRainbowMode` | `p=0/1` | Rainbow animation on clock strip |

### Decoration LEDs
- Line 1: positions 1–7 (indices 0–6 in `clockDecoColor[]`, strip pixels 0–6)
- Line 2: positions 8–14 (indices 7–13 in `clockDecoColor[]`, strip pixels 7–13)
- `setDecoColorAll` uses `line=0` for Line 1, `line=1` for Line 2; index range is `[line*7 .. line*7+6]`

### Night Mode
When current time (as `hour*100 + minute`) falls between `startHourToShow` and `endHourToShow`, both strips are forced to brightness 0. Default: 00:00–05:30.
