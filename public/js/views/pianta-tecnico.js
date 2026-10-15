// La Planimetria del tecnico: la pianta della fiera con i monitor da
// installare, i padiglioni a portata di clic e un riepilogo di cosa montare.
// In sola lettura e dal canale del tecnico: nessun prezzo arriva fin qui.

import { api } from '../api.js';
import { apriPianta } from '../pianta/visore.js';
import { disegnaBottoniPadiglioni } from '../pianta/padiglioni.js';
import { compito, datiPerTecnico } from './installazioni.js';
import {
  h, monta, vuoto, numero, nomeBreve, intervalloDate, dataLunga, addGiorni, oggiISO, idProdotto,
  select, etichettaMontaggio, eSchermo,
} from '../ui.js';

const parametri = () => new URLSearchParams(location.hash.split('?')[1] || '');

/** Il riepilogo di cosa montare: quanti, cosa e come. */
function riepilogo(fiera) {
  const righe = fiera.installazioni;
  const pezzi = (filtro) => righe.filter(filtro).reduce((t, n) => t + n.quantita, 0);
  const daInstallare = pezzi((n) => compito(n, fiera).classe === 'da-fare');
  const installati = pezzi((n) => compito(n, fiera).classe === 'fatto');
  const daRitirare = pezzi((n) => compito(n, fiera).classe === 'ritiro');
  const stand = new Set(righe.map((n) => `${n.padiglione}|${n.stand}|${n.cliente}`.toLowerCase())).size;

  // Per modello: quanti pezzi e quanti ancora da installare.
  const modelli = new Map();
  for (const n of righe) {
    const nome = nomeBreve({ nome: n.prodotto_nome, marca: n.prodotto_marca, pollici: n.prodotto_pollici });
    const chiave = `${nome}|${n.prodotto_codice}`;
    if (!modelli.has(chiave)) modelli.set(chiave, { nome, codice: n.prodotto_codice, pezzi: 0, daFare: 0 });
    const m = modelli.get(chiave);
    m.pezzi += n.quantita;
    if (compito(n, fiera).classe === 'da-fare') m.daFare += n.quantita;
  }

  // Come vanno montati gli schermi.
  const montaggi = new Map();
  for (const n of righe.filter((r) => eSchermo(r.prodotto_categoria))) {
    const m = n.montaggio ? etichettaMontaggio(n.montaggio) : 'Da definire';
    montaggi.set(m, (montaggi.get(m) || 0) + n.quantita);
  }

  const montaggio = fiera.giorni_allestimento > 0 ? addGiorni(fiera.data_inizio, -fiera.giorni_allestimento) : null;
  const dove = [fiera.luogo, fiera.citta].filter(Boolean).join(' · ');
  return h('section', { class: 'riep-tec' },
    h('div', { class: 'riep-tec__testa' },
      h('div', {},
        h('h2', {}, fiera.nome),
        h('p', {}, intervalloDate(fiera.data_inizio, fiera.data_fine),
          montaggio ? ` · montaggio dal ${dataLunga(montaggio)}` : '', dove ? ` · ${dove}` : '')),
      h('div', { class: 'riep-tec__numeri' },
        h('div', { class: 'riep-tec__numero riep-tec__numero--da-fare' }, h('strong', {}, numero(daInstallare)), 'da installare'),
        h('div', { class: 'riep-tec__numero riep-tec__numero--fatto' }, h('strong', {}, numero(installati)), 'installati'),
        daRitirare ? h('div', { class: 'riep-tec__numero riep-tec__numero--ritiro' }, h('strong', {}, numero(daRitirare)), 'da ritirare') : null,
        h('div', { class: 'riep-tec__numero' }, h('strong', {}, numero(stand)), stand === 1 ? 'stand' : 'stand'))),
    h('div', { class: 'riep-tec__dettagli' },
      h('div', {},
        h('h3', {}, 'Cosa portare'),
        h('ul', { class: 'riep-tec__chip' }, [...modelli.values()]
          .sort((a, b) => b.pezzi - a.pezzi)
          .map((m) => h('li', { title: m.daFare ? `${m.daFare} ancora da installare` : 'Tutti installati' },
            h('strong', {}, `${m.pezzi}×`), ` ${m.nome}`,
            m.codice ? h('span', {}, ` ${idProdotto(m.codice)}`) : null)))),
      montaggi.size ? h('div', {},
        h('h3', {}, 'Montaggio'),
        h('ul', { class: 'riep-tec__chip' }, [...montaggi.entries()].map(([m, q]) => h('li', {}, h('strong', {}, `${q}×`), ` ${m.toLowerCase()}`)))) : null));
}

export default async function vistaPiantaTecnico({ corpo }) {
  const fiere = await api.installazioni();
  if (!fiere.length) {
    monta(corpo, vuoto('Nessuna installazione in programma',
      'Quando l\'ufficio prenota dei televisori per una fiera, li trovi qui sulla pianta.'));
    return;
  }

  // Si parte dalla fiera nell'indirizzo, o dalla prima non ancora finita.
  const idFiera = Number(parametri().get('fiera'));
  const fiera = fiere.find((f) => f.id === idFiera)
    || fiere.find((f) => f.data_fine >= oggiISO()) || fiere[0];
  const piante = fiera.allegati.filter((a) => a.tipo === 'application/pdf' || a.tipo.startsWith('image/'));

  const selFiera = select('fiera', fiere.map((f) => ({
    valore: f.id, testo: `${f.nome} — ${intervalloDate(f.data_inizio, f.data_fine)}`,
  })), fiera.id);
  selFiera.addEventListener('change', () => { location.hash = `#/planimetria?fiera=${selFiera.value}`; });

  const barraPadiglioni = h('nav', { class: 'padiglioni', 'aria-label': 'Planimetrie della fiera' });
  const zona = h('div', { class: 'nol-pianta' });
  monta(corpo,
    fiere.length > 1 ? h('div', { class: 'filtri' }, selFiera) : null,
    riepilogo(fiera),
    piante.length > 1 ? barraPadiglioni : null,
    zona);

  if (!piante.length) {
    monta(zona, vuoto('Planimetria non ancora caricata',
      'L\'ufficio non ha ancora allegato la pianta di questa fiera: trovi stand e monitor in "Installazioni".'));
    return;
  }

  const padLetti = new Map();
  const conta = (id) => fiera.installazioni.filter((n) => n.segnaposto_allegato === id).length;
  // Senza una scelta precisa, si apre la planimetria con più monitor sopra.
  const piuPiena = [...piante].sort((x, y) => conta(y.id) - conta(x.id))[0];
  let aperta = piante.find((a) => a.id === Number(parametri().get('pianta'))) || piuPiena;

  async function apri(a) {
    aperta = a;
    history.replaceState(null, '', `#/planimetria?fiera=${fiera.id}&pianta=${a.id}`);
    if (piante.length > 1) disegnaBottoniPadiglioni(barraPadiglioni, { piante, aperta, padLetti, conta, onScegli: apri });
    const pianta = await apriPianta({
      fiera,
      allegato: a,
      contenitore: zona,
      solaLettura: true,
      latoIniziale: true,
      caricaDati: datiPerTecnico(fiera, a),
    });
    if (pianta?.padiglione && !padLetti.has(a.id)) {
      padLetti.set(a.id, pianta.padiglione);
      if (piante.length > 1) disegnaBottoniPadiglioni(barraPadiglioni, { piante, aperta, padLetti, conta, onScegli: apri });
    }
  }
  await apri(aperta);
}
