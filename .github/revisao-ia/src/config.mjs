/**
 * Carregamento e validacao da configuracao da revisao.
 *
 * Precedencia: variavel de ambiente > revisor.config.json > padrao embutido.
 */

import { readFileSync } from 'node:fs';

import { registrarSegredo } from './log.mjs';

export const SEVERIDADES = ['Info', 'Low', 'Medium', 'High', 'Critical'];
export const CATEGORIAS = ['Qualidade', 'Legibilidade', 'Erro de implementa\u00e7\u00e3o', 'Clean Code'];
export const PROVEDORES = ['anthropic', 'azure-openai', 'openai'];
export const MODOS = ['informativo', 'bloqueante'];

/** Posicao da severidade na escala. Quanto maior, mais grave. */
export function ordemDaSeveridade(severidade) {
  const indice = SEVERIDADES.indexOf(severidade);

  return indice === -1 ? 0 : indice;
}

function lerTexto(nome) {
  const valor = process.env[nome];

  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : undefined;
}

function lerInteiro(nome) {
  const bruto = lerTexto(nome);

  if (bruto === undefined) return undefined;

  const numero = Number.parseInt(bruto, 10);

  if (!Number.isFinite(numero) || numero <= 0) {
    throw new Error(`A variavel ${nome} deve ser um inteiro positivo. Recebido: "${bruto}".`);
  }

  return numero;
}

function lerBooleano(nome) {
  const bruto = lerTexto(nome);

  if (bruto === undefined) return undefined;

  return ['1', 'true', 'sim', 'yes'].includes(bruto.toLowerCase());
}

function exigirDentroDe(valor, permitidos, nomeDoCampo) {
  if (!permitidos.includes(valor)) {
    throw new Error(
      `Valor invalido para ${nomeDoCampo}: "${valor}". Permitidos: ${permitidos.join(', ')}.`,
    );
  }

  return valor;
}

function resolverChaveDeApi(provedor) {
  const candidatos = {
    anthropic: ['REVISAO_API_KEY', 'ANTHROPIC_API_KEY'],
    'azure-openai': ['REVISAO_API_KEY', 'AZURE_OPENAI_API_KEY'],
    openai: ['REVISAO_API_KEY', 'OPENAI_API_KEY'],
  }[provedor];

  for (const nome of candidatos) {
    const valor = lerTexto(nome);

    if (valor !== undefined) return { chave: valor, origem: nome };
  }

  return { chave: undefined, origem: null };
}

function endpointPadrao(provedor) {
  return {
    anthropic: 'https://api.anthropic.com',
    openai: 'https://api.openai.com',
    'azure-openai': undefined,
  }[provedor];
}

/**
 * @param {string} caminhoDoArquivo caminho do revisor.config.json
 * @returns configuracao normalizada e validada
 */
export function carregarConfiguracao(caminhoDoArquivo) {
  let arquivo = {};

  try {
    arquivo = JSON.parse(readFileSync(caminhoDoArquivo, 'utf8'));
  } catch (erro) {
    throw new Error(`Nao foi possivel ler a configuracao em "${caminhoDoArquivo}": ${erro.message}`);
  }

  const limitesDoArquivo = arquivo.limites ?? {};

  const provedor = exigirDentroDe(
    lerTexto('REVISAO_PROVEDOR') ?? arquivo.provedor ?? 'anthropic',
    PROVEDORES,
    'provedor',
  );

  const { chave, origem } = resolverChaveDeApi(provedor);

  registrarSegredo(chave);

  const configuracao = {
    provedor,
    modelo: lerTexto('REVISAO_MODELO') ?? arquivo.modelo ?? 'claude-opus-5',
    deployment: lerTexto('REVISAO_DEPLOYMENT') ?? arquivo.deployment,
    endpoint: (lerTexto('REVISAO_ENDPOINT') ?? arquivo.endpoint ?? endpointPadrao(provedor) ?? '')
      .replace(/\/+$/, ''),
    apiVersion: lerTexto('REVISAO_API_VERSION') ?? arquivo.apiVersion ?? '2024-10-21',
    effort: lerTexto('REVISAO_EFFORT') ?? arquivo.effort ?? 'high',
    maxTokensSaida: lerInteiro('REVISAO_MAX_TOKENS_SAIDA') ?? arquivo.maxTokensSaida ?? 16000,
    temperatura: arquivo.temperatura ?? null,
    // Deployments recentes da OpenAI/Azure exigem "max_completion_tokens" no lugar de "max_tokens".
    parametroDeTokens:
      lerTexto('REVISAO_PARAMETRO_DE_TOKENS') ?? arquivo.parametroDeTokens ?? 'max_tokens',

    chaveDeApi: chave,
    origemDaChave: origem,

    modo: exigirDentroDe(lerTexto('REVISAO_MODO') ?? arquivo.modo ?? 'informativo', MODOS, 'modo'),
    severidadeDeBloqueio: exigirDentroDe(
      lerTexto('REVISAO_SEVERIDADE_BLOQUEIO') ?? arquivo.severidadeDeBloqueio ?? 'Critical',
      SEVERIDADES,
      'severidadeDeBloqueio',
    ),
    bloquearQuandoApiFalhar:
      lerBooleano('REVISAO_BLOQUEAR_QUANDO_API_FALHAR') ?? arquivo.bloquearQuandoApiFalhar ?? false,
    considerarApenasConfirmados:
      lerBooleano('REVISAO_APENAS_CONFIRMADOS') ?? arquivo.considerarApenasConfirmados ?? false,

    limites: {
      maxArquivos: lerInteiro('REVISAO_MAX_ARQUIVOS') ?? limitesDoArquivo.maxArquivos ?? 40,
      maxCaracteresTotal:
        lerInteiro('REVISAO_MAX_CARACTERES') ?? limitesDoArquivo.maxCaracteresTotal ?? 240000,
      maxCaracteresPorArquivo:
        lerInteiro('REVISAO_MAX_CARACTERES_POR_ARQUIVO')
        ?? limitesDoArquivo.maxCaracteresPorArquivo
        ?? 24000,
      maxLinhasParaArquivoCompleto: limitesDoArquivo.maxLinhasParaArquivoCompleto ?? 400,
      maxApontamentos: limitesDoArquivo.maxApontamentos ?? 30,
    },

    // Markdown com as convencoes do repositorio, injetado no prompt de sistema.
    // Caminho relativo a raiz do repositorio; vazio ou ausente = sem convencoes declaradas.
    arquivoDeConvencoes:
      lerTexto('REVISAO_CONVENCOES') ?? arquivo.arquivoDeConvencoes ?? '.github/revisao-ia/convencoes.md',

    incluir: arquivo.incluir ?? [],
    excluir: arquivo.excluir ?? [],
    verificacoesNativas: arquivo.verificacoesNativas ?? {},
  };

  if (configuracao.provedor === 'azure-openai') {
    if (!configuracao.endpoint) {
      throw new Error(
        'O provedor azure-openai exige REVISAO_ENDPOINT (ex.: https://minha-instancia.openai.azure.com).',
      );
    }

    if (!configuracao.deployment) {
      throw new Error('O provedor azure-openai exige REVISAO_DEPLOYMENT com o nome do deployment.');
    }
  }

  return configuracao;
}
