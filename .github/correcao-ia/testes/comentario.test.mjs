import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MARCADOR,
  montarMensagemDeCommit,
  montarTituloDoPullRequest,
  renderizarComentarioDeAnaliseManual,
  renderizarComentarioDeInterrupcao,
  renderizarComentarioDePullRequest,
  renderizarComentarioDePullRequestExistente,
  renderizarComentarioDeValidacaoReprovada,
  renderizarDescricaoDoPullRequest,
} from '../src/comentario.mjs';

const ISSUE = { numero: 123, titulo: '[BUG] Cor do digito errada' };

const ANALISE = {
  status: 'identified',
  confianca: 0.88,
  resumo: 'O laco escreve um LED a mais.',
  causaRaiz: 'O limite do laco usa <= em vez de <.',
  solucaoProposta: 'Corrigir o limite do laco.',
  arquivosAfetados: ['src/main.cpp'],
  arquivosDescartados: [],
  arquivosExcedentes: 0,
  planoDeImplementacao: ['Ajustar o limite'],
  testesSugeridos: ['pio run -e esp12e'],
  analiseManual: null,
  arquivosInvestigados: ['src/main.cpp', 'data/app.js'],
  buscasRealizadas: ['setDecoColorAll'],
};

const CORRECAO = {
  status: 'corrigido',
  resumo: 'Ajusta o limite do laco de LEDs da linha 2.',
  mensagemDeCommit: 'corrige o limite do laco de LEDs da decoracao',
  alteracoes: [{ caminho: 'src/main.cpp', descricao: 'ajusta o limite' }],
};

const RESULTADOS = [
  { chave: 'build', comando: 'pio run -e esp12e', situacao: 'sucesso', detalhe: 'concluida sem erros' },
];

describe('renderizarComentarioDeAnaliseManual', () => {
  it('deixa explicito que nada foi alterado', () => {
    const corpo = renderizarComentarioDeAnaliseManual({
      analise: { ...ANALISE, status: 'uncertain' },
      issue: ISSUE,
    });

    assert.ok(corpo.startsWith(MARCADOR));
    assert.match(corpo, /Nenhuma alteracao foi realizada no codigo/);
    assert.match(corpo, /nenhum Pull Request/);
  });

  it('lista os arquivos investigados e as buscas feitas', () => {
    const corpo = renderizarComentarioDeAnaliseManual({
      analise: { ...ANALISE, status: 'not_found' },
      issue: ISSUE,
    });

    assert.match(corpo, /src\/main\.cpp/);
    assert.match(corpo, /setDecoColorAll/);
  });

  it('diferencia not_found de uncertain', () => {
    const naoEncontrado = renderizarComentarioDeAnaliseManual({
      analise: { ...ANALISE, status: 'not_found' },
      issue: ISSUE,
    });

    const incerto = renderizarComentarioDeAnaliseManual({
      analise: { ...ANALISE, status: 'uncertain' },
      issue: ISSUE,
    });

    assert.match(naoEncontrado, /nao conseguiu identificar a causa/);
    assert.match(incerto, /nao reuniu evidencias suficientes/);
  });

  it('avisa que a confianca e estimativa da propria IA', () => {
    const corpo = renderizarComentarioDeAnaliseManual({
      analise: { ...ANALISE, status: 'uncertain' },
      issue: ISSUE,
    });

    assert.match(corpo, /nao evidencia de correcao/);
  });

  it('sugere o que falta quando a IA nao preencheu manual_analysis', () => {
    const corpo = renderizarComentarioDeAnaliseManual({
      analise: { ...ANALISE, status: 'uncertain', analiseManual: null },
      issue: ISSUE,
    });

    assert.match(corpo, /Passos para reproduzir/);
  });
});

describe('renderizarComentarioDeValidacaoReprovada', () => {
  it('explica que o Pull Request nao foi aberto e mostra a saida do erro', () => {
    const corpo = renderizarComentarioDeValidacaoReprovada({
      analise: ANALISE,
      issue: ISSUE,
      branch: 'automated-error-analysis/cor-do-digito-123',
      avaliacao: { aprovado: false, motivo: '1 validacao(oes) falharam: build' },
      resultados: [{
        chave: 'build',
        comando: 'pio run -e esp12e',
        situacao: 'falhou',
        detalhe: 'terminou com codigo 1',
        saida: "main.cpp:412: error: expected ';'",
      }],
    });

    assert.match(corpo, /Nenhum Pull Request foi aberto/);
    assert.match(corpo, /expected ';'/);
    assert.match(corpo, /Nenhuma alteracao foi publicada/);
  });
});

describe('renderizarComentarioDeInterrupcao', () => {
  it('nomeia a etapa e afirma que o codigo nao foi alterado', () => {
    const corpo = renderizarComentarioDeInterrupcao({
      issue: ISSUE,
      etapa: 'aplicacao da correcao',
      mensagem: 'o trecho original nao foi encontrado',
      detalhes: ['substituicao exata'],
    });

    assert.match(corpo, /aplicacao da correcao/);
    assert.match(corpo, /nao alterou o codigo/);
    assert.match(corpo, /substituicao exata/);
  });
});

describe('renderizarComentarioDePullRequest', () => {
  it('traz o link e exige revisao humana', () => {
    const corpo = renderizarComentarioDePullRequest({
      issue: ISSUE,
      analise: ANALISE,
      branch: 'automated-error-analysis/cor-do-digito-123',
      pullRequest: { html_url: 'https://github.com/x/y/pull/9' },
    });

    assert.match(corpo, /pull\/9/);
    assert.match(corpo, /revisao humana/);
    assert.match(corpo, /nao aprova/);
  });
});

describe('renderizarComentarioDePullRequestExistente', () => {
  it('avisa que nenhum PR adicional foi aberto', () => {
    const corpo = renderizarComentarioDePullRequestExistente({
      issue: ISSUE,
      branch: 'automated-error-analysis/cor-do-digito-123',
      pullRequest: { html_url: 'https://github.com/x/y/pull/9' },
    });

    assert.match(corpo, /Pull Request adicional foi aberto/);
  });
});

describe('renderizarDescricaoDoPullRequest', () => {
  const corpo = renderizarDescricaoDoPullRequest({
    issue: ISSUE,
    analise: ANALISE,
    correcao: CORRECAO,
    arquivosAlterados: ['src/main.cpp'],
    resultados: RESULTADOS,
    provedor: { nome: 'azure-openai', modelo: 'gpt-4o' },
  });

  it('referencia a Issue com Fixes', () => {
    assert.match(corpo, /Fixes #123/);
  });

  it('descreve causa, solucao e arquivos alterados', () => {
    assert.match(corpo, /O limite do laco usa <= em vez de </);
    assert.match(corpo, /Ajusta o limite do laco/);
    assert.match(corpo, /`src\/main\.cpp`/);
  });

  it('marca as validacoes executadas', () => {
    assert.match(corpo, /\[x\] `pio run -e esp12e`/);
  });

  it('marca as validacoes que nao passaram como nao concluidas', () => {
    const outro = renderizarDescricaoDoPullRequest({
      issue: ISSUE,
      analise: ANALISE,
      correcao: CORRECAO,
      arquivosAlterados: ['src/main.cpp'],
      resultados: [{ comando: 'pio run', situacao: 'indisponivel', detalhe: 'ausente' }],
      provedor: { nome: 'azure-openai', modelo: 'gpt-4o' },
    });

    assert.match(outro, /\[ \] `pio run`/);
  });

  it('identifica a origem em IA e exige revisao humana', () => {
    assert.match(corpo, /gerada por um agente de IA/);
    assert.match(corpo, /revisao humana e obrigatoria/);
  });

  it('separa as validacoes sugeridas pela IA das executadas', () => {
    assert.match(corpo, /informativo, nao executadas automaticamente/);
  });
});

describe('montarTituloDoPullRequest', () => {
  it('usa o prefixo fix: e a mensagem sugerida pelo modelo', () => {
    assert.equal(
      montarTituloDoPullRequest(ISSUE, CORRECAO),
      'fix: corrige o limite do laco de LEDs da decoracao',
    );
  });

  it('cai para o titulo da Issue sem o prefixo [BUG]', () => {
    assert.equal(
      montarTituloDoPullRequest(ISSUE, { ...CORRECAO, mensagemDeCommit: '' }),
      'fix: cor do digito errada',
    );
  });

  it('limita o tamanho do titulo', () => {
    const titulo = montarTituloDoPullRequest(ISSUE, { mensagemDeCommit: 'x'.repeat(300) });

    assert.ok(titulo.length <= 120);
  });
});

describe('montarMensagemDeCommit', () => {
  it('referencia a Issue e declara a origem em IA', () => {
    const mensagem = montarMensagemDeCommit(ISSUE, CORRECAO);

    assert.match(mensagem, /^fix: /);
    assert.match(mensagem, /Refs #123/);
    assert.match(mensagem, /agente de IA/);
  });
});
