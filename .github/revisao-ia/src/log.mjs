/**
 * Log com redacao de segredos.
 *
 * Todo valor registrado via `registrarSegredo` e substituido por `***` antes de
 * qualquer escrita em stdout, evitando vazamento de chaves nos logs do Action.
 */

const segredosConhecidos = new Set();

/** Registra um valor que nunca deve aparecer nos logs. */
export function registrarSegredo(valor) {
  if (typeof valor !== 'string') return;

  const limpo = valor.trim();

  if (limpo.length >= 8) segredosConhecidos.add(limpo);
}

/** Substitui por `***` todos os segredos conhecidos presentes no texto. */
export function redigir(texto) {
  let saida = String(texto ?? '');

  for (const segredo of segredosConhecidos) {
    saida = saida.split(segredo).join('***');
  }

  return saida;
}

function escreva(prefixo, mensagem) {
  process.stdout.write(`${prefixo}${redigir(mensagem)}\n`);
}

/**
 * Cria um log com prefixo proprio.
 *
 * Os niveis de aviso, erro e depuracao usam os comandos do Actions, que ja se
 * identificam sozinhos no log; so `info` leva o nome da automacao.
 */
export function criarLog(nome) {
  return {
    info: (mensagem) => escreva(`[${nome}] `, mensagem),
    aviso: (mensagem) => escreva('::warning::', mensagem),
    erro: (mensagem) => escreva('::error::', mensagem),
    depuracao: (mensagem) => escreva('::debug::', mensagem),
  };
}

export const log = criarLog('revisao-ia');

/** Limpa o estado interno. Usado apenas pelos testes. */
export function limparSegredosRegistrados() {
  segredosConhecidos.clear();
}
