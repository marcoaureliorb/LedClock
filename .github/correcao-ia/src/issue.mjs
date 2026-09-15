/**
 * Leitura, classificacao e higienizacao dos dados da Issue.
 *
 * Todo texto que vem da Issue (titulo, corpo, comentarios, nome do autor) e
 * tratado como dado nao confiavel: nada dali vira comando, caminho de arquivo
 * ou nome de branch sem passar por esta camada.
 */

import { redigirSegredos } from '../../revisao-ia/src/segredos.mjs';

const MAX_CARACTERES_POR_COMENTARIO = 4000;
const MAX_CARACTERES_DO_SLUG = 48;

/** Remove acentos e baixa a caixa. */
function semAcento(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Indica se a Issue deve ser tratada como bug.
 *
 * Criterios (qualquer um basta): possui um dos rotulos declarados em
 * `rotulosDeBug`, ou o titulo comeca com um dos `prefixosDeTitulo`.
 */
export function ehBug(issue, configuracao) {
  const rotulos = (issue?.rotulos ?? []).map(semAcento);
  const rotulosDeBug = (configuracao.rotulosDeBug ?? []).map(semAcento);

  if (rotulos.some((rotulo) => rotulosDeBug.includes(rotulo))) return true;

  const titulo = semAcento(issue?.titulo).trimStart();

  return (configuracao.prefixosDeTitulo ?? [])
    .map(semAcento)
    .some((prefixo) => prefixo !== '' && titulo.startsWith(prefixo));
}

/**
 * Converte o payload cru da API do GitHub no formato usado pelo agente.
 *
 * O corpo e os comentarios passam pela redacao de segredos: um stack trace
 * colado na Issue pode conter token, e ele nao deve chegar ao modelo.
 */
export function normalizarIssue(bruta, comentariosBrutos = [], configuracao) {
  const limites = configuracao?.limites ?? {};
  const maxCaracteres = limites.maxCaracteresDaIssue ?? 12000;
  const maxComentarios = limites.maxComentariosDaIssue ?? 20;

  const corpo = redigirSegredos(String(bruta?.body ?? '').slice(0, maxCaracteres));

  let segredosRedigidos = corpo.ocorrencias;

  // Os comentarios mais recentes sao os mais informativos (correcoes de rumo,
  // stack trace anexado depois). Por isso o corte mantem o fim da lista.
  const comentarios = comentariosBrutos
    .filter((comentario) => typeof comentario?.body === 'string')
    .slice(-maxComentarios)
    .map((comentario) => {
      const texto = redigirSegredos(comentario.body.slice(0, MAX_CARACTERES_POR_COMENTARIO));

      segredosRedigidos += texto.ocorrencias;

      return {
        autor: String(comentario.user?.login ?? 'desconhecido'),
        criadoEm: String(comentario.created_at ?? ''),
        texto: texto.texto,
      };
    });

  return {
    numero: Number(bruta?.number),
    titulo: String(bruta?.title ?? '').slice(0, 400),
    corpo: corpo.texto,
    rotulos: (bruta?.labels ?? []).map((rotulo) =>
      String(typeof rotulo === 'string' ? rotulo : rotulo?.name ?? '')).filter(Boolean),
    autor: String(bruta?.user?.login ?? 'desconhecido'),
    estado: String(bruta?.state ?? 'open'),
    criadaEm: String(bruta?.created_at ?? ''),
    ehPullRequest: Boolean(bruta?.pull_request),
    comentarios,
    segredosRedigidos,
  };
}

/**
 * Gera o trecho legivel da branch automatica a partir de um texto livre.
 *
 * So sobrevivem letras minusculas ASCII, numeros e hifens. Isso resolve ao
 * mesmo tempo tres exigencias: nome de branch valido no Git, ausencia de dado
 * sensivel colado no titulo e ausencia de caractere que possa escapar de um
 * argumento de comando.
 */
export function gerarSlug(texto, tamanhoMaximo = MAX_CARACTERES_DO_SLUG) {
  const limpo = semAcento(texto)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (limpo === '') return 'bug';

  const cortado = limpo.slice(0, tamanhoMaximo).replace(/-$/, '');

  return cortado === '' ? 'bug' : cortado;
}

/**
 * Nome completo da branch automatica.
 *
 * O numero da Issue no fim torna a branch deterministica: a mesma Issue sempre
 * produz o mesmo nome, o que permite detectar reprocessamento.
 */
export function montarNomeDaBranch({ prefixo, descricao, numeroDaIssue }) {
  return `${prefixo}/${gerarSlug(descricao)}-${numeroDaIssue}`;
}

/**
 * Indica se o comentario pede reanalise explicita.
 *
 * Exige o comando no inicio de uma linha, para que uma mencao no meio de um
 * texto ("rodei o /analisar-bug ontem") nao dispare o agente.
 */
export function pedeReanalise(textoDoComentario, comando) {
  if (typeof comando !== 'string' || comando.trim() === '') return false;

  const alvo = semAcento(comando).trim();

  return String(textoDoComentario ?? '')
    .split('\n')
    .some((linha) => semAcento(linha).trim() === alvo);
}
