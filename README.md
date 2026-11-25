# LED-ClockShelf
This project is based on the project available at https://www.diymachines.co.uk/how-to-build-a-giant-hidden-shelf-edge-clock

Code base for a completely customizable and configurable LED clock using WS2812b RGB LEDs.

 <img src=Images/preview1.jpg width="600" /><br/>
 
 <img src=Images/preview2.jpg width="600" /><br/>


Web interface to change the properties of clock.

 <img src=Images/Api_Config.jpg width="600" /><br/>

 <img src=Images/Api_Config_OTA.jpg width="600" /><br/>

 <img src=Images/Api_Config_Log.jpg width="600" /><br/>


## Configuração obrigatória: `include/secrets.h`

As credenciais **não ficam no repositório**. Depois de clonar, crie o arquivo `include/secrets.h`
a partir do modelo:

```bash
cp include/secrets.example.h include/secrets.h
```

Edite o `include/secrets.h` e preencha os campos:

| Campo | O que é |
|---|---|
| `WIFI_SSID` | Nome da rede WiFi **2.4 GHz** (o ESP8266 não suporta 5 GHz) |
| `WIFI_PASSWORD` | Senha da rede WiFi |
| `OTA_PASSWORD` | Senha para atualizar firmware/interface pela tela (usuário fixo `admin`) |
| `WEATHER_API_KEY` | Chave da API de clima da [HG Brasil](https://hgbrasil.com/status/weather) |
| `WEATHER_WOEID` | Código da cidade na HG Brasil (temperatura, umidade e alerta de chuva) |

Apague a linha `#define SECRETS_ARE_EXAMPLE 1`, que só existe no modelo.

O `include/secrets.h` está no `.gitignore`. Sem ele o firmware ainda compila (usando o modelo, para
o CI funcionar), mas a compilação mostra o aviso `include/secrets.h NAO ENCONTRADO` e o relógio
não conecta ao WiFi.

## Build

PlatformIO, ambiente `esp12e`:

```bash
pio run -e esp12e              # compila o firmware
pio run -e esp12e -t upload    # grava no dispositivo
pio run -e esp12e -t uploadfs  # grava a interface web (data/) no LittleFS
pio run -e esp12e -t buildfs   # gera o littlefs.bin (para atualização OTA da interface)
```

Depois da primeira gravação pelo USB, as próximas podem ser feitas pela rede, no card
**Atualização OTA** da interface, enviando o `firmware.bin` ou o `littlefs.bin` de `.pio/build/esp12e/`.

## Automações de IA

Duas automações rodam no GitHub Actions. Ambas são Node.js 20 sem dependências externas, e nenhuma
delas aprova ou faz merge de Pull Request.

| Automação | Gatilho | O que faz | Documentação |
|---|---|---|---|
| **Revisão de código** | Pull Request | Revisa o diff e comenta os apontamentos | [`.github/revisao-ia`](.github/revisao-ia/README.md) |
| **Correção de bugs** | Issue com rótulo `bug` | Investiga a causa, corrige em uma branch `automated-error-analysis/...`, compila e abre um Pull Request | [`.github/correcao-ia`](.github/correcao-ia/README.md) |

A correção automatizada só altera código quando encontra a causa no repositório **e** o firmware
compila. Quando não encontra, comenta a investigação na Issue e não altera nada. A `main` nunca é
alterada diretamente, e **todo Pull Request gerado por IA exige revisão humana antes do merge**.

### Secrets necessários

Em `Settings → Secrets and variables → Actions`:

| Secret | Usado por |
|---|---|
| `AZURE_OPENAI_ENDPOINT` | Correção de bugs |
| `AZURE_OPENAI_API_KEY` | Correção de bugs |
| `AZURE_OPENAI_DEPLOYMENT` | Correção de bugs |
| `REVISAO_API_KEY` | Revisão de código |

Também é preciso marcar, em `Settings → Actions → General`, **"Read and write permissions"** e
**"Allow GitHub Actions to create and approve pull requests"**.

Para relatar um bug, use o formulário em `Issues → New issue → Relatar um bug`.

Buy me a coffee to say thanks: https://ko-fi.com/marcoaureliorb
