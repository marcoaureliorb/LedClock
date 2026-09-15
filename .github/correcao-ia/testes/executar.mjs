#!/usr/bin/env node
/**
 * Executor da suite de testes.
 *
 * Existe porque a forma de passar arquivos para `node --test` mudou entre
 * versoes: o Node 20 aceita um diretorio, o Node 22+ espera caminhos ou glob.
 * Passar a lista explicita de arquivos funciona em todas elas, e a mesma linha
 * de comando serve para o workflow e para a validacao declarada no
 * `corretor.config.json`.
 *
 * Uso: node testes/executar.mjs [diretorio-de-testes]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const diretorioPadrao = dirname(fileURLToPath(import.meta.url));
const diretorio = resolve(process.argv[2] ?? diretorioPadrao);

if (!existsSync(diretorio)) {
  process.stderr.write(`Diretorio de testes inexistente: ${diretorio}\n`);
  process.exit(2);
}

const arquivos = readdirSync(diretorio)
  .filter((nome) => nome.endsWith('.test.mjs'))
  .sort()
  .map((nome) => join(diretorio, nome));

if (arquivos.length === 0) {
  process.stderr.write(`Nenhum arquivo *.test.mjs em ${diretorio}\n`);
  process.exit(2);
}

const execucao = spawnSync(process.execPath, ['--test', ...arquivos], {
  stdio: 'inherit',
  shell: false,
});

process.exit(execucao.status ?? 1);
