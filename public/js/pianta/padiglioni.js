// Le planimetrie di una fiera viste come padiglioni: "PAD 6" quando il numero
// si legge dal nome del file o dal titolo della pianta, in ordine di numero.
// Usato dalla Planimetria dell'ufficio e da quella del tecnico.

import { h, monta, numero } from '../ui.js';
import { caricaPdfjs } from './visore.js';
import { padiglioneDelTesto } from './analisi.js';
import { padiglione, codiciStand, standInColonne } from './stand.js';

const SCHERMI = ['TV', 'Monitor', 'Videowall', 'Totem'];

/**
 * Il padiglione di un noleggio: quello scritto (campo Padiglione o "PAD 5"
 * nello stand) oppure, per gli stand numerati a tre o quattro cifre, la prima
 * cifra (573 → 5, 639 → 6, 3042 → 3), come nelle fiere della Mostra d'Oltremare.
 */
function padDelNoleggio(n, padFiera = '') {
  const scritto = standInColonne(n.stand, padFiera, n.padiglione).padiglione;
  if (scritto) return String(scritto);
  const codice = codiciStand(n.stand)[0] || '';
  return /^\d{3,4}$/.test(codice) ? codice[0] : null;
}

/**
 * Quante TV ci sono su ogni planimetria. Per quelle già aperte vale il conto
 * fatto sulla pianta (`trovate`); per le altre si stima dal padiglione degli
 * stand, più i monitor messi a mano su quella planimetria.
 */
export function contaTv({ noleggi, padLetti, trovate, padFiera = '' }) {
  const schermi = noleggi.filter((n) => SCHERMI.includes(n.prodotto_categoria) && n.stato !== 'annullato');
  return (a) => {
    if (trovate.has(a.id)) return trovate.get(a.id);
    const pad = (etichettaPianta(a, padLetti).match(/^PAD (\d+)$/) || [])[1];
    return schermi
      .filter((n) => (n.segnaposto_allegato
        ? n.segnaposto_allegato === a.id
        : Boolean(pad) && padDelNoleggio(n, padFiera) === pad))
      .reduce((t, n) => t + n.quantita, 0);
  };
}

/** "Padiglione 5 - pianta.pdf" → "Padiglione 5 - pianta": il nome del file, senza estensione. */
export const nomePianta = (nome) => String(nome || 'Planimetria').replace(/\.(pdf|png|jpe?g|webp)$/i, '');

/** `padLetti`: id planimetria → numero letto dal titolo della pianta, quando è stata aperta. */
export function etichettaPianta(a, padLetti = new Map()) {
  const pad = padLetti.get(a.id) || padiglione(String(a.nome || '').replace(/[_-]/g, ' '));
  return pad ? `PAD ${pad}` : nomePianta(a.nome);
}

/** Bottoni dei padiglioni, ognuno con quante TV ci sono sopra. `conta(planimetria)` → numero. */
export function disegnaBottoniPadiglioni(barra, { piante, aperta, padLetti, conta, onScegli }) {
  const numeroPad = (a) => Number((etichettaPianta(a, padLetti).match(/^PAD (\d+)$/) || [])[1]) || Infinity;
  const ordinate = [...piante].sort((x, y) => numeroPad(x) - numeroPad(y) || x.nome.localeCompare(y.nome, 'it'));
  monta(barra, ordinate.map((a) => h('button', {
    type: 'button',
    class: `padiglione ${a.id === aperta.id ? 'padiglione--attivo' : ''}`,
    'aria-current': a.id === aperta.id ? 'true' : null,
    title: `${a.nome} · ${conta(a)} TV`,
    onclick: () => { if (a.id !== aperta.id) onScegli(a); },
  }, etichettaPianta(a, padLetti), h('span', { class: 'padiglione__conta' }, `${numero(conta(a))} TV`))));
}

/**
 * Legge in anticipo il padiglione dal titolo di ogni planimetria in PDF che
 * non lo dice già nel nome del file, così i bottoni portano "PAD 5" e il
 * numero giusto di TV prima ancora di aprirle. Basta la prima pagina.
 */
export async function leggiPadiglioni(piante, padLetti) {
  const daLeggere = piante.filter((a) => a.tipo === 'application/pdf' && !padLetti.has(a.id)
    && !padiglione(String(a.nome || '').replace(/[_-]/g, ' ')));
  if (!daLeggere.length) return;
  const pdfjs = await caricaPdfjs();
  await Promise.all(daLeggere.map(async (a) => {
    try {
      const risposta = await fetch(a.url, { credentials: 'same-origin' });
      if (!risposta.ok) return;
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await risposta.arrayBuffer()) }).promise;
      const pad = padiglioneDelTesto(await (await doc.getPage(1)).getTextContent());
      if (pad) padLetti.set(a.id, pad);
      doc.destroy();
    } catch { /* si legge quando la si apre */ }
  }));
}
