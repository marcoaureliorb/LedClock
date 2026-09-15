import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  avaliarValidacoes,
  executarValidacao,
  executarValidacoes,
  selecionarValidacoes,
} from '../src/validacoes.mjs';

function validacao(extra = {}) {
  return {
    chave: 'build',
    habilitada: true,
    descricao: '',
    gatilho: ['src/**'],
    comando: ['pio', 'run', '-e', 'esp12e'],
    diretorio: '.',
    obrigatoria: true,
    timeoutEmSegundos: 60,
    ...extra,
  };
}

const CONFIGURACAO = {
  validacoes: [
    validacao(),
    validacao({ chave: 'web', gatilho: ['data/**/*.js'], comando: ['node', '--check', 'data/app.js'] }),
    validacao({ chave: 'desligada', habilitada: false, gatilho: ['**/*'] }),
    validacao({ chave: 'sempre', gatilho: [] }),
  ],
};

describe('selecionarValidacoes', () => {
  it('seleciona apenas o que o gatilho alcanca', () => {
    const chaves = selecionarValidacoes(['src/main.cpp'], CONFIGURACAO).map((item) => item.chave);

    assert.deepEqual(chaves.sort(), ['build', 'sempre']);
  });

  it('seleciona a validacao da interface quando o js muda', () => {
    const chaves = selecionarValidacoes(['data/app.js'], CONFIGURACAO).map((item) => item.chave);

    assert.deepEqual(chaves.sort(), ['sempre', 'web']);
  });

  it('ignora validacao desabilitada', () => {
    const chaves = selecionarValidacoes(['qualquer.txt'], CONFIGURACAO).map((item) => item.chave);

    assert.equal(chaves.includes('desligada'), false);
  });

  it('validacao sem gatilho roda sempre', () => {
    const chaves = selecionarValidacoes([], CONFIGURACAO).map((item) => item.chave);

    assert.deepEqual(chaves, ['sempre']);
  });
});

describe('executarValidacao', () => {
  it('executa o comando sem shell e com os argumentos separados', () => {
    const chamadas = [];

    const falso = (programa, argumentos, opcoes) => {
      chamadas.push({ programa, argumentos, opcoes });

      return { status: 0, stdout: 'tudo certo', stderr: '' };
    };

    const resultado = executarValidacao(validacao(), '/repo', falso);

    assert.equal(chamadas[0].programa, 'pio');
    assert.deepEqual(chamadas[0].argumentos, ['run', '-e', 'esp12e']);
    assert.equal(chamadas[0].opcoes.shell, false);
    assert.equal(resultado.situacao, 'sucesso');
  });

  it('marca falha quando o codigo de saida nao e zero', () => {
    const falso = () => ({ status: 1, stdout: '', stderr: 'erro de compilacao' });

    const resultado = executarValidacao(validacao(), '/repo', falso);

    assert.equal(resultado.situacao, 'falhou');
    assert.match(resultado.saida, /erro de compilacao/);
  });

  it('marca indisponivel quando o programa nao existe', () => {
    const falso = () => ({ error: Object.assign(new Error('nao encontrado'), { code: 'ENOENT' }) });

    const resultado = executarValidacao(validacao(), '/repo', falso);

    assert.equal(resultado.situacao, 'indisponivel');
    assert.match(resultado.detalhe, /nao esta disponivel/);
  });

  it('marca falha quando o comando estoura o tempo limite', () => {
    const falso = () => ({ signal: 'SIGTERM', stdout: '', stderr: '' });

    const resultado = executarValidacao(validacao(), '/repo', falso);

    assert.equal(resultado.situacao, 'falhou');
    assert.match(resultado.detalhe, /SIGTERM/);
  });

  it('trunca saida muito longa mantendo o final', () => {
    const falso = () => ({ status: 1, stdout: 'x'.repeat(10000), stderr: 'ULTIMA LINHA' });

    const resultado = executarValidacao(validacao(), '/repo', falso);

    assert.ok(resultado.saida.length < 4000);
    assert.match(resultado.saida, /ULTIMA LINHA/);
  });
});

describe('executarValidacoes', () => {
  it('executa cada validacao selecionada', () => {
    const falso = () => ({ status: 0, stdout: '', stderr: '' });

    const resultados = executarValidacoes([validacao(), validacao({ chave: 'web' })], '/repo', falso);

    assert.equal(resultados.length, 2);
  });
});

describe('avaliarValidacoes', () => {
  it('aprova quando tudo passa', () => {
    const avaliacao = avaliarValidacoes([{ chave: 'build', situacao: 'sucesso', obrigatoria: true }]);

    assert.equal(avaliacao.aprovado, true);
  });

  it('reprova quando alguma falha', () => {
    const avaliacao = avaliarValidacoes([
      { chave: 'build', situacao: 'falhou', obrigatoria: true },
      { chave: 'web', situacao: 'sucesso', obrigatoria: true },
    ]);

    assert.equal(avaliacao.aprovado, false);
    assert.match(avaliacao.motivo, /build/);
  });

  it('reprova quando validacao obrigatoria nao pode rodar', () => {
    const avaliacao = avaliarValidacoes([
      { chave: 'build', situacao: 'indisponivel', obrigatoria: true },
    ]);

    assert.equal(avaliacao.aprovado, false);
    assert.match(avaliacao.motivo, /nao pode ser executada/);
  });

  it('tolera validacao opcional indisponivel', () => {
    const avaliacao = avaliarValidacoes([
      { chave: 'build', situacao: 'sucesso', obrigatoria: true },
      { chave: 'lint', situacao: 'indisponivel', obrigatoria: false },
    ]);

    assert.equal(avaliacao.aprovado, true);
  });

  it('reprova quando nenhuma validacao foi aplicavel', () => {
    const avaliacao = avaliarValidacoes([]);

    assert.equal(avaliacao.aprovado, false);
    assert.match(avaliacao.motivo, /nenhuma validacao/);
  });
});
