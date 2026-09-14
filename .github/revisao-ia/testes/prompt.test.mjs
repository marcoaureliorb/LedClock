import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { montarPromptDeSistema, montarPromptDeUsuario } from '../src/prompt.mjs';

const CONVENCOES = '# Projeto Exemplo\n\n- Identificadores em portugues.';

describe('montarPromptDeSistema', () => {
  it('injeta as convencoes recebidas', () => {
    const prompt = montarPromptDeSistema(CONVENCOES);

    assert.match(prompt, /Projeto Exemplo/);
    assert.match(prompt, /Identificadores em portugues/);
  });

  it('usa o texto padrao quando nao ha convencoes', () => {
    for (const vazio of [null, undefined, '', '   ']) {
      const prompt = montarPromptDeSistema(vazio);

      assert.match(prompt, /Nao foram declaradas convencoes especificas/);
    }
  });

  it('mantem as secoes fixas da revisao', () => {
    const prompt = montarPromptDeSistema(CONVENCOES);

    assert.match(prompt, /# O que avaliar/);
    assert.match(prompt, /# Severidade/);
    assert.match(prompt, /# Disciplina de revisao/);
    assert.match(prompt, /# Formato de saida/);
    assert.match(prompt, /"apontamentos": \[\]/);
  });

  it('nao varia entre chamadas com a mesma entrada (prefixo cacheavel)', () => {
    assert.equal(montarPromptDeSistema(CONVENCOES), montarPromptDeSistema(CONVENCOES));
  });
});

describe('montarPromptDeUsuario', () => {
  const PULL_REQUEST = {
    titulo: 'Corrige calculo de total',
    descricao: 'Ajusta o arredondamento.',
    branchOrigem: 'fix/total',
    branchDestino: 'main',
  };

  const CONTEXTO = {
    itens: [
      {
        caminho: 'src/total.js',
        status: 'modified',
        adicoes: 3,
        remocoes: 1,
        diff: '@@ -1,2 +1,4 @@\n 1  const a = 1;',
        diffTruncado: false,
        conteudoIntegral: null,
      },
    ],
    naoEnviados: [],
  };

  it('inclui metadados, diff e instrucao final', () => {
    const prompt = montarPromptDeUsuario({ pullRequest: PULL_REQUEST, contexto: CONTEXTO });

    assert.match(prompt, /Corrige calculo de total/);
    assert.match(prompt, /Branch de destino: main/);
    assert.match(prompt, /## Arquivo 1: src\/total\.js/);
    assert.match(prompt, /responda apenas com o JSON especificado/);
  });

  it('lista as verificacoes nativas executadas', () => {
    const prompt = montarPromptDeUsuario({
      pullRequest: PULL_REQUEST,
      contexto: CONTEXTO,
      verificacoes: [{ nome: 'npm test', situacao: 'falhou', detalhe: '2 testes quebrados' }],
    });

    assert.match(prompt, /npm test: falhou - 2 testes quebrados/);
  });

  it('avisa sobre arquivos nao enviados sem enumerar todos', () => {
    const naoEnviados = Array.from({ length: 40 }, (_, indice) => ({
      caminho: `dist/arquivo-${indice}.js`,
      motivo: 'fora do escopo',
    }));

    const prompt = montarPromptDeUsuario({
      pullRequest: PULL_REQUEST,
      contexto: { ...CONTEXTO, naoEnviados },
    });

    assert.match(prompt, /Nao produza apontamentos sobre esses arquivos/);
    assert.match(prompt, /e mais 15 arquivo\(s\)/);
    assert.doesNotMatch(prompt, /arquivo-39\.js/);
  });
});
