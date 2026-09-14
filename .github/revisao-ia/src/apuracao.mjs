/**
 * Interpretacao da resposta do modelo: extracao do JSON, normalizacao e
 * validacao dos apontamentos, e decisao de bloqueio do merge.
 *
 * Toda a defesa contra alucinacao vive aqui: apontamento sobre arquivo que nao
 * esta no PR e descartado, nao reportado.
 */

import { CATEGORIAS, SEVERIDADES, ordemDaSeveridade } from './config.mjs';
import { normalizar } from './caminhos.mjs';

function semAcento(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Extrai o objeto JSON da resposta do modelo.
 *
 * Tolera cercas de codigo e texto antes/depois, que alguns modelos adicionam
 * mesmo sob instrucao explicita.
 */
export function extrairJson(textoBruto) {
  const texto = String(textoBruto ?? '').trim();

  if (texto === '') throw new Error('O modelo devolveu resposta vazia.');

  const semCerca = texto
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const candidatos = [semCerca];

  const inicio = semCerca.indexOf('{');
  const fim = semCerca.lastIndexOf('}');

  if (inicio !== -1 && fim > inicio) candidatos.push(semCerca.slice(inicio, fim + 1));

  for (const candidato of candidatos) {
    try {
      const objeto = JSON.parse(candidato);

      if (objeto && typeof objeto === 'object' && !Array.isArray(objeto)) return objeto;
    } catch {
      // tenta o proximo candidato
    }
  }

  throw new Error(
    `Nao foi possivel interpretar a resposta do modelo como JSON. Inicio da resposta: ${texto.slice(0, 200)}`,
  );
}

function normalizarCategoria(valor) {
  const alvo = semAcento(valor);

  return CATEGORIAS.find((categoria) => semAcento(categoria) === alvo) ?? null;
}

function normalizarSeveridade(valor) {
  const alvo = semAcento(valor);

  return SEVERIDADES.find((severidade) => semAcento(severidade) === alvo) ?? null;
}

function normalizarConfianca(valor) {
  return semAcento(valor) === 'confirmado' ? 'confirmado' : 'suspeita';
}

function textoLimpo(valor, limite = 2000) {
  return String(valor ?? '').trim().slice(0, limite);
}

/**
 * Valida e normaliza os apontamentos devolvidos pelo modelo.
 *
 * @param {object} bruto objeto JSON ja extraido
 * @param {object} parametros
 * @param {string[]} parametros.arquivosPermitidos caminhos efetivamente enviados
 * @param {number} parametros.maxApontamentos
 */
export function normalizarApontamentos(bruto, { arquivosPermitidos, maxApontamentos = 30 }) {
  const permitidos = new Set(arquivosPermitidos.map(normalizar));

  const descartados = [];
  const aceitos = [];
  const vistos = new Set();

  const lista = Array.isArray(bruto?.apontamentos) ? bruto.apontamentos : [];

  for (const item of lista) {
    const arquivo = normalizar(item?.arquivo);

    if (!permitidos.has(arquivo)) {
      descartados.push({ arquivo: arquivo || '(vazio)', motivo: 'arquivo nao enviado na revisao' });
      continue;
    }

    const categoria = normalizarCategoria(item?.categoria);
    const severidade = normalizarSeveridade(item?.severidade);

    if (!categoria || !severidade) {
      descartados.push({
        arquivo,
        motivo: `categoria ou severidade invalida ("${item?.categoria}" / "${item?.severidade}")`,
      });
      continue;
    }

    const titulo = textoLimpo(item?.titulo, 200);
    const descricao = textoLimpo(item?.descricao);

    if (titulo === '' || descricao === '') {
      descartados.push({ arquivo, motivo: 'titulo ou descricao vazios' });
      continue;
    }

    const linhaBruta = Number.parseInt(item?.linha, 10);
    const linha = Number.isFinite(linhaBruta) && linhaBruta > 0 ? linhaBruta : null;

    const chave = `${arquivo}|${linha}|${semAcento(titulo)}`;

    if (vistos.has(chave)) {
      descartados.push({ arquivo, motivo: 'apontamento duplicado' });
      continue;
    }

    vistos.add(chave);

    aceitos.push({
      categoria,
      severidade,
      confianca: normalizarConfianca(item?.confianca),
      arquivo,
      linha,
      titulo,
      descricao,
      explicacao: textoLimpo(item?.explicacao),
      sugestao: textoLimpo(item?.sugestao),
      exemplo: textoLimpo(item?.exemplo, 4000),
    });
  }

  aceitos.sort((a, b) => {
    const porSeveridade = ordemDaSeveridade(b.severidade) - ordemDaSeveridade(a.severidade);

    if (porSeveridade !== 0) return porSeveridade;

    const porArquivo = a.arquivo.localeCompare(b.arquivo);

    if (porArquivo !== 0) return porArquivo;

    return (a.linha ?? 0) - (b.linha ?? 0);
  });

  const excedentes = Math.max(0, aceitos.length - maxApontamentos);

  return {
    resumo: textoLimpo(bruto?.resumo, 4000),
    apontamentos: aceitos.slice(0, maxApontamentos),
    descartados,
    excedentes,
  };
}

/**
 * Decide se a revisao deve reprovar o job.
 *
 * @returns {{ deveBloquear: boolean, bloqueadores: object[], motivo: string }}
 */
export function avaliarBloqueio(apontamentos, configuracao) {
  if (configuracao.modo !== 'bloqueante') {
    return { deveBloquear: false, bloqueadores: [], motivo: 'modo informativo' };
  }

  const minimo = ordemDaSeveridade(configuracao.severidadeDeBloqueio);

  const bloqueadores = apontamentos.filter((apontamento) => {
    if (ordemDaSeveridade(apontamento.severidade) < minimo) return false;

    return !configuracao.considerarApenasConfirmados || apontamento.confianca === 'confirmado';
  });

  return {
    deveBloquear: bloqueadores.length > 0,
    bloqueadores,
    motivo:
      bloqueadores.length > 0
        ? `${bloqueadores.length} apontamento(s) com severidade >= ${configuracao.severidadeDeBloqueio}`
        : `nenhum apontamento com severidade >= ${configuracao.severidadeDeBloqueio}`,
  };
}
