import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  estimarCustoEmDolar,
  MARCADOR,
  publicarComentario,
  renderizarComentario,
} from '../src/comentario.mjs';

const CONFIGURACAO = {
  provedor: 'anthropic',
  modelo: 'claude-opus-5',
  modo: 'bloqueante',
  severidadeDeBloqueio: 'Critical',
  bloquearQuandoApiFalhar: false,
};

const CONTEXTO = {
  itens: [{ caminho: 'src/A.js' }],
  naoEnviados: [],
  caracteresTotais: 1234,
  segredosRedigidos: 0,
};

const CONTEXTO_DO_LINK = {
  servidor: 'https://github.com',
  repositorio: 'usuario/meu-repositorio',
  sha: 'abc1234',
};

const PROVEDOR = { nome: 'anthropic', modelo: 'claude-opus-5' };

describe('renderizarComentario', () => {
  it('inclui o marcador de identificacao', () => {
    const corpo = renderizarComentario({
      resultado: { resumo: 'ok', apontamentos: [], descartados: [], excedentes: 0 },
      configuracao: CONFIGURACAO,
      contexto: CONTEXTO,
      verificacoes: [],
      bloqueio: { deveBloquear: false },
      provedor: PROVEDOR,
      contextoDoLink: CONTEXTO_DO_LINK,
    });

    assert.ok(corpo.startsWith(MARCADOR));
  });

  it('anuncia revisao limpa quando nao ha apontamentos', () => {
    const corpo = renderizarComentario({
      resultado: { resumo: 'PR simples.', apontamentos: [], descartados: [], excedentes: 0 },
      configuracao: CONFIGURACAO,
      contexto: CONTEXTO,
      verificacoes: [{ nome: 'npm test', situacao: 'sucesso', detalhe: '12 passed' }],
      bloqueio: { deveBloquear: false },
      provedor: PROVEDOR,
      contextoDoLink: CONTEXTO_DO_LINK,
    });

    assert.match(corpo, /Revisao concluida sem apontamentos/);
    assert.match(corpo, /npm test.*sucesso.*12 passed/);
  });

  it('renderiza o apontamento com permalink e marca de suspeita', () => {
    const corpo = renderizarComentario({
      resultado: {
        resumo: '',
        apontamentos: [
          {
            categoria: 'Erro de implementação',
            severidade: 'Critical',
            confianca: 'suspeita',
            arquivo: 'src/A.js',
            linha: 42,
            titulo: 'Retorno nao tratado quando a lista e vazia',
            descricao: 'Descrição.',
            explicacao: 'Explicação.',
            sugestao: 'Sugestão.',
            exemplo: 'var x = 1;',
          },
        ],
        descartados: [],
        excedentes: 0,
      },
      configuracao: CONFIGURACAO,
      contexto: CONTEXTO,
      verificacoes: [],
      bloqueio: { deveBloquear: true, motivo: '1 apontamento Critical' },
      provedor: PROVEDOR,
      contextoDoLink: CONTEXTO_DO_LINK,
    });

    assert.match(
      corpo,
      /https:\/\/github\.com\/usuario\/meu-repositorio\/blob\/abc1234\/src\/A\.js#L42/,
    );
    assert.match(corpo, /suspeita, nao confirmada/);
    assert.match(corpo, /```javascript/);
    assert.match(corpo, /Merge bloqueado por esta revisao/);
  });

  it('codifica espacos no permalink do arquivo', () => {
    const corpo = renderizarComentario({
      resultado: {
        resumo: '',
        apontamentos: [
          {
            categoria: 'Qualidade',
            severidade: 'Low',
            confianca: 'confirmado',
            arquivo: 'src/modulo/2 - relatorios/Relatorio.js',
            linha: 7,
            titulo: 'Titulo',
            descricao: 'Descricao.',
            explicacao: '',
            sugestao: '',
            exemplo: '',
          },
        ],
        descartados: [],
        excedentes: 0,
      },
      configuracao: CONFIGURACAO,
      contexto: CONTEXTO,
      verificacoes: [],
      bloqueio: { deveBloquear: false },
      provedor: PROVEDOR,
      contextoDoLink: CONTEXTO_DO_LINK,
    });

    assert.match(corpo, /blob\/abc1234\/src\/modulo\/2%20-%20relatorios\/Relatorio\.js#L7/);
    assert.doesNotMatch(corpo, /\(https:\/\/github\.com[^)]* [^)]*\)/);
  });

  it('renderiza mensagem de falha sem apontamentos', () => {
    const corpo = renderizarComentario({
      configuracao: CONFIGURACAO,
      contexto: CONTEXTO,
      verificacoes: [],
      provedor: PROVEDOR,
      contextoDoLink: CONTEXTO_DO_LINK,
      falha: 'Provedor respondeu 500.',
    });

    assert.match(corpo, /A revisao nao pode ser concluida/);
    assert.match(corpo, /Provedor respondeu 500/);
    assert.match(corpo, /nao foi reprovado por isso/);
  });
});

describe('estimarCustoEmDolar', () => {
  it('calcula o custo para modelo conhecido', () => {
    const custo = estimarCustoEmDolar('claude-opus-5', {
      tokensDeEntrada: 1_000_000,
      tokensDeSaida: 0,
      tokensLidosDoCache: 0,
      tokensGravadosNoCache: 0,
    });

    assert.equal(custo, 5);
  });

  it('cobra leitura de cache com desconto', () => {
    const custo = estimarCustoEmDolar('claude-opus-5', {
      tokensDeEntrada: 0,
      tokensDeSaida: 0,
      tokensLidosDoCache: 1_000_000,
      tokensGravadosNoCache: 0,
    });

    assert.equal(custo, 0.5);
  });

  it('devolve null para modelo desconhecido', () => {
    assert.equal(estimarCustoEmDolar('gpt-revisor', { tokensDeEntrada: 1 }), null);
  });
});

describe('publicarComentario', () => {
  it('atualiza o comentario existente em vez de criar outro', async () => {
    const chamadas = [];

    const cliente = {
      listarComentarios: async () => [
        { id: 1, body: 'comentário de alguém' },
        { id: 2, body: `${MARCADOR}\n## Revisão anterior` },
      ],
      criarComentario: async (...argumentos) => chamadas.push(['criar', ...argumentos]),
      atualizarComentario: async (...argumentos) => chamadas.push(['atualizar', ...argumentos]),
    };

    await publicarComentario({ cliente, numeroDoPr: 10, corpo: 'novo corpo' });

    assert.deepEqual(chamadas, [['atualizar', 2, 'novo corpo']]);
  });

  it('cria o comentario quando ainda nao existe', async () => {
    const chamadas = [];

    const cliente = {
      listarComentarios: async () => [{ id: 1, body: 'outro assunto' }],
      criarComentario: async (...argumentos) => chamadas.push(['criar', ...argumentos]),
      atualizarComentario: async () => assert.fail('não deveria atualizar'),
    };

    await publicarComentario({ cliente, numeroDoPr: 10, corpo: 'corpo' });

    assert.deepEqual(chamadas, [['criar', 10, 'corpo']]);
  });
});
