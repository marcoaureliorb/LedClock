import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AlteracaoInaplicavelError,
  aplicarAlteracoes,
  resumirAlteracoes,
} from '../src/alteracoes.mjs';

const ARQUIVO = [
  'void setDecoColorAll(uint8_t line) {',
  '  for (uint8_t i = line * 7; i <= line * 7 + 6; i++) {',
  '    clockDecoColor[i] = cor;',
  '  }',
  '}',
].join('\n');

function mapa(entradas) {
  return new Map(entradas);
}

describe('aplicarAlteracoes', () => {
  it('substitui o trecho exato', () => {
    const conteudo = mapa([['src/main.cpp', ARQUIVO]]);

    const { resultado, aplicadas } = aplicarAlteracoes(conteudo, [
      {
        caminho: 'src/main.cpp',
        descricao: 'corrige o limite do laco',
        trechoOriginal: 'i <= line * 7 + 6',
        trechoNovo: 'i < line * 7 + 7',
      },
    ]);

    assert.ok(resultado.get('src/main.cpp').includes('i < line * 7 + 7'));
    assert.equal(resultado.get('src/main.cpp').includes('i <= line * 7 + 6'), false);
    assert.equal(aplicadas[0].tipo, 'edicao');
  });

  it('recusa trecho que nao existe no arquivo', () => {
    const conteudo = mapa([['src/main.cpp', ARQUIVO]]);

    assert.throws(
      () => aplicarAlteracoes(conteudo, [{
        caminho: 'src/main.cpp',
        trechoOriginal: 'trecho que o modelo imaginou',
        trechoNovo: 'x',
      }]),
      (erro) => erro instanceof AlteracaoInaplicavelError && /nao foi encontrado/.test(erro.message),
    );
  });

  it('recusa trecho ambiguo em vez de alterar a ocorrencia errada', () => {
    const conteudo = mapa([['src/main.cpp', 'valor = 1;\noutra();\nvalor = 1;\n']]);

    assert.throws(
      () => aplicarAlteracoes(conteudo, [{
        caminho: 'src/main.cpp',
        trechoOriginal: 'valor = 1;',
        trechoNovo: 'valor = 2;',
      }]),
      /aparece 2 vezes/,
    );
  });

  it('aplica alteracoes encadeadas no mesmo arquivo', () => {
    const conteudo = mapa([['src/main.cpp', 'a = 1;\nb = 2;\n']]);

    const { resultado } = aplicarAlteracoes(conteudo, [
      { caminho: 'src/main.cpp', trechoOriginal: 'a = 1;', trechoNovo: 'a = 10;' },
      { caminho: 'src/main.cpp', trechoOriginal: 'b = 2;', trechoNovo: 'b = 20;' },
    ]);

    assert.equal(resultado.get('src/main.cpp'), 'a = 10;\nb = 20;\n');
  });

  it('cria arquivo novo quando o trecho original e vazio', () => {
    const conteudo = mapa([['test/test_cor.cpp', null]]);

    const { resultado, aplicadas } = aplicarAlteracoes(conteudo, [{
      caminho: 'test/test_cor.cpp',
      descricao: 'teste do calculo de cor',
      trechoOriginal: '',
      trechoNovo: '#include <unity.h>',
    }]);

    assert.equal(resultado.get('test/test_cor.cpp'), '#include <unity.h>\n');
    assert.equal(aplicadas[0].tipo, 'criacao');
  });

  it('recusa criar arquivo que ja existe', () => {
    const conteudo = mapa([['src/main.cpp', ARQUIVO]]);

    assert.throws(
      () => aplicarAlteracoes(conteudo, [{
        caminho: 'src/main.cpp',
        trechoOriginal: '',
        trechoNovo: 'conteudo novo',
      }]),
      /ja existe/,
    );
  });

  it('recusa alterar arquivo que nao foi carregado', () => {
    const conteudo = mapa([['src/main.cpp', ARQUIVO]]);

    assert.throws(
      () => aplicarAlteracoes(conteudo, [{
        caminho: 'src/outro.cpp',
        trechoOriginal: 'x',
        trechoNovo: 'y',
      }]),
      /nao foi carregado/,
    );
  });

  it('casa o trecho mesmo quando o arquivo usa CRLF, e preserva o CRLF', () => {
    const conteudo = mapa([['data/app.js', 'const a = 1;\r\nconst b = 2;\r\n']]);

    const { resultado } = aplicarAlteracoes(conteudo, [{
      caminho: 'data/app.js',
      trechoOriginal: 'const a = 1;\nconst b = 2;',
      trechoNovo: 'const a = 1;\nconst b = 3;',
    }]);

    assert.equal(resultado.get('data/app.js'), 'const a = 1;\r\nconst b = 3;\r\n');
  });

  it('casa o trecho quando o modelo devolve o \\r solto de um arquivo CRLF', () => {
    const conteudo = mapa([['data/app.js', 'const baseUrl = origin;\r\nfunction x() {}\r\n']]);

    const { resultado } = aplicarAlteracoes(conteudo, [{
      caminho: 'data/app.js',
      // Terminado em "\r", como costuma vir de uma copia feita sobre CRLF.
      trechoOriginal: 'const baseUrl = origin;\r',
      trechoNovo: '// comentario\nconst baseUrl = origin;',
    }]);

    assert.equal(resultado.get('data/app.js'), '// comentario\r\nconst baseUrl = origin;\r\nfunction x() {}\r\n');
  });

  it('nao altera arquivos que nao foram citados', () => {
    const conteudo = mapa([['src/main.cpp', ARQUIVO], ['data/app.js', 'const x = 1;']]);

    const { resultado } = aplicarAlteracoes(conteudo, [{
      caminho: 'src/main.cpp',
      trechoOriginal: 'clockDecoColor[i] = cor;',
      trechoNovo: 'clockDecoColor[i] = novaCor;',
    }]);

    assert.equal(resultado.has('data/app.js'), false);
    assert.equal(resultado.size, 1);
  });
});

describe('resumirAlteracoes', () => {
  it('conta a variacao de linhas por arquivo', () => {
    const antes = mapa([['src/main.cpp', 'a\nb\nc\n']]);
    const depois = mapa([['src/main.cpp', 'a\nb\nc\nd\n']]);

    const [resumo] = resumirAlteracoes(antes, depois);

    assert.equal(resumo.caminho, 'src/main.cpp');
    assert.equal(resumo.variacao, 1);
    assert.equal(resumo.novo, false);
  });

  it('marca arquivo criado', () => {
    const antes = mapa([['test/novo.cpp', null]]);
    const depois = mapa([['test/novo.cpp', 'linha\n']]);

    assert.equal(resumirAlteracoes(antes, depois)[0].novo, true);
  });
});
