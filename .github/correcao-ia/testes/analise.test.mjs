import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  interpretarCorrecao,
  interpretarRodada,
  normalizarAnalise,
  podeCorrigir,
} from '../src/analise.mjs';

const CONFIGURACAO = {
  limites: {
    maxArquivosPorRodada: 3,
    maxBuscasPorRodada: 2,
    maxArquivosAlterados: 2,
  },
};

const EXISTENTES = new Set(['src/main.cpp', 'data/app.js', 'README.md']);
const EDITAVEL = (caminho) => caminho.startsWith('src/') || caminho.startsWith('data/');

function analiseBase(extra = {}) {
  return normalizarAnalise(
    {
      status: 'identified',
      confidence: 0.9,
      summary: 'resumo',
      root_cause: 'causa',
      proposed_solution: 'solucao',
      affected_files: ['src/main.cpp'],
      implementation_plan: ['passo'],
      tests_to_run: ['pio run'],
      manual_analysis: null,
      ...extra,
    },
    { caminhoEhEditavel: EDITAVEL, arquivosExistentes: EXISTENTES, configuracao: CONFIGURACAO },
  );
}

describe('interpretarRodada', () => {
  it('reconhece o pedido de investigacao', () => {
    const rodada = interpretarRodada(
      JSON.stringify({ acao: 'investigar', arquivos: ['src/main.cpp'], buscas: ['setDecoColor'] }),
      CONFIGURACAO,
    );

    assert.equal(rodada.acao, 'investigar');
    assert.deepEqual(rodada.arquivos, ['src/main.cpp']);
    assert.deepEqual(rodada.buscas, ['setDecoColor']);
  });

  it('aplica o teto de arquivos e de buscas por rodada', () => {
    const rodada = interpretarRodada(
      JSON.stringify({
        acao: 'investigar',
        arquivos: ['a.cpp', 'b.cpp', 'c.cpp', 'd.cpp', 'e.cpp'],
        buscas: ['um', 'dois', 'tres', 'quatro'],
      }),
      CONFIGURACAO,
    );

    assert.equal(rodada.arquivos.length, 3);
    assert.equal(rodada.buscas.length, 2);
  });

  it('trata pedido vazio como conclusao, para nao girar em falso', () => {
    const rodada = interpretarRodada(
      JSON.stringify({ acao: 'investigar', arquivos: [], buscas: [] }),
      CONFIGURACAO,
    );

    assert.equal(rodada.acao, 'concluir');
    assert.equal(rodada.pedidoVazio, true);
    assert.equal(rodada.bruto.status, 'uncertain');
  });

  it('reconhece a conclusao', () => {
    const rodada = interpretarRodada(
      JSON.stringify({ acao: 'concluir', status: 'identified' }),
      CONFIGURACAO,
    );

    assert.equal(rodada.acao, 'concluir');
    assert.equal(rodada.bruto.status, 'identified');
  });

  it('tolera cerca de codigo em volta do JSON', () => {
    const rodada = interpretarRodada(
      '```json\n{"acao":"concluir","status":"not_found"}\n```',
      CONFIGURACAO,
    );

    assert.equal(rodada.bruto.status, 'not_found');
  });

  it('falha de forma descritiva quando a resposta nao e JSON', () => {
    assert.throws(() => interpretarRodada('desculpe, nao posso ajudar', CONFIGURACAO), /JSON/);
  });
});

describe('normalizarAnalise', () => {
  it('normaliza os campos do contrato', () => {
    const analise = analiseBase();

    assert.equal(analise.status, 'identified');
    assert.equal(analise.confianca, 0.9);
    assert.deepEqual(analise.arquivosAfetados, ['src/main.cpp']);
    assert.deepEqual(analise.planoDeImplementacao, ['passo']);
    assert.deepEqual(analise.testesSugeridos, ['pio run']);
  });

  it('descarta arquivo que nao existe no repositorio', () => {
    const analise = analiseBase({ affected_files: ['src/ServicoDeContrato.cs', 'src/main.cpp'] });

    assert.deepEqual(analise.arquivosAfetados, ['src/main.cpp']);
    assert.equal(analise.arquivosDescartados[0].motivo, 'arquivo nao existe no repositorio');
  });

  it('descarta arquivo existente mas fora do escopo editavel', () => {
    const analise = analiseBase({ affected_files: ['README.md'] });

    assert.deepEqual(analise.arquivosAfetados, []);
    assert.equal(analise.arquivosDescartados[0].motivo, 'arquivo fora do escopo editavel');
  });

  it('trata status desconhecido como uncertain', () => {
    assert.equal(analiseBase({ status: 'talvez' }).status, 'uncertain');
    assert.equal(analiseBase({ status: undefined }).status, 'uncertain');
  });

  it('limita a confianca ao intervalo de 0 a 1', () => {
    assert.equal(analiseBase({ confidence: 7 }).confianca, 1);
    assert.equal(analiseBase({ confidence: -2 }).confianca, 0);
    assert.equal(analiseBase({ confidence: 'muita' }).confianca, null);
  });

  it('remove caminho duplicado', () => {
    const analise = analiseBase({ affected_files: ['src/main.cpp', 'src/main.cpp'] });

    assert.deepEqual(analise.arquivosAfetados, ['src/main.cpp']);
  });
});

describe('podeCorrigir', () => {
  it('autoriza quando ha causa, arquivos e plano', () => {
    assert.equal(podeCorrigir(analiseBase()).pode, true);
  });

  it('recusa quando o status nao e identified', () => {
    const decisao = podeCorrigir(analiseBase({ status: 'uncertain' }));

    assert.equal(decisao.pode, false);
    assert.match(decisao.motivo, /status "uncertain"/);
  });

  it('recusa quando nenhum arquivo valido sobrou', () => {
    const decisao = podeCorrigir(analiseBase({ affected_files: ['src/inventado.cpp'] }));

    assert.equal(decisao.pode, false);
    assert.match(decisao.motivo, /nenhum arquivo valido/);
  });

  it('recusa quando falta causa raiz', () => {
    assert.equal(podeCorrigir(analiseBase({ root_cause: '' })).pode, false);
  });

  it('recusa quando falta plano de implementacao', () => {
    assert.equal(podeCorrigir(analiseBase({ implementation_plan: [] })).pode, false);
  });

  it('nao autoriza por confianca alta sozinha', () => {
    const decisao = podeCorrigir(analiseBase({ status: 'uncertain', confidence: 0.99 }));

    assert.equal(decisao.pode, false);
  });

  it('autoriza mesmo com confianca baixa quando ha evidencia declarada', () => {
    assert.equal(podeCorrigir(analiseBase({ confidence: 0.1 })).pode, true);
  });
});

describe('interpretarCorrecao', () => {
  const opcoes = { caminhoEhEditavel: EDITAVEL, configuracao: CONFIGURACAO };

  it('aceita alteracoes bem formadas', () => {
    const correcao = interpretarCorrecao(JSON.stringify({
      status: 'corrigido',
      resumo_da_correcao: 'ajusta o limite do laco',
      mensagem_de_commit: 'corrige limite do laco de LEDs',
      alteracoes: [{
        arquivo: 'src/main.cpp',
        descricao: 'ajusta o limite',
        trecho_original: 'i <= 6',
        trecho_novo: 'i < 7',
      }],
    }), opcoes);

    assert.equal(correcao.status, 'corrigido');
    assert.equal(correcao.alteracoes.length, 1);
    assert.equal(correcao.mensagemDeCommit, 'corrige limite do laco de LEDs');
  });

  it('descarta alteracao fora do escopo editavel', () => {
    const correcao = interpretarCorrecao(JSON.stringify({
      status: 'corrigido',
      alteracoes: [
        { arquivo: '.github/workflows/automated-error-analysis.yml', trecho_original: 'a', trecho_novo: 'b' },
        { arquivo: 'src/main.cpp', trecho_original: 'a', trecho_novo: 'b' },
      ],
    }), opcoes);

    assert.equal(correcao.alteracoes.length, 1);
    assert.equal(correcao.alteracoes[0].caminho, 'src/main.cpp');
    assert.match(correcao.descartadas[0].motivo, /fora do escopo editavel/);
  });

  it('descarta alteracao sem efeito', () => {
    const correcao = interpretarCorrecao(JSON.stringify({
      status: 'corrigido',
      alteracoes: [{ arquivo: 'src/main.cpp', trecho_original: 'a', trecho_novo: 'a' }],
    }), opcoes);

    assert.equal(correcao.alteracoes.length, 0);
    assert.match(correcao.descartadas[0].motivo, /identico ao original/);
  });

  it('recusa correcao que espalha alteracoes por arquivos demais', () => {
    assert.throws(() => interpretarCorrecao(JSON.stringify({
      status: 'corrigido',
      alteracoes: [
        { arquivo: 'src/a.cpp', trecho_original: 'a', trecho_novo: 'b' },
        { arquivo: 'src/b.cpp', trecho_original: 'a', trecho_novo: 'b' },
        { arquivo: 'data/c.js', trecho_original: 'a', trecho_novo: 'b' },
      ],
    }), opcoes), /acima do limite/);
  });

  it('preserva o status de recusa do modelo', () => {
    const correcao = interpretarCorrecao(JSON.stringify({
      status: 'nao_corrigido',
      motivo: 'o trecho relevante nao estava visivel',
      alteracoes: [],
    }), opcoes);

    assert.equal(correcao.status, 'nao_corrigido');
    assert.match(correcao.motivo, /nao estava visivel/);
  });
});
