// "Cosa manca", la seconda schermata del tecnico (la prima è la Planimetria):
// per ogni fiera, stallo per stallo (padiglione e stand), cosa c'è ancora da
// installare o da ritirare, con "Dov'è?" che lo mostra sulla pianta.
// I dati arrivano da /api/tecnico, che non contiene prezzi.

import { api } from '../api.js';
import { apriPianta } from '../pianta/visore.js';
import { codiciStand, standInColonne } from '../pianta/stand.js';
import {
  h, monta, vuoto, numero, nomeBreve, intervalloDate, dataLunga, addGiorni, oggiISO,
  idProdotto, badgeMontaggio, eSchermo,
} from '../ui.js';

/** Cosa resta da fare su un noleggio; null se è già installato e la fiera è in corso. */
export function compito(n, fiera) {
  if (n.stato === 'prenotato') return { testo: 'Da installare', classe: 'da-fare' };
  if (fiera.data_fine < oggiISO()) return { testo: 'Da ritirare', classe: 'ritiro' };
  return null;
}

/** La piantana abbinata a un TV non fa riga a sé: sta nella riga del TV. */
export function conPiantaneNelTv(righe) {
  const ids = new Set(righe.map((n) => n.id));
  return righe
    .filter((n) => !(n.abbinato_a && ids.has(n.abbinato_a)))
    .map((n) => ({ ...n, piantane: righe.filter((p) => p.abbinato_a === n.id) }));
}

/** Gli stalli: noleggi raggruppati per padiglione, stand ed espositore, in ordine di giro. */
export function perStallo(installazioni, fiera) {
  const gruppi = new Map();
  for (const n of installazioni) {
    const posto = standInColonne(n.stand, fiera.padiglione, n.padiglione);
    const chiave = `${posto.padiglione}|${(n.stand || '').toLowerCase()}|${(n.cliente || '').toLowerCase()}`;
    if (!gruppi.has(chiave)) gruppi.set(chiave, { stand: n.stand, padiglione: posto.padiglione, cliente: n.cliente, righe: [] });
    gruppi.get(chiave).righe.push(n);
  }
  return [...gruppi.values()].sort((a, b) => {
    const pa = (a.padiglione || '~').localeCompare(b.padiglione || '~', 'it', { numeric: true });
    if (pa) return pa;
    const ca = codiciStand(a.stand)[0] || '~';
    const cb = codiciStand(b.stand)[0] || '~';
    return ca.localeCompare(cb, 'it', { numeric: true }) || (a.cliente || '').localeCompare(b.cliente || '', 'it');
  });
}

/** I dati della pianta dal canale del tecnico: niente prezzi. */
export const datiPerTecnico = (fiera, allegato) => async () => {
  const [dettaglio, posizioni, segnaposti] = await Promise.all([
    api.installazioniFiera(fiera.id),
    api.posizioniTecnico(fiera.id, allegato.id),
    api.segnapostiTecnico(fiera.id, allegato.id),
  ]);
  return { noleggi: dettaglio.noleggi, posizioni, segnaposti };
};

function apriLaPianta(fiera, allegato, stand = '') {
  apriPianta({
    fiera,
    allegato,
    stand,
    solaLettura: true,
    caricaDati: datiPerTecnico(fiera, allegato),
  });
}

/** Un apparecchio da installare: modello, ID, come si monta, la sua piantana e le note. */
function apparecchio(n, c) {
  const piantane = n.piantane.map((p) => idProdotto(p.prodotto_codice)).filter(Boolean);
  return h('li', {},
    h('span', { class: 'installa__apparecchio' },
      n.quantita > 1 ? h('strong', {}, `${n.quantita}× `) : null,
      nomeBreve({ nome: n.prodotto_nome, marca: n.prodotto_marca, pollici: n.prodotto_pollici }),
      n.prodotto_codice ? h('span', { class: 'installa__codice' }, idProdotto(n.prodotto_codice)) : null,
      // Il montaggio solo se deciso: "da definire" non dice niente a chi monta.
      eSchermo(n.prodotto_categoria) && n.montaggio
        ? h('span', { class: 'installa__montaggio' }, badgeMontaggio(n.montaggio),
          n.piantane.length ? h('span', { class: 'installa__piantana' },
            ` ${piantane.length > 1 ? 'piantane' : 'piantana'} ${piantane.join(', ')}`) : null)
        : null,
      n.note_tecnico ? h('span', { class: 'installa__nota' }, n.note_tecnico) : null,
      n.note_altre ? h('span', { class: 'installa__nota' }, n.note_altre) : null),
    h('span', { class: `installa__compito installa__compito--${c.classe}` }, c.testo));
}

function schedaStallo(g, fiera) {
  const planimetria = fiera.allegati[0];
  return h('li', { class: 'installa__stand' },
    h('div', { class: 'installa__stand-testa' },
      h('div', { class: 'installa__numero' },
        h('span', { class: 'installa__etichetta' }, g.padiglione ? `Pad. ${g.padiglione} · Stand` : 'Stand'),
        h('strong', {}, g.stand || '—')),
      h('strong', { class: 'installa__cliente' }, g.cliente || 'Espositore non indicato'),
      planimetria && g.stand ? h('button', {
        class: 'btn btn--mini',
        onclick: () => apriLaPianta(fiera, planimetria, g.stand),
      }, 'Dov\'è?') : null),
    h('ul', { class: 'installa__apparecchi' }, g.righe.map((n) => apparecchio(n, n.compito))));
}

function schedaFiera(fiera) {
  const righe = conPiantaneNelTv(fiera.installazioni).map((n) => ({ ...n, compito: compito(n, fiera) }));
  const mancano = righe.filter((n) => n.compito);
  const pezzi = (classe) => mancano.filter((n) => n.compito.classe === classe).reduce((t, n) => t + n.quantita, 0);
  const daFare = pezzi('da-fare');
  const daRitirare = pezzi('ritiro');
  const fatti = righe.filter((n) => !n.compito).reduce((t, n) => t + n.quantita, 0);
  const montaggio = fiera.giorni_allestimento > 0 ? addGiorni(fiera.data_inizio, -fiera.giorni_allestimento) : null;

  return h('section', { class: 'installa' },
    h('header', { class: 'installa__testa' },
      h('div', {},
        h('h2', {}, fiera.nome),
        h('p', { class: 'installa__quando' }, intervalloDate(fiera.data_inizio, fiera.data_fine),
          montaggio ? h('span', {}, ` · montaggio dal ${dataLunga(montaggio)}`) : null)),
      h('div', { class: 'installa__conteggi' },
        daFare ? h('span', { class: 'installa__compito installa__compito--da-fare' }, `${numero(daFare)} da installare`) : null,
        daRitirare ? h('span', { class: 'installa__compito installa__compito--ritiro' }, `${numero(daRitirare)} da ritirare`) : null,
        fatti ? h('span', { class: 'installa__compito installa__compito--fatto' }, `${numero(fatti)} già installati`) : null)),
    mancano.length
      ? h('ul', { class: 'installa__elenco' }, perStallo(mancano, fiera).map((g) => schedaStallo(g, fiera)))
      : h('p', { class: 'installa__tutto' }, 'Niente: è tutto installato.'));
}

export default async function vistaInstallazioni({ corpo }) {
  const fiere = await api.installazioni();
  monta(corpo, fiere.length
    ? h('div', { class: 'installazioni' }, fiere.map(schedaFiera))
    : vuoto('Nessuna installazione in programma',
      'Quando l\'ufficio prenota del materiale per una fiera, lo trovi qui stallo per stallo.'));
}
