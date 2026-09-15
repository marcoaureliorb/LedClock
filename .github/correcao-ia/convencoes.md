# Projeto: LED-ClockShelf

Relógio de LED construído sobre um **ESP8266** (placa `esp12e`), com duas fitas WS2812b e uma
interface web servida pelo próprio dispositivo.

Este arquivo entra no prompt de sistema do agente de correção. Escreva aqui apenas o que é
verificável no código — é daqui que se ajusta o comportamento do agente, não do código dele.

## Arquitetura

| Caminho | O que é |
|---|---|
| `src/main.cpp` | Todo o firmware: setup, loop, display de dígitos, endpoints REST, NTP, sensores |
| `data/index.html`, `data/app.js`, `data/style.css` | Painel web, gravado no LittleFS e servido pelo ESP8266 |
| `platformio.ini` | Build PlatformIO, ambiente `esp12e`, framework Arduino |
| `include/`, `lib/`, `test/` | Diretórios padrão do PlatformIO, hoje apenas com o README de placeholder |

Não existe projeto C#, .NET, ASP.NET Core nem banco de dados neste repositório. Não proponha
`dotnet build`, `dotnet test`, migrations ou camadas de serviço.

## Build e validação

- O build é **PlatformIO**: `pio run -e esp12e`. É a única verificação que prova que o firmware
  compila; é ela que roda antes de qualquer Pull Request automático.
- **Não existe suíte de testes unitários.** `test/` tem só o README do PlatformIO. Não invente uma
  estrutura de testes nova, não adicione framework de teste e não crie `test/test_*.cpp` a menos que
  o bug seja em lógica pura, isolável e que compile para o alvo nativo.
- O JavaScript da interface é verificado com `node --check data/app.js`. Não há bundler, não há
  `package.json` no projeto e não há dependência npm: `data/app.js` é servido tal como está.

## Convenções do firmware (`src/main.cpp`)

- C++ do framework Arduino. Constantes com `constexpr`, em `MAIUSCULAS_COM_SUBLINHADO`.
- Funções e variáveis em `camelCase`. Comentários em português.
- Memória é escassa: prefira tipos pequenos (`uint8_t`, `uint16_t`) quando o intervalo permitir, e
  `F()`/`PROGMEM` para literais longos. Não introduza `String` em laço quente nem alocação dinâmica
  dentro do `loop()`.
- O `loop()` é **não bloqueante**, baseado em comparação de `millis()`. Nunca introduza `delay()`
  no caminho principal: ele trava o servidor web e o NTP.
- Os dígitos ocupam 63 LEDs cada; os deslocamentos ficam em `IDX_FIRST_DIGIT`, `IDX_SECOND_DIGIT`,
  `IDX_THIRD_DIGIT` e `IDX_FOURTH_DIGIT`. Não recalcule esses índices em linha.
- Endpoints REST são registrados no `setup()` e lêem argumentos com `server.arg(...)`. Valide
  intervalo de todo argumento recebido antes de usá-lo como índice de LED.

## Convenções da interface web (`data/`)

- JavaScript sem framework e sem módulos: funções globais e `fetch` direto para os endpoints.
- Bootstrap para o layout. Não troque de biblioteca, não introduza build step, não adicione npm.
- O endereço do dispositivo aparece no código da página; não o substitua por outro valor.

## O que não apontar e não alterar

- Não faça upgrade de biblioteca em `lib_deps`, nem mude `platform`, `board` ou `framework`.
- Não altere `.github/workflows/**` nem `.github/revisao-ia/**` como parte da correção de um bug
  de firmware ou de interface.
- Não reformate arquivo inteiro, não reordene funções e não renomeie símbolo existente.
- `CLAUDE.md` descreve uma estrutura antiga (`Firmware/`, `WebApi/`) que **não existe mais**.
  Use `src/` e `data/` como referência; ignore os caminhos citados naquele arquivo.

## Dados sensíveis

- Credenciais de Wi-Fi e chaves de API nunca podem aparecer no código, em log serial ou em resposta
  de endpoint.
- Não escreva o IP, o SSID ou a chave de API do usuário em comentário, em commit ou na descrição de
  Pull Request.
