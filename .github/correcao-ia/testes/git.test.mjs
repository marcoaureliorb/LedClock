import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { criarGit, garantirBranchAutomatica } from '../src/git.mjs';

const CONFIGURACAO = { prefixoDaBranch: 'automated-error-analysis', branchBase: 'main' };

describe('garantirBranchAutomatica', () => {
  it('aceita a branch com o prefixo obrigatorio', () => {
    const branch = 'automated-error-analysis/cor-do-digito-12';

    assert.equal(garantirBranchAutomatica(branch, CONFIGURACAO), branch);
  });

  it('recusa a branch base', () => {
    assert.throws(() => garantirBranchAutomatica('main', CONFIGURACAO), /nao escreve na branch base/);
  });

  it('recusa branch sem o prefixo', () => {
    assert.throws(
      () => garantirBranchAutomatica('feat/nova-cor', CONFIGURACAO),
      /prefixo obrigatorio/,
    );
  });

  it('recusa prefixo parecido mas diferente', () => {
    assert.throws(
      () => garantirBranchAutomatica('automated-error-analysis-outro/x', CONFIGURACAO),
      /prefixo obrigatorio/,
    );
  });

  it('recusa nome vazio', () => {
    assert.throws(() => garantirBranchAutomatica('', CONFIGURACAO), /vazio/);
    assert.throws(() => garantirBranchAutomatica(null, CONFIGURACAO), /vazio/);
  });

  it('recusa caractere que nao pode aparecer no nome', () => {
    assert.throws(
      () => garantirBranchAutomatica('automated-error-analysis/Com Espaco', CONFIGURACAO),
      /caracteres nao permitidos/,
    );

    assert.throws(
      () => garantirBranchAutomatica('automated-error-analysis/a..b', CONFIGURACAO),
      /caracteres nao permitidos/,
    );
  });
});

describe('criarGit', () => {
  function gitFalso(respostas) {
    const chamadas = [];

    const executar = (programa, argumentos) => {
      chamadas.push({ programa, argumentos });

      const chave = argumentos[0];
      const resposta = respostas[chave] ?? { status: 0, stdout: '', stderr: '' };

      return typeof resposta === 'function' ? resposta(argumentos) : resposta;
    };

    return { git: criarGit('/repo', executar), chamadas };
  }

  it('chama o git sem shell', () => {
    const { git, chamadas } = gitFalso({ 'rev-parse': { status: 0, stdout: 'main\n' } });

    assert.equal(git.branchAtual(), 'main');
    assert.equal(chamadas[0].programa, 'git');
  });

  it('lanca erro descritivo quando o git falha', () => {
    const { git } = gitFalso({ checkout: { status: 128, stdout: '', stderr: 'referencia invalida' } });

    assert.throws(() => git.criarBranchNoCommit('automated-error-analysis/x-1', 'abc123'), /referencia invalida/);
  });

  it('lista os arquivos alterados a partir do status porcelain', () => {
    const { git } = gitFalso({
      status: { status: 0, stdout: ' M src/main.cpp\n?? data/novo.js\n' },
    });

    assert.deepEqual(git.arquivosAlterados(), ['src/main.cpp', 'data/novo.js']);
  });

  it('nao cria commit quando nada foi preparado', () => {
    const { git } = gitFalso({ diff: { status: 0, stdout: '' } });

    assert.deepEqual(git.commitar('fix: x', ['src/main.cpp']), { criado: false, sha: null });
  });

  it('recusa commit sem caminhos', () => {
    const { git } = gitFalso({});

    assert.throws(() => git.commitar('fix: x', []), /Nenhum caminho/);
  });

  it('adiciona somente os caminhos informados', () => {
    const { git, chamadas } = gitFalso({
      diff: { status: 0, stdout: 'src/main.cpp' },
      'rev-parse': { status: 0, stdout: 'deadbeef' },
    });

    git.commitar('fix: limite do laco', ['src/main.cpp']);

    const adicionar = chamadas.find((chamada) => chamada.argumentos[0] === 'add');

    assert.deepEqual(adicionar.argumentos, ['add', '--', 'src/main.cpp']);
  });

  it('publica a branch sem force', () => {
    const { git, chamadas } = gitFalso({});

    git.publicarBranch('automated-error-analysis/x-1');

    const push = chamadas.find((chamada) => chamada.argumentos[0] === 'push');

    assert.deepEqual(
      push.argumentos,
      ['push', 'origin', 'HEAD:refs/heads/automated-error-analysis/x-1'],
    );
    assert.equal(push.argumentos.includes('--force'), false);
  });

  it('detecta branch remota existente', () => {
    const { git } = gitFalso({
      'ls-remote': { status: 0, stdout: 'abc\trefs/heads/automated-error-analysis/x-1' },
    });

    assert.equal(git.branchRemotaExiste('automated-error-analysis/x-1'), true);
  });

  it('trata ausencia de branch remota como falso', () => {
    const { git } = gitFalso({ 'ls-remote': { status: 0, stdout: '' } });

    assert.equal(git.branchRemotaExiste('automated-error-analysis/x-1'), false);
  });
});
