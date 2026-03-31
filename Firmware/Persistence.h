#pragma once

#include <EEPROM.h>
#include "Firmware.h"  // onde Config está definido

// Número mágico: se os primeiros 4 bytes da EEPROM forem exatamente
// esse valor, os dados são considerados válidos.
// Mude o valor sempre que a struct Config mudar de layout.
static const uint32_t EEPROM_MAGIC = 0xC10CC10D;

// Endereços na EEPROM
static const int ADDR_MAGIC  = 0;
static const int ADDR_CONFIG = sizeof(uint32_t);

// Tamanho total necessário
static const int EEPROM_SIZE = sizeof(uint32_t) + sizeof(Config);

// ─────────────────────────────────────────────────────────────
//  Inicialização — chame uma vez no setup(), antes de LoadConfig
// ─────────────────────────────────────────────────────────────
inline void InitPersistence() {
    EEPROM.begin(EEPROM_SIZE);
}

// ─────────────────────────────────────────────────────────────
//  Grava a configuração na EEPROM.
//  Retorna true em sucesso.
// ─────────────────────────────────────────────────────────────
inline bool SaveConfig(const Config& cfg) {
    // Grava o magic number
    EEPROM.put(ADDR_MAGIC, EEPROM_MAGIC);

    // Grava a struct inteira
    EEPROM.put(ADDR_CONFIG, cfg);

    // Commit é obrigatório no ESP8266 — só aqui os dados vão para a flash
    bool ok = EEPROM.commit();

    if (ok) {
        Serial.println("[EEPROM] Config salva com sucesso.");
    } else {
        Serial.println("[EEPROM] ERRO ao salvar config.");
    }

    return ok;
}

// ─────────────────────────────────────────────────────────────
//  Carrega a configuração da EEPROM para `cfg`.
//  Retorna true se os dados eram válidos.
//  Retorna false se não havia dados gravados (primeiro boot
//  ou magic number errado) — nesse caso `cfg` não é alterado.
// ─────────────────────────────────────────────────────────────
inline bool LoadConfig(Config& cfg) {
    uint32_t magic = 0;
    EEPROM.get(ADDR_MAGIC, magic);

    if (magic != EEPROM_MAGIC) {
        Serial.printf("[EEPROM] Magic inválido (0x%08X). Usando config padrão.\n", magic);
        return false;
    }

    EEPROM.get(ADDR_CONFIG, cfg);
    Serial.println("[EEPROM] Config carregada da EEPROM.");
    return true;
}

// ─────────────────────────────────────────────────────────────
//  Apaga a EEPROM (reseta para config padrão no próximo boot).
//  Útil para um endpoint /ResetConfig ou botão de hardware.
// ─────────────────────────────────────────────────────────────
inline void EraseConfig() {
    uint32_t zero = 0;
    EEPROM.put(ADDR_MAGIC, zero);   // invalida o magic
    EEPROM.commit();
    Serial.println("[EEPROM] Config apagada.");
}
