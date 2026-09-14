import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { avaliarBloqueio, extrairJson, normalizarApontamentos } from '../src/apuracao.mjs';

const apontamentoValido = (extras = {}) => ({
  categoria: 'Erro de implementação',
  severidade: 'High',
  confianca: 'confirmado',
  arquivo: 'src/A.cs',
  linha: 42,
  titulo: 'Possível NullReferenceException',
  descricao: 'O retorno de ObterContrato pode ser nulo.',
  explicacao: 'A API devolve nulo quando o contrato não existe.',
  sugestao: 'Validar antes de usar.',
  exemplo: 'if (contrato is null) return ...;',
  ...extras,
});

describe('extrairJson', () => {
  it('interpreta JSON puro', () => {
    assert.deepEqual(extrairJson('{"resumo":"ok"}'), { resumo: 'ok' });
  });

  it('interpreta JSON dentro de cerca de codigo', () => {
    assert.deepEqual(extrairJson('```json\n{"resumo":"ok"}\n```'), { resumo: 'ok' });
  });

  it('interpreta JSON com texto antes e depois', () => {
    const bruto = 'Segue a revisão:\n{"resumo":"ok"}\nEspero ter ajudado.';

    assert.deepEqual(extrairJson(bruto), { resumo: 'ok' });
  });

  it('lanca erro descritivo para resposta vazia', () => {
    assert.throws(() => extrairJson('   '), /resposta vazia/);
  });

  it('lanca erro quando nao ha JSON interpretavel', () => {
    assert.throws(() => extrairJson('não consegui revisar'), /Nao foi possivel interpretar/);
  });

  it('rejeita array no lugar de objeto', () => {
    assert.throws(() => extrairJson('[1,2,3]'), /Nao foi possivel interpretar/);
  });
});

describe('normalizarApontamentos', () => {
  const parametros = { arquivosPermitidos: ['src/A.cs', 'src/B.cs'], maxApontamentos: 10 };

  it('aceita apontamento valido e normaliza a categoria com acento', () => {
    const { apontamentos, descartados } = normalizarApontamentos(
      { resumo: 'PR ok', apontamentos: [apontamentoValido({ categoria: 'erro de implementacao' })] },
      parametros,
    );

    assert.equal(descartados.length, 0);
    assert.equal(apontamentos.length, 1);
    assert.equal(apontamentos[0].categoria, 'Erro de implementação');
  });

  it('descarta apontamento sobre arquivo fora do PR', () => {
    const { apontamentos, descartados } = normalizarApontamentos(
      { apontamentos: [apontamentoValido({ arquivo: 'src/Inventado.cs' })] },
      parametros,
    );

    assert.equal(apontamentos.length, 0);
    assert.match(descartados[0].motivo, /nao enviado na revisao/);
  });

  it('descarta severidade ou categoria invalida', () => {
    const { apontamentos, descartados } = normalizarApontamentos(
      { apontamentos: [apontamentoValido({ severidade: 'Blocker' })] },
      parametros,
    );

    assert.equal(apontamentos.length, 0);
    assert.match(descartados[0].motivo, /severidade invalida/);
  });

  it('descarta apontamento sem titulo ou sem descricao', () => {
    const { apontamentos, descartados } = normalizarApontamentos(
      { apontamentos: [apontamentoValido({ descricao: '  ' })] },
      parametros,
    );

    assert.equal(apontamentos.length, 0);
    assert.match(descartados[0].motivo, /titulo ou descricao vazios/);
  });

  it('remove duplicatas do mesmo arquivo, linha e titulo', () => {
    const { apontamentos, descartados } = normalizarApontamentos(
      { apontamentos: [apontamentoValido(), apontamentoValido()] },
      parametros,
    );

    assert.equal(apontamentos.length, 1);
    assert.match(descartados[0].motivo, /duplicado/);
  });

  it('ordena da maior para a menor severidade', () => {
    const { apontamentos } = normalizarApontamentos(
      {
        apontamentos: [
          apontamentoValido({ severidade: 'Low', titulo: 'a' }),
          apontamentoValido({ severidade: 'Critical', titulo: 'b' }),
          apontamentoValido({ severidade: 'Medium', titulo: 'c' }),
        ],
      },
      parametros,
    );

    assert.deepEqual(
      apontamentos.map((item) => item.severidade),
      ['Critical', 'Medium', 'Low'],
    );
  });

  it('assume suspeita quando a confianca nao e informada', () => {
    const { apontamentos } = normalizarApontamentos(
      { apontamentos: [apontamentoValido({ confianca: undefined })] },
      parametros,
    );

    assert.equal(apontamentos[0].confianca, 'suspeita');
  });

  it('normaliza linha invalida para null', () => {
    const { apontamentos } = normalizarApontamentos(
      { apontamentos: [apontamentoValido({ linha: 'n/a' })] },
      parametros,
    );

    assert.equal(apontamentos[0].linha, null);
  });

  it('aplica o limite de apontamentos e informa o excedente', () => {
    const lista = Array.from({ length: 5 }, (_, i) => apontamentoValido({ titulo: `t${i}` }));

    const { apontamentos, excedentes } = normalizarApontamentos(
      { apontamentos: lista },
      { ...parametros, maxApontamentos: 2 },
    );

    assert.equal(apontamentos.length, 2);
    assert.equal(excedentes, 3);
  });

  it('trata ausencia de apontamentos como revisao limpa', () => {
    const resultado = normalizarApontamentos({ resumo: 'Sem problemas.' }, parametros);

    assert.deepEqual(resultado.apontamentos, []);
    assert.equal(resultado.resumo, 'Sem problemas.');
  });
});

describe('avaliarBloqueio', () => {
  const apontamentos = [
    { severidade: 'High', confianca: 'suspeita' },
    { severidade: 'Low', confianca: 'confirmado' },
  ];

  it('nunca bloqueia no modo informativo', () => {
    const resultado = avaliarBloqueio(apontamentos, {
      modo: 'informativo',
      severidadeDeBloqueio: 'Low',
    });

    assert.equal(resultado.deveBloquear, false);
  });

  it('bloqueia a partir da severidade configurada', () => {
    const resultado = avaliarBloqueio(apontamentos, {
      modo: 'bloqueante',
      severidadeDeBloqueio: 'High',
      considerarApenasConfirmados: false,
    });

    assert.equal(resultado.deveBloquear, true);
    assert.equal(resultado.bloqueadores.length, 1);
  });

  it('nao bloqueia quando a severidade minima e maior que a encontrada', () => {
    const resultado = avaliarBloqueio(apontamentos, {
      modo: 'bloqueante',
      severidadeDeBloqueio: 'Critical',
      considerarApenasConfirmados: false,
    });

    assert.equal(resultado.deveBloquear, false);
  });

  it('ignora suspeitas quando configurado para so considerar confirmados', () => {
    const resultado = avaliarBloqueio(apontamentos, {
      modo: 'bloqueante',
      severidadeDeBloqueio: 'High',
      considerarApenasConfirmados: true,
    });

    assert.equal(resultado.deveBloquear, false);
  });
});
