/**
 * Adaptadores dos provedores de modelo.
 *
 * Todos expoem a mesma interface: `revisar({ sistema, usuario })` devolvendo
 * `{ texto, uso }`. O `fetch` e injetavel para permitir teste sem rede.
 */

import { log } from './log.mjs';

const ESPERA_BASE_EM_MS = 1500;
const VERSAO_DA_API_ANTHROPIC = '2023-06-01';
const BETA_FALLBACK_ANTHROPIC = 'server-side-fallback-2026-07-01';

/** Erro de negocio do provedor: o modelo recusou a requisicao. */
export class RecusaDoModeloError extends Error {
  constructor(categoria, explicacao) {
    super(`O modelo recusou a revisao (categoria: ${categoria ?? 'desconhecida'}).`);
    this.name = 'RecusaDoModeloError';
    this.categoria = categoria;
    this.explicacao = explicacao;
  }
}

function ehStatusRecuperavel(status) {
  return status === 429 || status === 408 || status >= 500;
}

async function aguardarPadrao(milissegundos) {
  await new Promise((resolver) => {
    setTimeout(resolver, milissegundos);
  });
}

/**
 * POST com JSON, retentativa exponencial em erro transitorio e respeito ao
 * cabecalho `retry-after`.
 */
async function postarComRetentativa({ url, cabecalhos, corpo, buscar, tentativas, dormir }) {
  let ultimoErro;

  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    let resposta;

    try {
      resposta = await buscar(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...cabecalhos },
        body: JSON.stringify(corpo),
      });
    } catch (erro) {
      ultimoErro = new Error(`Falha de rede ao chamar o provedor: ${erro.message}`);

      if (tentativa === tentativas) throw ultimoErro;

      await dormir(ESPERA_BASE_EM_MS * 2 ** (tentativa - 1));
      continue;
    }

    if (resposta.ok) return resposta.json();

    const detalhe = await resposta.text().catch(() => '');

    ultimoErro = new Error(
      `Provedor respondeu ${resposta.status}: ${detalhe.slice(0, 500) || '(sem corpo)'}`,
    );

    if (!ehStatusRecuperavel(resposta.status) || tentativa === tentativas) throw ultimoErro;

    const retryAfter = Number.parseInt(resposta.headers?.get?.('retry-after') ?? '', 10);
    const espera = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : ESPERA_BASE_EM_MS * 2 ** (tentativa - 1);

    log.aviso(
      `Tentativa ${tentativa}/${tentativas} falhou (${resposta.status}). Nova tentativa em ${espera}ms.`,
    );

    await dormir(espera);
  }

  throw ultimoErro;
}

function suportaFallbackDeRecusa(modelo) {
  return /^claude-(opus-5|fable-5)/.test(String(modelo ?? ''));
}

function criarProvedorAnthropic(configuracao, { buscar, tentativas, dormir }) {
  return {
    nome: 'anthropic',
    modelo: configuracao.modelo,

    async revisar({ sistema, usuario }) {
      const cabecalhos = {
        'x-api-key': configuracao.chaveDeApi,
        'anthropic-version': VERSAO_DA_API_ANTHROPIC,
      };

      const corpo = {
        model: configuracao.modelo,
        max_tokens: configuracao.maxTokensSaida,
        system: [
          {
            type: 'text',
            text: sistema,
            // O prompt de sistema e identico entre PRs: cache-lo elimina o custo
            // de reenvia-lo a cada execucao dentro da janela de cache.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: usuario }],
      };

      if (configuracao.effort) corpo.output_config = { effort: configuracao.effort };

      if (suportaFallbackDeRecusa(configuracao.modelo)) {
        cabecalhos['anthropic-beta'] = BETA_FALLBACK_ANTHROPIC;
        corpo.fallbacks = 'default';
      }

      const resposta = await postarComRetentativa({
        url: `${configuracao.endpoint}/v1/messages`,
        cabecalhos,
        corpo,
        buscar,
        tentativas,
        dormir,
      });

      if (resposta.stop_reason === 'refusal') {
        throw new RecusaDoModeloError(
          resposta.stop_details?.category,
          resposta.stop_details?.explanation,
        );
      }

      const texto = (resposta.content ?? [])
        .filter((bloco) => bloco.type === 'text')
        .map((bloco) => bloco.text)
        .join('');

      return {
        texto,
        truncado: resposta.stop_reason === 'max_tokens',
        uso: {
          tokensDeEntrada: resposta.usage?.input_tokens ?? 0,
          tokensDeSaida: resposta.usage?.output_tokens ?? 0,
          tokensLidosDoCache: resposta.usage?.cache_read_input_tokens ?? 0,
          tokensGravadosNoCache: resposta.usage?.cache_creation_input_tokens ?? 0,
        },
      };
    },
  };
}

function criarProvedorCompativelComOpenAI(configuracao, { buscar, tentativas, dormir }, variante) {
  const ehAzure = variante === 'azure-openai';

  const url = ehAzure
    ? `${configuracao.endpoint}/openai/deployments/${configuracao.deployment}/chat/completions?api-version=${configuracao.apiVersion}`
    : `${configuracao.endpoint}/v1/chat/completions`;

  const cabecalhos = ehAzure
    ? { 'api-key': configuracao.chaveDeApi }
    : { authorization: `Bearer ${configuracao.chaveDeApi}` };

  return {
    nome: variante,
    modelo: ehAzure ? configuracao.deployment : configuracao.modelo,

    async revisar({ sistema, usuario }) {
      const corpo = {
        messages: [
          { role: 'system', content: sistema },
          { role: 'user', content: usuario },
        ],
        response_format: { type: 'json_object' },
      };

      if (!ehAzure) corpo.model = configuracao.modelo;

      corpo[configuracao.parametroDeTokens ?? 'max_tokens'] = configuracao.maxTokensSaida;

      if (typeof configuracao.temperatura === 'number') corpo.temperature = configuracao.temperatura;

      const resposta = await postarComRetentativa({
        url,
        cabecalhos,
        corpo,
        buscar,
        tentativas,
        dormir,
      });

      const escolha = resposta.choices?.[0];

      return {
        texto: escolha?.message?.content ?? '',
        truncado: escolha?.finish_reason === 'length',
        uso: {
          tokensDeEntrada: resposta.usage?.prompt_tokens ?? 0,
          tokensDeSaida: resposta.usage?.completion_tokens ?? 0,
          tokensLidosDoCache: resposta.usage?.prompt_tokens_details?.cached_tokens ?? 0,
          tokensGravadosNoCache: 0,
        },
      };
    },
  };
}

/**
 * Fabrica do provedor configurado.
 *
 * @param {object} configuracao configuracao normalizada
 * @param {object} [dependencias] injecao para teste
 */
export function criarProvedor(configuracao, dependencias = {}) {
  const {
    buscar = fetch,
    tentativas = 3,
    dormir = aguardarPadrao,
  } = dependencias;

  if (!configuracao.chaveDeApi) {
    throw new Error(
      `Chave de API ausente para o provedor "${configuracao.provedor}". `
        + 'Configure o secret correspondente (ver .github/revisao-ia/README.md).',
    );
  }

  const injecao = { buscar, tentativas, dormir };

  if (configuracao.provedor === 'anthropic') return criarProvedorAnthropic(configuracao, injecao);

  return criarProvedorCompativelComOpenAI(configuracao, injecao, configuracao.provedor);
}
