import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { criarProvedor, RecusaDoModeloError } from '../src/provedor.mjs';

const semEspera = async () => {};

function respostaFalsa(corpo, { status = 200, cabecalhos = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (nome) => cabecalhos[nome] ?? null },
    json: async () => corpo,
    text: async () => JSON.stringify(corpo),
  };
}

const CONFIGURACAO_ANTHROPIC = {
  provedor: 'anthropic',
  modelo: 'claude-opus-5',
  endpoint: 'https://api.anthropic.com',
  chaveDeApi: 'chave-de-teste',
  maxTokensSaida: 16000,
  effort: 'high',
};

describe('provedor anthropic', () => {
  it('monta a requisicao com cache no prompt de sistema e devolve o texto', async () => {
    const chamadas = [];

    const provedor = criarProvedor(CONFIGURACAO_ANTHROPIC, {
      dormir: semEspera,
      buscar: async (url, opcoes) => {
        chamadas.push({ url, opcoes });

        return respostaFalsa({
          content: [{ type: 'text', text: '{"resumo":"ok"}' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80 },
        });
      },
    });

    const resultado = await provedor.revisar({ sistema: 'SISTEMA', usuario: 'USUARIO' });

    assert.equal(resultado.texto, '{"resumo":"ok"}');
    assert.equal(resultado.uso.tokensDeEntrada, 100);
    assert.equal(resultado.uso.tokensLidosDoCache, 80);

    const [chamada] = chamadas;
    const corpo = JSON.parse(chamada.opcoes.body);

    assert.equal(chamada.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(chamada.opcoes.headers['x-api-key'], 'chave-de-teste');
    assert.equal(chamada.opcoes.headers['anthropic-version'], '2023-06-01');
    assert.equal(corpo.model, 'claude-opus-5');
    assert.deepEqual(corpo.system[0].cache_control, { type: 'ephemeral' });
    assert.equal(corpo.system[0].text, 'SISTEMA');
    assert.equal(corpo.messages[0].content, 'USUARIO');
    assert.deepEqual(corpo.output_config, { effort: 'high' });
  });

  it('habilita o fallback de recusa apenas em modelos que o suportam', async () => {
    const capturar = async () => {
      let corpoEnviado;
      let cabecalhosEnviados;

      const provedor = criarProvedor(
        { ...CONFIGURACAO_ANTHROPIC, modelo: 'claude-haiku-4-5' },
        {
          dormir: semEspera,
          buscar: async (_url, opcoes) => {
            corpoEnviado = JSON.parse(opcoes.body);
            cabecalhosEnviados = opcoes.headers;

            return respostaFalsa({ content: [], stop_reason: 'end_turn', usage: {} });
          },
        },
      );

      await provedor.revisar({ sistema: 's', usuario: 'u' });

      return { corpoEnviado, cabecalhosEnviados };
    };

    const { corpoEnviado, cabecalhosEnviados } = await capturar();

    assert.equal(corpoEnviado.fallbacks, undefined);
    assert.equal(cabecalhosEnviados['anthropic-beta'], undefined);
  });

  it('lanca RecusaDoModeloError quando o modelo recusa', async () => {
    const provedor = criarProvedor(CONFIGURACAO_ANTHROPIC, {
      dormir: semEspera,
      buscar: async () => respostaFalsa({
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber', explanation: 'motivo' },
      }),
    });

    await assert.rejects(
      () => provedor.revisar({ sistema: 's', usuario: 'u' }),
      (erro) => erro instanceof RecusaDoModeloError && erro.categoria === 'cyber',
    );
  });

  it('sinaliza resposta truncada por limite de tokens', async () => {
    const provedor = criarProvedor(CONFIGURACAO_ANTHROPIC, {
      dormir: semEspera,
      buscar: async () => respostaFalsa({
        content: [{ type: 'text', text: '{' }],
        stop_reason: 'max_tokens',
        usage: {},
      }),
    });

    const resultado = await provedor.revisar({ sistema: 's', usuario: 'u' });

    assert.equal(resultado.truncado, true);
  });

  it('repete a chamada em erro 429 e respeita retry-after', async () => {
    let tentativas = 0;
    const esperas = [];

    const provedor = criarProvedor(CONFIGURACAO_ANTHROPIC, {
      dormir: async (ms) => esperas.push(ms),
      buscar: async () => {
        tentativas += 1;

        if (tentativas < 3) {
          return respostaFalsa({ erro: 'limite' }, { status: 429, cabecalhos: { 'retry-after': '2' } });
        }

        return respostaFalsa({ content: [{ type: 'text', text: 'ok' }], usage: {} });
      },
    });

    const resultado = await provedor.revisar({ sistema: 's', usuario: 'u' });

    assert.equal(tentativas, 3);
    assert.deepEqual(esperas, [2000, 2000]);
    assert.equal(resultado.texto, 'ok');
  });

  it('nao repete em erro 400 e propaga a mensagem', async () => {
    let tentativas = 0;

    const provedor = criarProvedor(CONFIGURACAO_ANTHROPIC, {
      dormir: semEspera,
      buscar: async () => {
        tentativas += 1;

        return respostaFalsa({ error: 'modelo inexistente' }, { status: 400 });
      },
    });

    await assert.rejects(() => provedor.revisar({ sistema: 's', usuario: 'u' }), /400/);
    assert.equal(tentativas, 1);
  });

  it('exige chave de API', () => {
    assert.throws(
      () => criarProvedor({ ...CONFIGURACAO_ANTHROPIC, chaveDeApi: undefined }),
      /Chave de API ausente/,
    );
  });
});

describe('provedor azure-openai', () => {
  it('monta a URL do deployment e usa o cabecalho api-key', async () => {
    let chamada;

    const provedor = criarProvedor(
      {
        provedor: 'azure-openai',
        endpoint: 'https://instancia.openai.azure.com',
        deployment: 'gpt-revisor',
        apiVersion: '2024-10-21',
        chaveDeApi: 'chave-azure',
        maxTokensSaida: 8000,
        temperatura: null,
      },
      {
        dormir: semEspera,
        buscar: async (url, opcoes) => {
          chamada = { url, opcoes };

          return respostaFalsa({
            choices: [{ message: { content: '{"resumo":"ok"}' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          });
        },
      },
    );

    const resultado = await provedor.revisar({ sistema: 's', usuario: 'u' });

    assert.equal(
      chamada.url,
      'https://instancia.openai.azure.com/openai/deployments/gpt-revisor/chat/completions?api-version=2024-10-21',
    );
    assert.equal(chamada.opcoes.headers['api-key'], 'chave-azure');

    const corpo = JSON.parse(chamada.opcoes.body);

    assert.deepEqual(corpo.response_format, { type: 'json_object' });
    assert.equal(corpo.max_tokens, 8000);
    assert.equal(corpo.messages[0].role, 'system');
    assert.equal(resultado.texto, '{"resumo":"ok"}');
  });

  it('usa max_completion_tokens quando configurado', async () => {
    let corpo;

    const provedor = criarProvedor(
      {
        provedor: 'azure-openai',
        endpoint: 'https://x.openai.azure.com',
        deployment: 'd',
        apiVersion: '2025-01-01',
        chaveDeApi: 'k',
        maxTokensSaida: 4000,
        parametroDeTokens: 'max_completion_tokens',
      },
      {
        dormir: semEspera,
        buscar: async (_url, opcoes) => {
          corpo = JSON.parse(opcoes.body);

          return respostaFalsa({ choices: [{ message: { content: '{}' } }], usage: {} });
        },
      },
    );

    await provedor.revisar({ sistema: 's', usuario: 'u' });

    assert.equal(corpo.max_completion_tokens, 4000);
    assert.equal(corpo.max_tokens, undefined);
  });
});
