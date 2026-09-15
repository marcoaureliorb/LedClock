/**
 * Carregamento e validacao da configuracao da correcao automatizada.
 *
 * Precedencia: variavel de ambiente > corretor.config.json > padrao embutido.
 *
 * Os nomes de secret exigidos pelo processo (AZURE_OPENAI_ENDPOINT,
 * AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT) sao aceitos diretamente; as
 * variaveis CORRECAO_* tem precedencia e servem para apontar o agente para
 * outro provedor sem editar arquivo.
 */

import { readFileSync } from 'node:fs';

import { registrarSegredo } from '../../revisao-ia/src/log.mjs';

export const PROVEDORES = ['azure-openai', 'anthropic', 'openai'];
export const STATUS_DE_ANALISE = ['identified', 'uncertain', 'not_found'];

function lerTexto(...nomes) {
  for (const nome of nomes) {
    const valor = process.env[nome];

    if (typeof valor === 'string' && valor.trim() !== '') return valor.trim();
  }

  return undefined;
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
    'azure-openai': ['CORRECAO_API_KEY', 'AZURE_OPENAI_API_KEY'],
    anthropic: ['CORRECAO_API_KEY', 'ANTHROPIC_API_KEY'],
    openai: ['CORRECAO_API_KEY', 'OPENAI_API_KEY'],
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
 * Normaliza uma validacao declarada no arquivo de configuracao.
 *
 * `comando` e sempre um array de argumentos: ele e executado sem shell, para
 * que nada vindo da Issue ou do modelo possa virar comando.
 */
function normalizarValidacao(chave, bruta) {
  if (!Array.isArray(bruta?.comando) || bruta.comando.length === 0) {
    throw new Error(
      `A validacao "${chave}" precisa de "comando" como array de argumentos (ex.: ["pio", "run"]).`,
    );
  }

  if (bruta.comando.some((argumento) => typeof argumento !== 'string')) {
    throw new Error(`Todos os argumentos de "comando" da validacao "${chave}" devem ser texto.`);
  }

  return {
    chave,
    habilitada: bruta.habilitada !== false,
    descricao: typeof bruta.descricao === 'string' ? bruta.descricao : '',
    gatilho: Array.isArray(bruta.gatilho) ? bruta.gatilho : [],
    comando: [...bruta.comando],
    diretorio: typeof bruta.diretorio === 'string' ? bruta.diretorio : '.',
    obrigatoria: bruta.obrigatoria !== false,
    timeoutEmSegundos: Number.isFinite(bruta.timeoutEmSegundos) ? bruta.timeoutEmSegundos : 600,
  };
}

/**
 * @param {string} caminhoDoArquivo caminho do corretor.config.json
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
    lerTexto('CORRECAO_PROVEDOR') ?? arquivo.provedor ?? 'azure-openai',
    PROVEDORES,
    'provedor',
  );

  const { chave, origem } = resolverChaveDeApi(provedor);

  registrarSegredo(chave);

  const validacoes = Object.entries(arquivo.validacoes ?? {}).map(
    ([nome, bruta]) => normalizarValidacao(nome, bruta),
  );

  const configuracao = {
    provedor,
    modelo: lerTexto('CORRECAO_MODELO') ?? arquivo.modelo ?? 'gpt-4o',
    deployment: lerTexto('CORRECAO_DEPLOYMENT', 'AZURE_OPENAI_DEPLOYMENT') ?? arquivo.deployment,
    endpoint: (
      lerTexto('CORRECAO_ENDPOINT', 'AZURE_OPENAI_ENDPOINT')
      ?? arquivo.endpoint
      ?? endpointPadrao(provedor)
      ?? ''
    ).replace(/\/+$/, ''),
    apiVersion:
      lerTexto('CORRECAO_API_VERSION', 'AZURE_OPENAI_API_VERSION')
      ?? arquivo.apiVersion
      ?? '2024-10-21',
    effort: lerTexto('CORRECAO_EFFORT') ?? arquivo.effort ?? 'high',
    maxTokensSaida: lerInteiro('CORRECAO_MAX_TOKENS_SAIDA') ?? arquivo.maxTokensSaida ?? 16000,
    temperatura: typeof arquivo.temperatura === 'number' ? arquivo.temperatura : 0,
    // Deployments recentes da OpenAI/Azure exigem "max_completion_tokens".
    parametroDeTokens:
      lerTexto('CORRECAO_PARAMETRO_DE_TOKENS') ?? arquivo.parametroDeTokens ?? 'max_tokens',

    chaveDeApi: chave,
    origemDaChave: origem,

    branchBase: lerTexto('CORRECAO_BRANCH_BASE') ?? arquivo.branchBase ?? 'main',
    // O prefixo e fixo por exigencia do processo: toda branch automatica precisa
    // ser reconhecivel pelo nome. Nao e sobrescrito por variavel de ambiente.
    prefixoDaBranch: arquivo.prefixoDaBranch ?? 'automated-error-analysis',

    rotulosDeBug: arquivo.rotulosDeBug ?? ['bug'],
    prefixosDeTitulo: arquivo.prefixosDeTitulo ?? ['[BUG]'],
    comandoDeReanalise: arquivo.comandoDeReanalise ?? '/analisar-bug',
    rotuloEmAndamento: arquivo.rotuloEmAndamento ?? 'correcao-ia:em-andamento',
    rotuloConcluido: arquivo.rotuloConcluido ?? 'correcao-ia:analisada',

    // Ensaio: executa analise e validacoes, mas nao comenta, nao faz push e
    // nao abre Pull Request.
    simulacao: lerBooleano('CORRECAO_SIMULACAO') ?? false,

    limites: {
      maxRodadasDeInvestigacao:
        lerInteiro('CORRECAO_MAX_RODADAS') ?? limitesDoArquivo.maxRodadasDeInvestigacao ?? 3,
      maxArquivosPorRodada: limitesDoArquivo.maxArquivosPorRodada ?? 8,
      maxBuscasPorRodada: limitesDoArquivo.maxBuscasPorRodada ?? 6,
      maxResultadosPorBusca: limitesDoArquivo.maxResultadosPorBusca ?? 40,
      maxCaracteresPorArquivo:
        lerInteiro('CORRECAO_MAX_CARACTERES_POR_ARQUIVO')
        ?? limitesDoArquivo.maxCaracteresPorArquivo
        ?? 40000,
      maxCaracteresTotal:
        lerInteiro('CORRECAO_MAX_CARACTERES') ?? limitesDoArquivo.maxCaracteresTotal ?? 280000,
      maxArquivosNaArvore: limitesDoArquivo.maxArquivosNaArvore ?? 400,
      maxArquivosAlterados: limitesDoArquivo.maxArquivosAlterados ?? 6,
      maxComentariosDaIssue: limitesDoArquivo.maxComentariosDaIssue ?? 20,
      maxCaracteresDaIssue: limitesDoArquivo.maxCaracteresDaIssue ?? 12000,
    },

    arquivoDeConvencoes:
      lerTexto('CORRECAO_CONVENCOES')
      ?? arquivo.arquivoDeConvencoes
      ?? '.github/correcao-ia/convencoes.md',

    incluir: arquivo.incluir ?? [],
    excluir: arquivo.excluir ?? [],
    editaveis: arquivo.editaveis ?? [],
    validacoes,
  };

  if (configuracao.provedor === 'azure-openai') {
    if (!configuracao.endpoint) {
      throw new Error(
        'O provedor azure-openai exige AZURE_OPENAI_ENDPOINT '
          + '(ex.: https://minha-instancia.openai.azure.com).',
      );
    }

    if (!configuracao.deployment) {
      throw new Error(
        'O provedor azure-openai exige AZURE_OPENAI_DEPLOYMENT com o nome do deployment.',
      );
    }
  }

  if (configuracao.editaveis.length === 0) {
    throw new Error(
      'Nenhum caminho editavel declarado em "editaveis": o agente nao teria onde aplicar a correcao.',
    );
  }

  return configuracao;
}
