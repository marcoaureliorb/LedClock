/**
 * Interpretacao e validacao das respostas do modelo.
 *
 * Duas respostas diferentes passam por aqui: a de cada rodada de investigacao
 * (pedir arquivos ou concluir) e a da fase de correcao (blocos de alteracao).
 *
 * Toda a defesa contra alucinacao vive neste modulo: caminho que nao existe no
 * repositorio e descartado antes de virar decisao, e a permissao para corrigir
 * depende de evidencia declarada, nunca do numero em `confidence`.
 */

import { extrairJson } from '../../revisao-ia/src/apuracao.mjs';
import { normalizar } from '../../revisao-ia/src/caminhos.mjs';
import { STATUS_DE_ANALISE } from './config.mjs';

export { extrairJson };

function texto(valor, limite = 4000) {
  return String(valor ?? '').trim().slice(0, limite);
}

function listaDeTextos(valor, limiteDeItens, limiteDeCaracteres = 600) {
  if (!Array.isArray(valor)) return [];

  return valor
    .map((item) => texto(item, limiteDeCaracteres))
    .filter((item) => item !== '')
    .slice(0, limiteDeItens);
}

function normalizarConfianca(valor) {
  const numero = Number(valor);

  if (!Number.isFinite(numero)) return null;

  return Math.min(1, Math.max(0, Math.round(numero * 100) / 100));
}

/**
 * Interpreta a resposta de uma rodada de investigacao.
 *
 * @returns {{ acao: 'investigar'|'concluir', arquivos: string[], buscas: string[],
 *            raciocinio: string, bruto: object }}
 */
export function interpretarRodada(textoBruto, configuracao) {
  const bruto = extrairJson(textoBruto);
  const acao = texto(bruto?.acao, 40).toLowerCase();

  if (acao === 'investigar') {
    const arquivos = listaDeTextos(
      bruto?.arquivos,
      configuracao.limites.maxArquivosPorRodada,
      400,
    ).map(normalizar);

    const buscas = listaDeTextos(bruto?.buscas, configuracao.limites.maxBuscasPorRodada, 120);

    if (arquivos.length === 0 && buscas.length === 0) {
      // Pedido vazio: nao ha o que servir, entao a rodada nao avanca nada.
      // Tratar como conclusao forcada evita um laco que so gasta tokens.
      return {
        acao: 'concluir',
        arquivos: [],
        buscas: [],
        raciocinio: texto(bruto?.raciocinio, 2000),
        bruto: { ...bruto, status: 'uncertain' },
        pedidoVazio: true,
      };
    }

    return {
      acao: 'investigar',
      arquivos,
      buscas,
      raciocinio: texto(bruto?.raciocinio, 2000),
      bruto,
    };
  }

  return {
    acao: 'concluir',
    arquivos: [],
    buscas: [],
    raciocinio: texto(bruto?.raciocinio, 2000),
    bruto,
  };
}

/**
 * Normaliza e valida a analise final.
 *
 * @param {object} bruto objeto JSON ja extraido da resposta
 * @param {object} parametros
 * @param {Function} parametros.caminhoEhEditavel (caminho) => boolean
 * @param {Set<string>} parametros.arquivosExistentes caminhos reais do repositorio
 */
export function normalizarAnalise(bruto, { caminhoEhEditavel, arquivosExistentes, configuracao }) {
  const statusBruto = texto(bruto?.status, 40).toLowerCase();
  const status = STATUS_DE_ANALISE.includes(statusBruto) ? statusBruto : 'uncertain';

  const descartados = [];
  const arquivosAfetados = [];

  for (const caminhoBruto of listaDeTextos(bruto?.affected_files, 20, 400)) {
    const caminho = normalizar(caminhoBruto);

    if (!arquivosExistentes.has(caminho)) {
      descartados.push({ caminho, motivo: 'arquivo nao existe no repositorio' });
      continue;
    }

    if (!caminhoEhEditavel(caminho)) {
      descartados.push({ caminho, motivo: 'arquivo fora do escopo editavel' });
      continue;
    }

    if (arquivosAfetados.includes(caminho)) continue;

    arquivosAfetados.push(caminho);
  }

  const excedentes = Math.max(
    0,
    arquivosAfetados.length - configuracao.limites.maxArquivosAlterados,
  );

  return {
    status,
    confianca: normalizarConfianca(bruto?.confidence),
    resumo: texto(bruto?.summary, 2000),
    causaRaiz: texto(bruto?.root_cause, 4000),
    solucaoProposta: texto(bruto?.proposed_solution, 4000),
    arquivosAfetados: arquivosAfetados.slice(0, configuracao.limites.maxArquivosAlterados),
    arquivosDescartados: descartados,
    arquivosExcedentes: excedentes,
    planoDeImplementacao: listaDeTextos(bruto?.implementation_plan, 15, 600),
    testesSugeridos: listaDeTextos(bruto?.tests_to_run, 10, 200),
    analiseManual: texto(bruto?.manual_analysis, 4000) || null,
    arquivosInvestigados: [],
    buscasRealizadas: [],
  };
}

/**
 * Decide se a correcao automatica pode ser tentada.
 *
 * A decisao e por evidencia declarada, nao por limiar de `confidence`: um
 * numero produzido pelo proprio modelo nao e prova de nada. O portao final da
 * automacao continua sendo a validacao (compilacao e testes), executada depois.
 *
 * @returns {{ pode: boolean, motivo: string }}
 */
export function podeCorrigir(analise) {
  if (analise.status !== 'identified') {
    return { pode: false, motivo: `a analise terminou com status "${analise.status}"` };
  }

  if (analise.causaRaiz === '') {
    return { pode: false, motivo: 'a analise nao descreveu a causa raiz' };
  }

  if (analise.solucaoProposta === '') {
    return { pode: false, motivo: 'a analise nao descreveu a solucao proposta' };
  }

  if (analise.arquivosAfetados.length === 0) {
    const detalhe = analise.arquivosDescartados.length > 0
      ? ` (${analise.arquivosDescartados.length} caminho(s) apontado(s) foram descartados na validacao)`
      : '';

    return {
      pode: false,
      motivo: `nenhum arquivo valido e editavel foi apontado como afetado${detalhe}`,
    };
  }

  if (analise.planoDeImplementacao.length === 0) {
    return { pode: false, motivo: 'a analise nao apresentou plano de implementacao' };
  }

  return { pode: true, motivo: 'causa identificada, com arquivos e plano declarados' };
}

/**
 * Interpreta a resposta da fase de correcao.
 *
 * Cada alteracao e um par de trechos exatos: `trecho_original` precisa aparecer
 * uma unica vez no arquivo. `trecho_original` vazio significa criacao de
 * arquivo novo.
 */
export function interpretarCorrecao(textoBruto, { caminhoEhEditavel, configuracao }) {
  const bruto = extrairJson(textoBruto);

  const statusBruto = texto(bruto?.status, 40).toLowerCase();
  const status = statusBruto === 'corrigido' ? 'corrigido' : 'nao_corrigido';

  const alteracoes = [];
  const descartadas = [];

  const lista = Array.isArray(bruto?.alteracoes) ? bruto.alteracoes : [];

  for (const item of lista) {
    const caminho = normalizar(texto(item?.arquivo, 400));

    if (caminho === '') {
      descartadas.push({ caminho: '(vazio)', motivo: 'alteracao sem caminho de arquivo' });
      continue;
    }

    if (!caminhoEhEditavel(caminho)) {
      descartadas.push({ caminho, motivo: 'arquivo fora do escopo editavel' });
      continue;
    }

    const trechoOriginal = String(item?.trecho_original ?? '');
    const trechoNovo = String(item?.trecho_novo ?? '');

    if (trechoOriginal === '' && trechoNovo.trim() === '') {
      descartadas.push({ caminho, motivo: 'alteracao sem conteudo' });
      continue;
    }

    if (trechoOriginal !== '' && trechoOriginal === trechoNovo) {
      descartadas.push({ caminho, motivo: 'trecho novo identico ao original' });
      continue;
    }

    alteracoes.push({
      caminho,
      descricao: texto(item?.descricao, 600),
      trechoOriginal,
      trechoNovo,
    });
  }

  const arquivosDistintos = new Set(alteracoes.map((alteracao) => alteracao.caminho));

  if (arquivosDistintos.size > configuracao.limites.maxArquivosAlterados) {
    throw new Error(
      `A correcao proposta altera ${arquivosDistintos.size} arquivos, acima do limite de `
        + `${configuracao.limites.maxArquivosAlterados} definido em "maxArquivosAlterados".`,
    );
  }

  return {
    status,
    motivo: texto(bruto?.motivo, 2000),
    resumo: texto(bruto?.resumo_da_correcao, 3000),
    mensagemDeCommit: texto(bruto?.mensagem_de_commit, 200),
    alteracoes,
    descartadas,
  };
}
