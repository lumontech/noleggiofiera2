// Le planimetrie di una fiera viste come padiglioni: "PAD 6" quando il numero
// si legge dal nome del file o dal titolo della pianta, in ordine di numero.
// Usato dalla Planimetria dell'ufficio e da quella del tecnico.

import { h, monta, numero } from '../ui.js';
import { padiglione } from './stand.js';

/** "Padiglione 5 - pianta.pdf" → "Padiglione 5 - pianta": il nome del file, senza estensione. */
export const nomePianta = (nome) => String(nome || 'Planimetria').replace(/\.(pdf|png|jpe?g|webp)$/i, '');

/** `padLetti`: id planimetria → numero letto dal titolo della pianta, quando è stata aperta. */
export function etichettaPianta(a, padLetti = new Map()) {
  const pad = padLetti.get(a.id) || padiglione(String(a.nome || '').replace(/[_-]/g, ' '));
  return pad ? `PAD ${pad}` : nomePianta(a.nome);
}

/** Bottoni dei padiglioni, ognuno con quanti apparecchi ci sono sopra. */
export function disegnaBottoniPadiglioni(barra, { piante, aperta, padLetti, conta, onScegli }) {
  const numeroPad = (a) => Number((etichettaPianta(a, padLetti).match(/^PAD (\d+)$/) || [])[1]) || Infinity;
  const ordinate = [...piante].sort((x, y) => numeroPad(x) - numeroPad(y) || x.nome.localeCompare(y.nome, 'it'));
  monta(barra, ordinate.map((a) => h('button', {
    type: 'button',
    class: `padiglione ${a.id === aperta.id ? 'padiglione--attivo' : ''}`,
    'aria-current': a.id === aperta.id ? 'true' : null,
    title: a.nome,
    onclick: () => { if (a.id !== aperta.id) onScegli(a); },
  }, etichettaPianta(a, padLetti), h('span', { class: 'padiglione__conta' }, numero(conta(a.id))))));
}
