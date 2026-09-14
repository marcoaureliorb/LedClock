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

export const log = {
  info: (mensagem) => escreva('[revisao-ia] ', mensagem),
  aviso: (mensagem) => escreva('::warning::', mensagem),
  erro: (mensagem) => escreva('::error::', mensagem),
  depuracao: (mensagem) => escreva('::debug::', mensagem),
};

/** Limpa o estado interno. Usado apenas pelos testes. */
export function limparSegredosRegistrados() {
  segredosConhecidos.clear();
}
