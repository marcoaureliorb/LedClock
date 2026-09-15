import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { carregarConfiguracao } from '../src/config.mjs';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const CAMINHO_PADRAO = join(RAIZ, 'corretor.config.json');

const VARIAVEIS = [
  'CORRECAO_PROVEDOR',
  'CORRECAO_MODELO',
  'CORRECAO_ENDPOINT',
  'CORRECAO_DEPLOYMENT',
  'CORRECAO_API_KEY',
  'CORRECAO_MAX_RODADAS',
  'CORRECAO_MAX_CARACTERES',
  'CORRECAO_CONVENCOES',
  'CORRECAO_SIMULACAO',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_DEPLOYMENT',
  'ANTHROPIC_API_KEY',
];

function limparAmbiente() {
  for (const variavel of VARIAVEIS) delete process.env[variavel];
}

/** Ambiente minimo para o provedor azure-openai passar na validacao. */
function comAzureConfigurado() {
  limparAmbiente();
  process.env.AZURE_OPENAI_ENDPOINT = 'https://instancia.openai.azure.com';
  process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-4o-producao';
}

function escreverConfiguracao(conteudo) {
  const diretorio = mkdtempSync(join(tmpdir(), 'correcao-ia-'));
  const caminho = join(diretorio, 'corretor.config.json');

  writeFileSync(caminho, JSON.stringify(conteudo), 'utf8');

  return caminho;
}

afterEach(limparAmbiente);

describe('carregarConfiguracao', () => {
  it('carrega os padroes do arquivo do repositorio', () => {
    comAzureConfigurado();

    const configuracao = carregarConfiguracao(CAMINHO_PADRAO);

    assert.equal(configuracao.provedor, 'azure-openai');
    assert.equal(configuracao.branchBase, 'main');
    assert.equal(configuracao.prefixoDaBranch, 'automated-error-analysis');
    assert.deepEqual(configuracao.rotulosDeBug, ['bug']);
    assert.deepEqual(configuracao.prefixosDeTitulo, ['[BUG]']);
    assert.equal(configuracao.comandoDeReanalise, '/analisar-bug');
    assert.equal(configuracao.simulacao, false);
    assert.ok(configuracao.editaveis.includes('src/**'));
    assert.ok(configuracao.excluir.includes('**/.pio/**'));
  });

  it('aceita os nomes de secret do Azure exigidos pelo processo', () => {
    comAzureConfigurado();
    process.env.AZURE_OPENAI_API_KEY = 'chave-do-azure';

    const configuracao = carregarConfiguracao(CAMINHO_PADRAO);

    assert.equal(configuracao.chaveDeApi, 'chave-do-azure');
    assert.equal(configuracao.origemDaChave, 'AZURE_OPENAI_API_KEY');
    assert.equal(configuracao.endpoint, 'https://instancia.openai.azure.com');
    assert.equal(configuracao.deployment, 'gpt-4o-producao');
  });

  it('prioriza CORRECAO_API_KEY sobre o secret especifico do provedor', () => {
    comAzureConfigurado();
    process.env.AZURE_OPENAI_API_KEY = 'chave-do-azure';
    process.env.CORRECAO_API_KEY = 'chave-generica';

    assert.equal(carregarConfiguracao(CAMINHO_PADRAO).chaveDeApi, 'chave-generica');
  });

  it('remove a barra final do endpoint', () => {
    comAzureConfigurado();
    process.env.AZURE_OPENAI_ENDPOINT = 'https://instancia.openai.azure.com/';

    assert.equal(carregarConfiguracao(CAMINHO_PADRAO).endpoint, 'https://instancia.openai.azure.com');
  });

  it('exige endpoint e deployment no provedor azure-openai', () => {
    limparAmbiente();

    assert.throws(() => carregarConfiguracao(CAMINHO_PADRAO), /AZURE_OPENAI_ENDPOINT/);

    process.env.AZURE_OPENAI_ENDPOINT = 'https://instancia.openai.azure.com';

    assert.throws(() => carregarConfiguracao(CAMINHO_PADRAO), /AZURE_OPENAI_DEPLOYMENT/);
  });

  it('nao exige endpoint quando o provedor e anthropic', () => {
    limparAmbiente();
    process.env.CORRECAO_PROVEDOR = 'anthropic';

    const configuracao = carregarConfiguracao(CAMINHO_PADRAO);

    assert.equal(configuracao.endpoint, 'https://api.anthropic.com');
  });

  it('rejeita provedor invalido', () => {
    limparAmbiente();
    process.env.CORRECAO_PROVEDOR = 'modelo-do-vizinho';

    assert.throws(() => carregarConfiguracao(CAMINHO_PADRAO), /Valor invalido para provedor/);
  });

  it('deixa a variavel de ambiente sobrescrever o arquivo', () => {
    comAzureConfigurado();
    process.env.CORRECAO_MAX_RODADAS = '5';
    process.env.CORRECAO_CONVENCOES = 'docs/padroes.md';
    process.env.CORRECAO_SIMULACAO = 'true';

    const configuracao = carregarConfiguracao(CAMINHO_PADRAO);

    assert.equal(configuracao.limites.maxRodadasDeInvestigacao, 5);
    assert.equal(configuracao.arquivoDeConvencoes, 'docs/padroes.md');
    assert.equal(configuracao.simulacao, true);
  });

  it('ignora variavel de ambiente vazia', () => {
    comAzureConfigurado();
    process.env.CORRECAO_MODELO = '';

    assert.equal(carregarConfiguracao(CAMINHO_PADRAO).modelo, 'gpt-4o');
  });

  it('rejeita limite nao numerico', () => {
    comAzureConfigurado();
    process.env.CORRECAO_MAX_RODADAS = 'algumas';

    assert.throws(() => carregarConfiguracao(CAMINHO_PADRAO), /inteiro positivo/);
  });

  it('normaliza as validacoes declaradas', () => {
    comAzureConfigurado();

    const validacoes = carregarConfiguracao(CAMINHO_PADRAO).validacoes;
    const firmware = validacoes.find((item) => item.chave === 'compilacaoDoFirmware');

    assert.deepEqual(firmware.comando, ['pio', 'run', '-e', 'esp12e']);
    assert.equal(firmware.obrigatoria, true);
    assert.ok(firmware.gatilho.includes('src/**'));
  });

  it('rejeita validacao cujo comando nao e array de argumentos', () => {
    limparAmbiente();

    const caminho = escreverConfiguracao({
      provedor: 'anthropic',
      editaveis: ['src/**'],
      // Uma string aqui abriria espaco para injecao de comando; por isso e recusada.
      validacoes: { build: { comando: 'pio run && curl exemplo.com' } },
    });

    assert.throws(() => carregarConfiguracao(caminho), /array de argumentos/);
  });

  it('rejeita validacao com argumento nao textual', () => {
    limparAmbiente();

    const caminho = escreverConfiguracao({
      provedor: 'anthropic',
      editaveis: ['src/**'],
      validacoes: { build: { comando: ['pio', 42] } },
    });

    assert.throws(() => carregarConfiguracao(caminho), /devem ser texto/);
  });

  it('exige ao menos um caminho editavel', () => {
    limparAmbiente();

    const caminho = escreverConfiguracao({ provedor: 'anthropic', editaveis: [] });

    assert.throws(() => carregarConfiguracao(caminho), /Nenhum caminho editavel/);
  });

  it('lanca erro descritivo quando o arquivo nao existe', () => {
    limparAmbiente();

    assert.throws(
      () => carregarConfiguracao(join(RAIZ, 'inexistente.json')),
      /Nao foi possivel ler a configuracao/,
    );
  });
});
