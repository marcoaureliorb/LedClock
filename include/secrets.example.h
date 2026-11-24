// ================================================================================
//  MODELO DE CONFIGURAÇÃO SECRETA DO LEDCLOCK
// ================================================================================
//
//  1. Copie este arquivo para  include/secrets.h  (mesma pasta)
//  2. Preencha os valores abaixo com os seus dados
//  3. Compile e grave normalmente (pio run -t upload)
//
//  O include/secrets.h está no .gitignore e NUNCA deve ir para o repositório.
//  Este modelo é versionado só para mostrar quais campos existem.
//
//  Sem o include/secrets.h o firmware ainda compila (usando este modelo, para o CI
//  funcionar), mas mostra um aviso na compilação e no log, e o relógio não vai
//  conseguir conectar ao WiFi.
// ================================================================================

#pragma once

// Rede WiFi 2.4 GHz à qual o relógio se conecta (o ESP8266 não suporta 5 GHz).
#define WIFI_SSID        "nome-da-sua-rede"
#define WIFI_PASSWORD    "senha-da-sua-rede"

// Senha exigida para atualizar firmware/interface pela tela (card "Atualização OTA").
// O usuário é sempre "admin". Use uma senha forte: quem tiver esta senha e acesso à
// sua rede pode regravar o relógio.
#define OTA_PASSWORD     "troque-esta-senha"

// API de clima da HG Brasil (https://hgbrasil.com/status/weather), usada para
// temperatura, umidade e alerta de chuva.
//   WEATHER_API_KEY: chave gerada no painel da HG Brasil
//   WEATHER_WOEID:   código da sua cidade (consulte em https://console.hgbrasil.com/documentation/weather/tools)
#define WEATHER_API_KEY  "sua-chave-hgbrasil"
#define WEATHER_WOEID    "455827"

// Só existe neste modelo: avisa o firmware que os valores acima são de exemplo.
// NÃO copie esta linha para o seu secrets.h.
#define SECRETS_ARE_EXAMPLE 1
