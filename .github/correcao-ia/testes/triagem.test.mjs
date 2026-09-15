import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { decidirTriagem } from '../src/index.mjs';

afterEach(() => {
  delete process.env.CORRECAO_NUMERO_ISSUE;
});

const CONFIGURACAO = {
  rotulosDeBug: ['bug'],
  prefixosDeTitulo: ['[BUG]'],
  comandoDeReanalise: '/analisar-bug',
  rotuloEmAndamento: 'correcao-ia:em-andamento',
  rotuloConcluido: 'correcao-ia:analisada',
  limites: { maxCaracteresDaIssue: 5000, maxComentariosDaIssue: 10 },
};

/** Cliente que responde a permissao pedida, sem rede. */
function clienteComPermissao(permissao) {
  return { permissaoDoUsuario: async () => permissao };
}

function issue(extra = {}) {
  return {
    number: 10,
    title: '[BUG] Cor errada',
    body: 'descricao',
    labels: [{ name: 'bug' }],
    user: { login: 'autor' },
    state: 'open',
    ...extra,
  };
}

describe('decidirTriagem', () => {
  it('processa Issue de bug recem aberta', async () => {
    const decisao = await decidirTriagem({
      evento: { action: 'opened', issue: issue() },
      nomeDoEvento: 'issues',
      configuracao: CONFIGURACAO,
      cliente: clienteComPermissao('write'),
    });

    assert.equal(decisao.processar, true);
    assert.equal(decisao.numero, 10);
  });

  // Regressao: no evento `issues` o Actions define CORRECAO_NUMERO_ISSUE como
  // string vazia, porque a expressao `inputs.numero_da_issue` nao existe ali.
  // Com `??`, a string vazia vencia o numero do payload e toda Issue real era
  // recusada com "evento sem numero de Issue valido".
  it('usa o numero do payload quando a variavel de ambiente vem vazia', async () => {
    process.env.CORRECAO_NUMERO_ISSUE = '';

    const decisao = await decidirTriagem({
      evento: { action: 'opened', issue: issue() },
      nomeDoEvento: 'issues',
      configuracao: CONFIGURACAO,
      cliente: clienteComPermissao('write'),
    });

    assert.equal(decisao.numero, 10);
    assert.equal(decisao.processar, true);
  });

  it('usa a variavel de ambiente quando o workflow e disparado a mao', async () => {
    process.env.CORRECAO_NUMERO_ISSUE = '77';

    const decisao = await decidirTriagem({
      evento: { issue: issue() },
      nomeDoEvento: 'workflow_dispatch',
      configuracao: CONFIGURACAO,
      cliente: clienteComPermissao('write'),
    });

    assert.equal(decisao.numero, 77);
  });

  it('recusa numero nao inteiro vindo do disparo manual', async () => {
    process.env.CORRECAO_NUMERO_ISSUE = '12; rm -rf /';

    const decisao = await decidirTriagem({
      evento: { issue: issue() },
      nomeDoEvento: 'workflow_dispatch',
      configuracao: CONFIGURACAO,
      cliente: clienteComPermissao('write'),
    });

    assert.equal(decisao.numero, null);
    assert.equal(decisao.processar, false);
  });

  it('ignora Issue que nao e bug', async () => {
    const decisao = await decidirTriagem({
      evento: { action: 'opened', issue: issue({ title: 'Ideia nova', labels: [] }) },
      nomeDoEvento: 'issues',
      configuracao: CONFIGURACAO,
      cliente: clienteComPermissao('write'),
    });

    assert.equal(decisao.processar, false);
    assert.match(decisao.motivo, /nao e um bug/);
  });

  it('ignora evento que na verdade e de Pull Request', async () => {
    const decisao = await decidirTriagem({
      evento: { action: 'opened', issue: issue({ pull_request: { url: 'x' } }) },
      nomeDoEvento: 'issues',
      configuracao: CONFIGURACAO,
      cliente: clienteComPermissao('write'),
    });

    assert.equal(decisao.processar, false);
    assert.match(decisao.motivo, /Pull Request/);
  });

  it('ignora Issue fechada', async () => {
    const decisao = await decidirTriagem({
      evento: { action: 'edited', issue: issue({ state: 'closed' }) },
      nomeDoEvento: 'issues',
      configuracao: CONFIGURACAO,
      cliente: clienteComPermissao('write'),
    });

    assert.equal(decisao.processar, false);
    assert.match(decisao.motivo, /fechada/);
  });

  it('ignora evento sem numero de Issue valido', async () => {
    const decisao = await decidirTriagem({
      evento: { action: 'opened', issue: { number: 'muitos' } },
      nomeDoEvento: 'issues',
      configuracao: CONFIGURACAO,
      cliente: clienteComPermissao('write'),
    });

    assert.equal(decisao.processar, false);
    assert.equal(decisao.numero, null);
  });

  it('nao reprocessa quando ja existe analise em andamento', async () => {
    const decisao = await decidirTriagem({
      evento: {
        action: 'edited',
        issue: issue({ labels: [{ name: 'bug' }, { name: 'correcao-ia:em-andamento' }] }),
      },
      nomeDoEvento: 'issues',
      configuracao: CONFIGURACAO,
      cliente: clienteComPermissao('write'),
    });

    assert.equal(decisao.processar, false);
    assert.match(decisao.motivo, /em andamento/);
  });

  it('nao reprocessa edicao de Issue ja analisada', async () => {
    const decisao = await decidirTriagem({
      evento: {
        action: 'edited',
        issue: issue({ labels: [{ name: 'bug' }, { name: 'correcao-ia:analisada' }] }),
      },
      nomeDoEvento: 'issues',
      configuracao: CONFIGURACAO,
      cliente: clienteComPermissao('write'),
    });

    assert.equal(decisao.processar, false);
    assert.match(decisao.motivo, /ja foi analisada/);
  });

  it('processa quando o rotulo bug e adicionado depois', async () => {
    const decisao = await decidirTriagem({
      evento: { action: 'labeled', label: { name: 'bug' }, issue: issue() },
      nomeDoEvento: 'issues',
      configuracao: CONFIGURACAO,
      cliente: clienteComPermissao('write'),
    });

    assert.equal(decisao.processar, true);
  });

  it('ignora a adicao de um rotulo que nao e de bug', async () => {
    const decisao = await decidirTriagem({
      evento: { action: 'labeled', label: { name: 'documentacao' }, issue: issue() },
      nomeDoEvento: 'issues',
      configuracao: CONFIGURACAO,
      cliente: clienteComPermissao('write'),
    });

    assert.equal(decisao.processar, false);
    assert.match(decisao.motivo, /nao e de bug/);
  });

  it('processa reanalise pedida por quem tem permissao de escrita', async () => {
    const decisao = await decidirTriagem({
      evento: {
        action: 'created',
        issue: issue({ labels: [{ name: 'bug' }, { name: 'correcao-ia:analisada' }] }),
        comment: { body: '/analisar-bug', user: { login: 'mantenedor' } },
      },
      nomeDoEvento: 'issue_comment',
      configuracao: CONFIGURACAO,
      cliente: clienteComPermissao('write'),
    });

    assert.equal(decisao.processar, true);
  });

  it('recusa reanalise pedida por quem nao tem permissao de escrita', async () => {
    const decisao = await decidirTriagem({
      evento: {
        action: 'created',
        issue: issue(),
        comment: { body: '/analisar-bug', user: { login: 'visitante' } },
      },
      nomeDoEvento: 'issue_comment',
      configuracao: CONFIGURACAO,
      cliente: clienteComPermissao('read'),
    });

    assert.equal(decisao.processar, false);
    assert.match(decisao.motivo, /permissao de escrita/);
  });

  it('ignora comentario comum, mesmo de mantenedor', async () => {
    const decisao = await decidirTriagem({
      evento: {
        action: 'created',
        issue: issue(),
        comment: { body: 'acontece comigo tambem', user: { login: 'mantenedor' } },
      },
      nomeDoEvento: 'issue_comment',
      configuracao: CONFIGURACAO,
      cliente: clienteComPermissao('admin'),
    });

    assert.equal(decisao.processar, false);
    assert.match(decisao.motivo, /nao contem o comando/);
  });

  it('ignora comentario que apenas menciona o comando no meio do texto', async () => {
    const decisao = await decidirTriagem({
      evento: {
        action: 'created',
        issue: issue(),
        comment: { body: 'tentei usar /analisar-bug e nao rolou', user: { login: 'mantenedor' } },
      },
      nomeDoEvento: 'issue_comment',
      configuracao: CONFIGURACAO,
      cliente: clienteComPermissao('admin'),
    });

    assert.equal(decisao.processar, false);
  });
});
