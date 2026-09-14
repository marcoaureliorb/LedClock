#!/usr/bin/env node
/**
 * Registra o resultado de uma verificacao nativa para que a revisao por IA
 * possa considera-la e exibi-la no comentario do PR.
 *
 * Uso: node registrar-verificacao.mjs "<nome>" "<situacao>" "[detalhe]"
 *
 * `situacao` aceita os valores de `outcome` do GitHub Actions (`success`,
 * `failure`, `skipped`) ou os rotulos em portugues ja normalizados.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITUACOES = {
  success: 'sucesso',
  failure: 'falhou',
  cancelled: 'cancelada',
  skipped: 'nao executada',
};

function diretorioTemporario() {
  return process.env.RUNNER_TEMP || process.env.TMPDIR || process.env.TEMP || '.';
}

const ARQUIVO = join(diretorioTemporario(), 'revisao-ia-verificacoes.json');

const [nome, situacaoBruta, detalhe = ''] = process.argv.slice(2);

if (!nome || !situacaoBruta) {
  process.stderr.write('Uso: registrar-verificacao.mjs "<nome>" "<situacao>" "[detalhe]"\n');
  process.exit(2);
}

const situacao = SITUACOES[situacaoBruta] ?? situacaoBruta;

let verificacoes = [];

if (existsSync(ARQUIVO)) {
  try {
    const conteudo = JSON.parse(readFileSync(ARQUIVO, 'utf8'));

    if (Array.isArray(conteudo)) verificacoes = conteudo;
  } catch {
    verificacoes = [];
  }
}

verificacoes.push({
  nome,
  situacao,
  detalhe: String(detalhe).trim().slice(0, 1000),
});

writeFileSync(ARQUIVO, JSON.stringify(verificacoes, null, 2), 'utf8');

process.stdout.write(`[revisao-ia] Verificacao registrada: ${nome} = ${situacao}\n`);
