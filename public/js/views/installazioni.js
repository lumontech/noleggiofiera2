// La schermata del tecnico: fiera per fiera, cosa installare e in quale stand,
// con la pianta che mostra dove. I dati arrivano da /api/tecnico, che non
// contiene prezzi: qui non c'è nulla da nascondere, perché non arriva.

import { api } from '../api.js';
import { apriPianta } from '../pianta/visore.js';
import { codiciStand } from '../pianta/stand.js';
import {
  h, monta, vuoto, numero, nomeBreve, intervalloDate, dataLunga, addGiorni, oggiISO,
  idProdotto,
} from '../ui.js';

/** Cosa deve fare il tecnico con un noleggio, detto con le sue parole. */
function compito(n, fiera) {
  if (n.stato === 'prenotato') return { testo: 'Da installare', classe: 'da-fare' };
  if (fiera.data_fine < oggiISO()) return { testo: 'Da ritirare', classe: 'ritiro' };
  return { testo: 'Installato', classe: 'fatto' };
}

/** Le installazioni di una fiera raggruppate per stand (stesso cliente e stesso stand). */
function perStand(installazioni) {
  const gruppi = new Map();
  for (const n of installazioni) {
    const chiave = `${(n.stand || '').toLowerCase()}|${(n.cliente || '').toLowerCase()}`;
    if (!gruppi.has(chiave)) gruppi.set(chiave, { stand: n.stand, cliente: n.cliente, righe: [] });
    gruppi.get(chiave).righe.push(n);
  }
  return [...gruppi.values()].sort((a, b) => {
    const ca = codiciStand(a.stand)[0] || '~';
    const cb = codiciStand(b.stand)[0] || '~';
    return ca.localeCompare(cb, 'it', { numeric: true }) || (a.cliente || '').localeCompare(b.cliente || '', 'it');
  });
}

const testoRicerca = (fiera, g) => [
  fiera.nome, fiera.citta, fiera.luogo, g.stand, g.cliente,
  ...g.righe.flatMap((n) => [n.prodotto_nome, n.prodotto_marca, idProdotto(n.prodotto_codice)]),
].filter(Boolean).join(' ').toLowerCase();

function apriLaPianta(fiera, allegato, stand = '') {
  apriPianta({
    fiera,
    allegato,
    stand,
    solaLettura: true,
    caricaDati: async () => {
      const [dettaglio, posizioni] = await Promise.all([
        api.installazioniFiera(fiera.id),
        api.posizioniTecnico(fiera.id, allegato.id),
      ]);
      return { noleggi: dettaglio.noleggi, posizioni };
    },
  });
}

/** "123 × 72 cm · con base 77 cm · 11 kg · VESA 200x400": quello che serve per montarlo. */
function misure(n) {
  const cm = (mm) => String(Math.round(mm / 10));
  return [
    n.prodotto_larghezza_mm && n.prodotto_altezza_mm
      ? `${cm(n.prodotto_larghezza_mm)} × ${cm(n.prodotto_altezza_mm)} cm` : null,
    n.prodotto_altezza_base_mm ? `con base ${cm(n.prodotto_altezza_base_mm)} cm` : null,
    n.prodotto_peso_kg ? `${String(n.prodotto_peso_kg).replace('.', ',')} kg` : null,
    n.prodotto_vesa ? `VESA ${n.prodotto_vesa}` : null,
  ].filter(Boolean).join(' · ');
}

function schedaStand(g, fiera) {
  const tv = g.righe.reduce((t, n) => t + n.quantita, 0);
  const planimetria = fiera.allegati[0];
  return h('li', { class: 'installa__stand' },
    h('div', { class: 'installa__stand-testa' },
      h('div', { class: 'installa__numero' },
        h('span', { class: 'installa__etichetta' }, 'Stand'),
        h('strong', {}, g.stand || '—')),
      h('div', { class: 'installa__cliente' },
        h('strong', {}, g.cliente || 'Cliente non indicato'),
        h('span', {}, `${numero(tv)} ${tv === 1 ? 'apparecchio' : 'apparecchi'}`)),
      planimetria && g.stand ? h('button', {
        class: 'btn btn--mini',
        onclick: () => apriLaPianta(fiera, planimetria, g.stand),
      }, 'Dov\'è?') : null),
    h('ul', { class: 'installa__apparecchi' }, g.righe.map((n) => {
      const c = compito(n, fiera);
      return h('li', {},
        h('span', { class: 'installa__apparecchio' },
          n.quantita > 1 ? h('strong', {}, `${n.quantita}× `) : null,
          nomeBreve({ nome: n.prodotto_nome, marca: n.prodotto_marca, pollici: n.prodotto_pollici }),
          n.prodotto_codice ? h('span', { class: 'installa__codice' }, idProdotto(n.prodotto_codice)) : null,
          misure(n) ? h('span', { class: 'installa__misure' }, misure(n)) : null),
        h('span', { class: `installa__compito installa__compito--${c.classe}` }, c.testo));
    })));
}

function schedaFiera(fiera, gruppi) {
  const righe = gruppi.flatMap((g) => g.righe);
  const conta = (classe) => righe.filter((n) => compito(n, fiera).classe === classe)
    .reduce((t, n) => t + n.quantita, 0);
  const daFare = conta('da-fare');
  const daRitirare = conta('ritiro');
  const montaggio = fiera.giorni_allestimento > 0 ? addGiorni(fiera.data_inizio, -fiera.giorni_allestimento) : null;
  const dove = [fiera.luogo, fiera.citta, fiera.padiglione && `pad. ${fiera.padiglione}`].filter(Boolean).join(' · ');

  return h('section', { class: 'installa' },
    h('header', { class: 'installa__testa' },
      h('div', {},
        h('h2', {}, fiera.nome),
        h('p', { class: 'installa__quando' }, intervalloDate(fiera.data_inizio, fiera.data_fine),
          montaggio ? h('span', {}, ` · montaggio dal ${dataLunga(montaggio)}`) : null),
        dove ? h('p', { class: 'installa__dove' }, dove) : null),
      h('div', { class: 'installa__conteggi' },
        daFare ? h('span', { class: 'installa__compito installa__compito--da-fare' }, `${numero(daFare)} da installare`) : null,
        daRitirare ? h('span', { class: 'installa__compito installa__compito--ritiro' }, `${numero(daRitirare)} da ritirare`) : null,
        !daFare && !daRitirare ? h('span', { class: 'installa__compito installa__compito--fatto' }, 'Tutto installato') : null)),
    fiera.allegati.length ? h('div', { class: 'installa__piante' },
      fiera.allegati.map((a) => h('button', {
        class: 'btn btn--primario btn--mini',
        onclick: () => apriLaPianta(fiera, a),
      }, fiera.allegati.length > 1 ? `Pianta con TV · ${a.nome}` : 'Pianta con TV')))
      : h('p', { class: 'installa__senza-pianta' }, 'Planimetria non ancora caricata dall\'ufficio.'),
    h('ul', { class: 'installa__elenco' }, gruppi.map((g) => schedaStand(g, fiera))));
}

export default async function vistaInstallazioni({ corpo }) {
  const fiere = await api.installazioni();
  if (!fiere.length) {
    monta(corpo, vuoto('Nessuna installazione in programma',
      'Quando l\'ufficio prenota dei televisori per una fiera, li trovi qui con stand e pianta.'));
    return;
  }

  const cerca = h('input', {
    class: 'controllo', type: 'search', placeholder: 'Cerca stand, cliente, fiera o ID…', 'aria-label': 'Cerca',
  });
  const elenco = h('div', { class: 'installazioni' });

  const disegna = () => {
    const q = cerca.value.trim().toLowerCase();
    const sezioni = fiere.map((f) => {
      const gruppi = perStand(f.installazioni).filter((g) => !q || testoRicerca(f, g).includes(q));
      return gruppi.length ? schedaFiera(f, gruppi) : null;
    }).filter(Boolean);
    monta(elenco, sezioni.length ? sezioni : vuoto('Nessun risultato', 'Prova con un altro numero di stand o nome.'));
  };
  cerca.addEventListener('input', disegna);

  monta(corpo, h('div', { class: 'filtri' }, cerca), elenco);
  disegna();
}
