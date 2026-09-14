/**
 * Renderizacao do comentario do Pull Request e sua publicacao idempotente.
 *
 * O comentario carrega um marcador HTML invisivel: execucoes seguintes do mesmo
 * PR atualizam o comentario existente em vez de criar um novo.
 */

import { SEVERIDADES } from './config.mjs';
import { log } from './log.mjs';

export const MARCADOR = '<!-- revisao-ia -->';

const LIMITE_DO_COMENTARIO = 60000;

const SIMBOLO_POR_SEVERIDADE = {
  Critical: 'CRITICAL',
  High: 'HIGH',
  Medium: 'MEDIUM',
  Low: 'LOW',
  Info: 'INFO',
};

/** Precos em USD por milhao de tokens. Apenas para estimativa exibida no PR. */
const PRECOS_POR_MILHAO = {
  'claude-fable-5-1': { entrada: 10, saida: 50 },
  'claude-fable-5': { entrada: 10, saida: 50 },
  'claude-opus-5': { entrada: 5, saida: 25 },
  'claude-opus-4-8': { entrada: 5, saida: 25 },
  'claude-opus-4-7': { entrada: 5, saida: 25 },
  'claude-sonnet-5': { entrada: 2, saida: 10 },
  'claude-sonnet-4-6': { entrada: 3, saida: 15 },
  'claude-haiku-4-5': { entrada: 1, saida: 5 },
};

/**
 * Estimativa de custo da execucao. Leitura de cache e cobrada a ~10% do preco
 * de entrada; por isso ela entra com peso reduzido.
 */
export function estimarCustoEmDolar(modelo, uso) {
  const preco = PRECOS_POR_MILHAO[modelo];

  if (!preco || !uso) return null;

  const entradaEfetiva = uso.tokensDeEntrada + uso.tokensGravadosNoCache * 1.25
    + uso.tokensLidosDoCache * 0.1;

  const total = (entradaEfetiva * preco.entrada + uso.tokensDeSaida * preco.saida) / 1_000_000;

  return Math.round(total * 10000) / 10000;
}

function montarPermalink({ servidor, repositorio, sha, arquivo, linha }) {
  const ancora = linha ? `#L${linha}` : '';

  // Caminhos com espaco existem (ex.: "src/2 - Servicos/"). Sem codificar,
  // o markdown quebra o link no primeiro espaco.
  const caminhoCodificado = arquivo
    .split('/')
    .map((segmento) => encodeURIComponent(segmento))
    .join('/');

  return `${servidor}/${repositorio}/blob/${sha}/${caminhoCodificado}${ancora}`;
}

function linguagemDoArquivo(arquivo) {
  const extensao = arquivo.split('.').pop()?.toLowerCase();

  return (
    {
      js: 'javascript',
      mjs: 'javascript',
      cjs: 'javascript',
      ts: 'typescript',
      tsx: 'tsx',
      jsx: 'jsx',
      vue: 'vue',
      py: 'python',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      java: 'java',
      kt: 'kotlin',
      php: 'php',
      cs: 'csharp',
      sql: 'sql',
      sh: 'bash',
      css: 'css',
      scss: 'scss',
      html: 'html',
      json: 'json',
      yml: 'yaml',
      yaml: 'yaml',
    }[extensao] ?? ''
  );
}

function renderizarApontamento(apontamento, indice, contextoDoLink) {
  const localizacao = apontamento.linha ? `${apontamento.arquivo}:${apontamento.linha}` : apontamento.arquivo;

  const link = montarPermalink({ ...contextoDoLink, arquivo: apontamento.arquivo, linha: apontamento.linha });

  const marcaDeConfianca = apontamento.confianca === 'suspeita' ? ' _(suspeita, nao confirmada)_' : '';

  const partes = [
    `### ${indice}. \`${SIMBOLO_POR_SEVERIDADE[apontamento.severidade]}\` ${apontamento.titulo}`,
    '',
    `**Categoria:** ${apontamento.categoria} | **Severidade:** ${apontamento.severidade}${marcaDeConfianca}`,
    `**Local:** [\`${localizacao}\`](${link})`,
    '',
    apontamento.descricao,
  ];

  if (apontamento.explicacao) partes.push('', `**Por que importa:** ${apontamento.explicacao}`);
  if (apontamento.sugestao) partes.push('', `**Correcao sugerida:** ${apontamento.sugestao}`);

  if (apontamento.exemplo) {
    const jaTemCerca = apontamento.exemplo.trimStart().startsWith('```');

    partes.push(
      '',
      '<details><summary>Exemplo de codigo corrigido</summary>',
      '',
      jaTemCerca
        ? apontamento.exemplo
        : `\`\`\`${linguagemDoArquivo(apontamento.arquivo)}\n${apontamento.exemplo}\n\`\`\``,
      '',
      '</details>',
    );
  }

  return partes.join('\n');
}

function renderizarContagem(apontamentos) {
  const presentes = SEVERIDADES.slice()
    .reverse()
    .map((severidade) => ({
      severidade,
      total: apontamentos.filter((item) => item.severidade === severidade).length,
    }))
    .filter((item) => item.total > 0);

  if (presentes.length === 0) return '';

  return presentes.map((item) => `${item.severidade}: **${item.total}**`).join(' | ');
}

/**
 * Monta o corpo markdown do comentario.
 */
export function renderizarComentario({
  resultado,
  configuracao,
  contexto,
  verificacoes,
  bloqueio,
  provedor,
  contextoDoLink,
  falha = null,
}) {
  const linhas = [MARCADOR, '## Revisao de codigo por IA', ''];

  if (falha) {
    linhas.push(
      `> **A revisao nao pode ser concluida.**`,
      '>',
      `> ${falha}`,
      '',
      configuracao.bloquearQuandoApiFalhar
        ? '_O job foi reprovado porque `bloquearQuandoApiFalhar` esta ativo._'
        : '_O job nao foi reprovado por isso: a falha da revisao nao bloqueia o merge nesta configuracao._',
      '',
      '---',
      '',
      `Provedor: \`${configuracao.provedor}\` | Modelo: \`${configuracao.modelo}\``,
    );

    return linhas.join('\n');
  }

  const { apontamentos } = resultado;

  if (resultado.resumo) linhas.push(resultado.resumo, '');

  if (apontamentos.length === 0) {
    linhas.push('**Revisao concluida sem apontamentos.**', '');
  } else {
    linhas.push(renderizarContagem(apontamentos), '');
  }

  linhas.push('<details><summary>Checks executados</summary>', '');

  linhas.push(
    `- Analise por IA: **executada** (${contexto.itens.length} arquivo(s) enviado(s))`,
  );

  for (const verificacao of verificacoes) {
    linhas.push(
      `- ${verificacao.nome}: **${verificacao.situacao}**${verificacao.detalhe ? ` - ${verificacao.detalhe}` : ''}`,
    );
  }

  if (verificacoes.length === 0) {
    linhas.push(
      '- Verificacoes nativas: **nenhuma aplicavel** a estes arquivos',
    );
  }

  linhas.push(
    '',
    `- Modo: **${configuracao.modo}**`
      + (configuracao.modo === 'bloqueante'
        ? ` (bloqueia a partir de \`${configuracao.severidadeDeBloqueio}\`)`
        : ''),
    '',
    '</details>',
    '',
  );

  if (apontamentos.length > 0) {
    linhas.push('---', '');

    apontamentos.forEach((apontamento, indice) => {
      linhas.push(renderizarApontamento(apontamento, indice + 1, contextoDoLink), '');
    });
  }

  if (bloqueio?.deveBloquear) {
    linhas.push(
      '---',
      '',
      `> **Merge bloqueado por esta revisao:** ${bloqueio.motivo}.`,
      '> Corrija os itens acima ou ajuste a configuracao em `.github/revisao-ia/revisor.config.json`.',
      '',
    );
  }

  const rodape = ['---', '', '<details><summary>Detalhes da execucao</summary>', ''];

  rodape.push(
    `- Provedor: \`${provedor.nome}\` | Modelo: \`${provedor.modelo}\``,
    `- Arquivos revisados: ${contexto.itens.length} | caracteres enviados: ${contexto.caracteresTotais}`,
  );

  if (contexto.segredosRedigidos > 0) {
    rodape.push(`- Trechos redigidos por suspeita de segredo: ${contexto.segredosRedigidos}`);
  }

  if (contexto.naoEnviados.length > 0) {
    rodape.push(
      `- Arquivos alterados nao enviados (${contexto.naoEnviados.length}):`,
      ...contexto.naoEnviados.map((item) => `  - \`${item.caminho}\` - ${item.motivo}`),
    );
  }

  if (resultado.descartados?.length > 0) {
    rodape.push(
      `- Apontamentos descartados na validacao: ${resultado.descartados.length}`
        + ' (referenciavam arquivo fora do PR, vinham duplicados ou estavam malformados)',
    );
  }

  if (resultado.excedentes > 0) {
    rodape.push(`- Apontamentos omitidos pelo limite de exibicao: ${resultado.excedentes}`);
  }

  if (resultado.uso) {
    const custo = estimarCustoEmDolar(provedor.modelo, resultado.uso);

    rodape.push(
      `- Tokens: ${resultado.uso.tokensDeEntrada} entrada`
        + ` (${resultado.uso.tokensLidosDoCache} lidos do cache) / ${resultado.uso.tokensDeSaida} saida`
        + (custo === null ? '' : ` | custo estimado: US$ ${custo.toFixed(4)}`),
    );
  }

  rodape.push('', '</details>');

  linhas.push(...rodape);

  const corpo = linhas.join('\n');

  if (corpo.length <= LIMITE_DO_COMENTARIO) return corpo;

  return `${corpo.slice(0, LIMITE_DO_COMENTARIO)}\n\n> _Comentario truncado por exceder o limite do GitHub._`;
}

/**
 * Cria ou atualiza o comentario da revisao no PR.
 */
export async function publicarComentario({ cliente, numeroDoPr, corpo }) {
  const comentarios = await cliente.listarComentarios(numeroDoPr);

  const existente = comentarios.find((comentario) => comentario.body?.includes(MARCADOR));

  if (existente) {
    log.info(`Atualizando comentario existente (id ${existente.id}).`);

    return cliente.atualizarComentario(existente.id, corpo);
  }

  log.info('Criando novo comentario de revisao.');

  return cliente.criarComentario(numeroDoPr, corpo);
}
