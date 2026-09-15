# LED-ClockShelf
This project is based on the project available at https://www.diymachines.co.uk/how-to-build-a-giant-hidden-shelf-edge-clock

Code base for a completely customizable and configurable LED clock using WS2812b RGB LEDs.

 <img src=Images/preview1.jpg width="600" /><br/>
 
 <img src=Images/preview2.jpg width="600" /><br/>


Web interface to change the properties of clock.

 <img src=Images/Api_Config.png width="600" /><br/>

## Build

PlatformIO, ambiente `esp12e`:

```bash
pio run -e esp12e              # compila o firmware
pio run -e esp12e -t upload    # grava no dispositivo
pio run -e esp12e -t uploadfs  # grava a interface web (data/) no LittleFS
```

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
