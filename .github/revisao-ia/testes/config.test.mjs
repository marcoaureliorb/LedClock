import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { carregarConfiguracao, ordemDaSeveridade } from '../src/config.mjs';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const CAMINHO_PADRAO = join(RAIZ, 'revisor.config.json');

const VARIAVEIS = [
  'REVISAO_PROVEDOR',
  'REVISAO_MODELO',
  'REVISAO_MODO',
  'REVISAO_SEVERIDADE_BLOQUEIO',
  'REVISAO_MAX_ARQUIVOS',
  'REVISAO_MAX_CARACTERES',
  'REVISAO_ENDPOINT',
  'REVISAO_DEPLOYMENT',
  'REVISAO_API_KEY',
  'ANTHROPIC_API_KEY',
  'REVISAO_CONVENCOES',
];

function limparAmbiente() {
  for (const variavel of VARIAVEIS) delete process.env[variavel];
}

afterEach(limparAmbiente);

describe('carregarConfiguracao', () => {
  it('carrega os padroes do arquivo do repositorio', () => {
    limparAmbiente();

    const configuracao = carregarConfiguracao(CAMINHO_PADRAO);

    assert.equal(configuracao.provedor, 'anthropic');
    assert.equal(configuracao.modelo, 'claude-sonnet-5');
    assert.equal(configuracao.modo, 'informativo');
    assert.equal(configuracao.endpoint, 'https://api.anthropic.com');
    assert.ok(configuracao.excluir.includes('**/node_modules/**'));
    assert.ok(configuracao.incluir.includes('**/*.js'));
    assert.equal(configuracao.arquivoDeConvencoes, '.github/revisao-ia/convencoes.md');
  });

  it('deixa a chave indefinida quando nenhum secret esta presente', () => {
    limparAmbiente();

    assert.equal(carregarConfiguracao(CAMINHO_PADRAO).chaveDeApi, undefined);
  });

  it('prioriza REVISAO_API_KEY sobre ANTHROPIC_API_KEY', () => {
    limparAmbiente();
    process.env.ANTHROPIC_API_KEY = 'chave-especifica';
    process.env.REVISAO_API_KEY = 'chave-generica';

    const configuracao = carregarConfiguracao(CAMINHO_PADRAO);

    assert.equal(configuracao.chaveDeApi, 'chave-generica');
    assert.equal(configuracao.origemDaChave, 'REVISAO_API_KEY');
  });

  it('deixa a variavel de ambiente sobrescrever o arquivo', () => {
    limparAmbiente();
    process.env.REVISAO_MODO = 'bloqueante';
    process.env.REVISAO_SEVERIDADE_BLOQUEIO = 'High';
    process.env.REVISAO_MAX_ARQUIVOS = '5';

    const configuracao = carregarConfiguracao(CAMINHO_PADRAO);

    assert.equal(configuracao.modo, 'bloqueante');
    assert.equal(configuracao.severidadeDeBloqueio, 'High');
    assert.equal(configuracao.limites.maxArquivos, 5);
  });

  it('ignora variavel de ambiente vazia', () => {
    limparAmbiente();
    process.env.REVISAO_MODO = '';

    assert.equal(carregarConfiguracao(CAMINHO_PADRAO).modo, 'informativo');
  });

  it('rejeita modo invalido', () => {
    limparAmbiente();
    process.env.REVISAO_MODO = 'talvez';

    assert.throws(() => carregarConfiguracao(CAMINHO_PADRAO), /Valor invalido para modo/);
  });

  it('rejeita severidade invalida', () => {
    limparAmbiente();
    process.env.REVISAO_SEVERIDADE_BLOQUEIO = 'Blocker';

    assert.throws(() => carregarConfiguracao(CAMINHO_PADRAO), /severidadeDeBloqueio/);
  });

  it('rejeita limite nao numerico', () => {
    limparAmbiente();
    process.env.REVISAO_MAX_ARQUIVOS = 'muitos';

    assert.throws(() => carregarConfiguracao(CAMINHO_PADRAO), /inteiro positivo/);
  });

  it('exige endpoint e deployment no provedor azure-openai', () => {
    limparAmbiente();
    process.env.REVISAO_PROVEDOR = 'azure-openai';

    assert.throws(() => carregarConfiguracao(CAMINHO_PADRAO), /exige REVISAO_ENDPOINT/);

    process.env.REVISAO_ENDPOINT = 'https://instancia.openai.azure.com';

    assert.throws(() => carregarConfiguracao(CAMINHO_PADRAO), /exige REVISAO_DEPLOYMENT/);
  });

  it('deixa REVISAO_CONVENCOES apontar outro arquivo de convencoes', () => {
    limparAmbiente();
    process.env.REVISAO_CONVENCOES = 'docs/padroes.md';

    assert.equal(carregarConfiguracao(CAMINHO_PADRAO).arquivoDeConvencoes, 'docs/padroes.md');
  });

  it('remove a barra final do endpoint', () => {
    limparAmbiente();
    process.env.REVISAO_ENDPOINT = 'https://api.anthropic.com/';

    assert.equal(carregarConfiguracao(CAMINHO_PADRAO).endpoint, 'https://api.anthropic.com');
  });

  it('lanca erro descritivo quando o arquivo nao existe', () => {
    assert.throws(
      () => carregarConfiguracao(join(RAIZ, 'inexistente.json')),
      /Nao foi possivel ler a configuracao/,
    );
  });
});

describe('ordemDaSeveridade', () => {
  it('ordena da menor para a maior gravidade', () => {
    assert.ok(ordemDaSeveridade('Critical') > ordemDaSeveridade('High'));
    assert.ok(ordemDaSeveridade('High') > ordemDaSeveridade('Medium'));
    assert.ok(ordemDaSeveridade('Info') < ordemDaSeveridade('Low'));
  });

  it('trata valor desconhecido como o menor', () => {
    assert.equal(ordemDaSeveridade('Inexistente'), 0);
  });
});
