import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { correspondeAAlgum, normalizar, primeiroPadraoCorrespondente } from '../src/caminhos.mjs';

describe('normalizar', () => {
  it('converte separadores do Windows e remove o prefixo ./', () => {
    assert.equal(normalizar('src\\modulo\\Arquivo.js'), 'src/modulo/Arquivo.js');
    assert.equal(normalizar('./src/Arquivo.js'), 'src/Arquivo.js');
  });
});

describe('correspondeAAlgum', () => {
  it('casa extensao em qualquer profundidade com **/*.ext', () => {
    assert.equal(correspondeAAlgum('src/modulo/servicos/X.js', ['**/*.js']), true);
    assert.equal(correspondeAAlgum('X.js', ['**/*.js']), true);
    assert.equal(correspondeAAlgum('src/X.vue', ['**/*.js']), false);
  });

  it('casa diretorio intermediario com **/pasta/**', () => {
    assert.equal(correspondeAAlgum('src/Projeto/obj/Debug/X.js', ['**/obj/**']), true);
    assert.equal(correspondeAAlgum('src/Projeto/Objetos/X.js', ['**/obj/**']), false);
  });

  it('casa prefixo de diretorio com pasta/**', () => {
    assert.equal(correspondeAAlgum('dist/pacote.tgz', ['dist/**']), true);
    assert.equal(correspondeAAlgum('src/dist/pacote.tgz', ['dist/**']), false);
  });

  it('nao deixa * atravessar separador de diretorio', () => {
    assert.equal(correspondeAAlgum('src/Sub/X.js', ['src/*.js']), false);
    assert.equal(correspondeAAlgum('src/X.js', ['src/*.js']), true);
  });

  it('trata appsettings com sufixo de ambiente', () => {
    const padroes = ['**/appsettings*.json'];

    assert.equal(correspondeAAlgum('src/Servidor/appsettings.json', padroes), true);
    assert.equal(correspondeAAlgum('src/Servidor/appsettings.Development.json', padroes), true);
  });

  it('devolve false para lista de padroes vazia', () => {
    assert.equal(correspondeAAlgum('X.js', []), false);
    assert.equal(correspondeAAlgum('X.js', undefined), false);
  });
});

describe('primeiroPadraoCorrespondente', () => {
  it('devolve o padrao que motivou a exclusao', () => {
    const padrao = primeiroPadraoCorrespondente('src/P/obj/X.js', ['**/bin/**', '**/obj/**']);

    assert.equal(padrao, '**/obj/**');
  });

  it('devolve null quando nao ha correspondencia', () => {
    assert.equal(primeiroPadraoCorrespondente('src/X.js', ['**/obj/**']), null);
  });
});
