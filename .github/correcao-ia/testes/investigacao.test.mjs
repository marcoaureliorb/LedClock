import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { investigar } from '../src/index.mjs';
import { listarArvore } from '../src/repositorio.mjs';

const CONFIGURACAO = {
  incluir: ['**/*.cpp', '**/*.js'],
  excluir: ['**/.pio/**'],
  editaveis: ['src/**', 'data/**'],
  limites: {
    maxRodadasDeInvestigacao: 3,
    maxArquivosPorRodada: 4,
    maxBuscasPorRodada: 2,
    maxResultadosPorBusca: 20,
    maxCaracteresPorArquivo: 5000,
    maxCaracteresTotal: 50000,
    maxArquivosNaArvore: 50,
    maxArquivosAlterados: 3,
  },
};

const ISSUE = {
  numero: 5,
  titulo: '[BUG] Linha 2 da decoracao apaga',
  corpo: 'Ao mudar a cor da linha 2, o ultimo LED apaga.',
  autor: 'alguem',
  rotulos: ['bug'],
  comentarios: [],
};

let raiz;
let arvore;

before(() => {
  raiz = mkdtempSync(join(tmpdir(), 'correcao-ia-inv-'));

  mkdirSync(join(raiz, 'src'), { recursive: true });
  mkdirSync(join(raiz, 'data'), { recursive: true });

  writeFileSync(join(raiz, 'src', 'main.cpp'), 'void setDecoColorAll(uint8_t line) {}\n');
  writeFileSync(join(raiz, 'data', 'app.js'), 'function enviarCor() {}\n');

  arvore = listarArvore(raiz, CONFIGURACAO);
});

after(() => {
  rmSync(raiz, { recursive: true, force: true });
});

/** Provedor falso que devolve as respostas na ordem, registrando os prompts. */
function provedorFalso(respostas) {
  const prompts = [];

  return {
    prompts,
    nome: 'falso',
    modelo: 'falso',
    async revisar({ sistema, usuario }) {
      prompts.push({ sistema, usuario });

      const texto = respostas.shift() ?? JSON.stringify({ acao: 'concluir', status: 'not_found' });

      return {
        texto,
        uso: {
          tokensDeEntrada: 100,
          tokensDeSaida: 10,
          tokensLidosDoCache: 0,
          tokensGravadosNoCache: 0,
        },
      };
    },
  };
}

function investigarCom(respostas) {
  const provedor = provedorFalso(respostas);

  return investigar({
    provedor,
    issue: ISSUE,
    arvore,
    configuracao: CONFIGURACAO,
    promptDeSistema: 'sistema',
    raiz,
  }).then((resultado) => ({ ...resultado, provedor }));
}

describe('investigar', () => {
  it('conclui na primeira rodada quando o modelo ja decide', async () => {
    const resultado = await investigarCom([
      JSON.stringify({ acao: 'concluir', status: 'identified', root_cause: 'causa' }),
    ]);

    assert.equal(resultado.rodadas, 1);
    assert.equal(resultado.bruto.status, 'identified');
    assert.equal(resultado.esgotouRodadas, undefined);
  });

  it('serve os arquivos pedidos na rodada seguinte', async () => {
    const resultado = await investigarCom([
      JSON.stringify({ acao: 'investigar', arquivos: ['src/main.cpp'], buscas: [] }),
      JSON.stringify({ acao: 'concluir', status: 'identified' }),
    ]);

    assert.equal(resultado.rodadas, 2);
    assert.equal(resultado.dossie.arquivos[0].caminho, 'src/main.cpp');
    assert.match(resultado.provedor.prompts[1].usuario, /setDecoColorAll/);
  });

  it('serve o resultado das buscas pedidas', async () => {
    const resultado = await investigarCom([
      JSON.stringify({ acao: 'investigar', arquivos: [], buscas: ['setDecoColorAll'] }),
      JSON.stringify({ acao: 'concluir', status: 'identified' }),
    ]);

    assert.equal(resultado.dossie.buscas[0].termo, 'setDecoColorAll');
    assert.ok(resultado.dossie.buscas[0].ocorrencias.length > 0);
  });

  it('registra o motivo quando o arquivo pedido nao existe, sem interromper', async () => {
    const resultado = await investigarCom([
      JSON.stringify({ acao: 'investigar', arquivos: ['src/ServicoDeContrato.cs'], buscas: [] }),
      JSON.stringify({ acao: 'concluir', status: 'uncertain' }),
    ]);

    const arquivo = resultado.dossie.arquivos[0];

    assert.equal(arquivo.ok, false);
    assert.match(arquivo.motivo, /fora da lista|inexistente/);
  });

  it('recusa arquivo pedido fora da raiz do repositorio', async () => {
    const resultado = await investigarCom([
      JSON.stringify({ acao: 'investigar', arquivos: ['../../etc/passwd'], buscas: [] }),
      JSON.stringify({ acao: 'concluir', status: 'uncertain' }),
    ]);

    assert.equal(resultado.dossie.arquivos[0].ok, false);
  });

  it('nao serve o mesmo arquivo duas vezes', async () => {
    const resultado = await investigarCom([
      JSON.stringify({ acao: 'investigar', arquivos: ['src/main.cpp'], buscas: [] }),
      JSON.stringify({ acao: 'investigar', arquivos: ['src/main.cpp', 'data/app.js'], buscas: [] }),
      JSON.stringify({ acao: 'concluir', status: 'identified' }),
    ]);

    const caminhos = resultado.dossie.arquivos.map((arquivo) => arquivo.caminho);

    assert.deepEqual(caminhos, ['src/main.cpp', 'data/app.js']);
  });

  it('para no limite de rodadas e devolve status uncertain', async () => {
    const pedido = JSON.stringify({ acao: 'investigar', arquivos: ['src/main.cpp'], buscas: [] });

    const resultado = await investigarCom([pedido, pedido, pedido, pedido]);

    assert.equal(resultado.rodadas, CONFIGURACAO.limites.maxRodadasDeInvestigacao);
    assert.equal(resultado.esgotouRodadas, true);
    assert.equal(resultado.bruto.status, 'uncertain');
  });

  it('avisa o modelo na ultima rodada que nao havera outra', async () => {
    const pedido = JSON.stringify({ acao: 'investigar', arquivos: ['src/main.cpp'], buscas: [] });

    const resultado = await investigarCom([pedido, pedido, pedido]);

    const ultimoPrompt = resultado.provedor.prompts.at(-1).usuario;

    assert.match(ultimoPrompt, /ultima rodada/);
  });

  it('soma o uso de tokens de todas as rodadas', async () => {
    const resultado = await investigarCom([
      JSON.stringify({ acao: 'investigar', arquivos: ['src/main.cpp'], buscas: [] }),
      JSON.stringify({ acao: 'concluir', status: 'identified' }),
    ]);

    assert.equal(resultado.uso.tokensDeEntrada, 200);
    assert.equal(resultado.uso.tokensDeSaida, 20);
  });

  it('inclui a arvore do repositorio ja na primeira rodada', async () => {
    const resultado = await investigarCom([
      JSON.stringify({ acao: 'concluir', status: 'not_found' }),
    ]);

    assert.match(resultado.provedor.prompts[0].usuario, /src\/main\.cpp/);
  });

  it('delimita o relato da Issue como conteudo nao confiavel', async () => {
    const resultado = await investigarCom([
      JSON.stringify({ acao: 'concluir', status: 'not_found' }),
    ]);

    const prompt = resultado.provedor.prompts[0].usuario;

    assert.match(prompt, /nao confiavel/);
    assert.match(prompt, /<<<INICIO_DO_RELATO>>>/);
  });
});
