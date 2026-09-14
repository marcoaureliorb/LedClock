import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { anotarPatch, montarContexto, selecionarArquivos } from '../src/diff.mjs';

const CONFIGURACAO = {
  incluir: ['**/*.cs', '**/*.py'],
  excluir: ['**/obj/**', '**/appsettings*.json'],
  limites: {
    maxArquivos: 3,
    maxCaracteresTotal: 1000,
    maxCaracteresPorArquivo: 300,
    maxLinhasParaArquivoCompleto: 10,
  },
};

describe('anotarPatch', () => {
  it('numera linhas do arquivo novo a partir do cabecalho do hunk', () => {
    const patch = ['@@ -10,3 +10,4 @@', ' contexto', '+nova', ' depois'].join('\n');

    const linhas = anotarPatch(patch).split('\n');

    assert.equal(linhas[0], '@@ -10,3 +10,4 @@');
    assert.match(linhas[1], /^ {4}10 \| contexto$/);
    assert.match(linhas[2], /^\+ {3}11 \| nova$/);
    assert.match(linhas[3], /^ {4}12 \| depois$/);
  });

  it('nao consome numero em linha removida', () => {
    const patch = ['@@ -1,2 +1,1 @@', '-removida', ' mantida'].join('\n');

    const linhas = anotarPatch(patch).split('\n');

    assert.match(linhas[1], /^- {6}\| removida$/);
    assert.match(linhas[2], /^ {5}1 \| mantida$/);
  });

  it('retoma a numeracao no segundo hunk', () => {
    const patch = ['@@ -1,1 +1,1 @@', ' a', '@@ -50,1 +80,1 @@', '+b'].join('\n');

    const linhas = anotarPatch(patch).split('\n');

    assert.match(linhas[3], /^\+ {3}80 \| b$/);
  });

  it('devolve string vazia para patch ausente', () => {
    assert.equal(anotarPatch(undefined), '');
  });
});

describe('selecionarArquivos', () => {
  it('mantem apenas arquivos de codigo com diff', () => {
    const { selecionados, ignorados } = selecionarArquivos(
      [
        { filename: 'src/A.cs', status: 'modified', patch: '@@ -1 +1 @@', additions: 1, deletions: 0 },
        { filename: 'src/obj/B.cs', status: 'modified', patch: '@@' },
        { filename: 'src/appsettings.json', status: 'modified', patch: '@@' },
        { filename: 'src/C.dll', status: 'added', patch: undefined },
        { filename: 'src/D.cs', status: 'removed', patch: '@@' },
        { filename: 'src/E.cs', status: 'modified' },
      ],
      CONFIGURACAO,
    );

    assert.deepEqual(selecionados.map((item) => item.caminho), ['src/A.cs']);

    const motivos = Object.fromEntries(ignorados.map((item) => [item.caminho, item.motivo]));

    assert.match(motivos['src/obj/B.cs'], /excluido por/);
    assert.match(motivos['src/appsettings.json'], /excluido por/);
    assert.match(motivos['src/C.dll'], /extensao fora/);
    assert.equal(motivos['src/D.cs'], 'arquivo removido');
    assert.match(motivos['src/E.cs'], /sem diff textual/);
  });

  it('registra o nome anterior de arquivo renomeado', () => {
    const { selecionados } = selecionarArquivos(
      [
        {
          filename: 'src/Novo.cs',
          previous_filename: 'src/Antigo.cs',
          status: 'renamed',
          patch: '@@ -1 +1 @@',
        },
      ],
      CONFIGURACAO,
    );

    assert.equal(selecionados[0].caminhoAnterior, 'src/Antigo.cs');
  });
});

describe('montarContexto', () => {
  const arquivo = (caminho, tamanhoDoPatch = 50) => ({
    caminho,
    status: 'modified',
    adicoes: 1,
    remocoes: 0,
    caminhoAnterior: null,
    patch: `@@ -1,1 +1,1 @@\n+${'x'.repeat(tamanhoDoPatch)}`,
  });

  it('respeita o limite de arquivos', () => {
    const { itens, naoEnviados } = montarContexto({
      selecionados: ['a.cs', 'b.cs', 'c.cs', 'd.cs'].map((nome) => arquivo(nome)),
      configuracao: CONFIGURACAO,
      lerArquivo: () => null,
    });

    assert.equal(itens.length, 3);
    assert.equal(naoEnviados.length, 1);
    assert.match(naoEnviados[0].motivo, /limite de 3 arquivos/);
  });

  it('trunca diff maior que o limite por arquivo', () => {
    const { itens } = montarContexto({
      selecionados: [arquivo('a.cs', 500)],
      configuracao: CONFIGURACAO,
      lerArquivo: () => null,
    });

    assert.equal(itens[0].diffTruncado, true);
    assert.match(itens[0].diff, /\[\.\.\. diff truncado \.\.\.\]$/);
  });

  it('inclui o arquivo integral quando ele e pequeno', () => {
    const { itens } = montarContexto({
      selecionados: [arquivo('a.cs')],
      configuracao: CONFIGURACAO,
      lerArquivo: () => 'linha1\nlinha2',
    });

    assert.equal(itens[0].conteudoIntegral, 'linha1\nlinha2');
  });

  it('omite o arquivo integral quando ele excede o limite de linhas', () => {
    const { itens } = montarContexto({
      selecionados: [arquivo('a.cs')],
      configuracao: CONFIGURACAO,
      lerArquivo: () => Array.from({ length: 50 }, (_, i) => `linha ${i}`).join('\n'),
    });

    assert.equal(itens[0].conteudoIntegral, null);
  });

  it('redige segredos antes de compor o contexto', () => {
    const comSegredo = {
      ...arquivo('a.cs'),
      patch: '@@ -1,1 +1,1 @@\n+var s = "ClientSecret": "valorSuperSecreto";',
    };

    const { itens, segredosRedigidos } = montarContexto({
      selecionados: [comSegredo],
      configuracao: CONFIGURACAO,
      lerArquivo: () => null,
    });

    assert.ok(segredosRedigidos >= 1);
    assert.doesNotMatch(itens[0].diff, /valorSuperSecreto/);
  });

  it('mantem ao menos um arquivo mesmo acima do orcamento total', () => {
    const configuracaoApertada = {
      ...CONFIGURACAO,
      limites: { ...CONFIGURACAO.limites, maxCaracteresTotal: 10, maxCaracteresPorArquivo: 5000 },
    };

    const { itens } = montarContexto({
      selecionados: [arquivo('a.cs', 400), arquivo('b.cs', 400)],
      configuracao: configuracaoApertada,
      lerArquivo: () => null,
    });

    assert.equal(itens.length, 1);
  });
});
