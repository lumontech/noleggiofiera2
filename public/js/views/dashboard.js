import { api } from '../api.js';
import { h, monta, badge, dataLunga, intervalloDate, numero, vuoto } from '../ui.js';

const scheda = (etichetta, valore, dettaglio, tono = '') => h('div', { class: `kpi ${tono}` },
  h('p', { class: 'kpi__etichetta' }, etichetta),
  h('p', { class: 'kpi__valore' }, valore),
  dettaglio && h('p', { class: 'kpi__dettaglio' }, dettaglio));

function barraOccupazione(impegnati, totale) {
  const perc = totale ? Math.min(Math.round((impegnati / totale) * 100), 100) : 0;
  return h('div', { class: 'barra-occupazione', title: `${perc}% del parco impegnato` },
    h('div', { class: 'barra-occupazione__riempimento', style: { width: `${perc}%` } }));
}

function pannello(titolo, sottotitolo, contenuto, azione) {
  return h('section', { class: 'pannello' },
    h('header', { class: 'pannello__testa' },
      h('div', {}, h('h2', {}, titolo), sottotitolo && h('p', {}, sottotitolo)),
      azione),
    contenuto);
}

export default async function vistaDashboard({ corpo, vai }) {
  const d = await api.dashboard();
  const { totali } = d;

  const prossime = d.prossime_fiere.length
    ? h('ul', { class: 'lista' }, d.prossime_fiere.map((f) => h('li', { class: 'lista__riga' },
        h('div', {},
          h('p', { class: 'lista__titolo' }, f.nome),
          h('p', { class: 'lista__testo' },
            [f.citta, f.luogo].filter(Boolean).join(' · ') || 'Sede da definire',
            ' — ', intervalloDate(f.data_inizio, f.data_fine))),
        h('div', { class: 'lista__coda' },
          badge(f.stato),
          h('span', { class: 'contatore' }, `${numero(f.pezzi)} pz`),
          h('span', { class: 'lista__nota' },
            f.giorni_mancanti > 0 ? `tra ${f.giorni_mancanti} gg`
              : f.giorni_mancanti === 0 ? 'inizia oggi' : 'in corso')))))
    : vuoto('Nessuna fiera in programma', 'Aggiungi la prossima fiera per iniziare a pianificare.');

  const consegne = d.consegne_imminenti.length
    ? h('ul', { class: 'lista' }, d.consegne_imminenti.map((n) => h('li', { class: 'lista__riga' },
        h('div', {},
          h('p', { class: 'lista__titolo' }, `${n.quantita}× ${n.prodotto_nome}`),
          h('p', { class: 'lista__testo' }, n.fiera_nome, n.fiera_citta ? ` · ${n.fiera_citta}` : '')),
        h('span', { class: 'lista__nota' }, dataLunga(n.data_inizio)))))
    : vuoto('Nessuna consegna nei prossimi 14 giorni');

  const rientri = d.rientri_attesi.length
    ? h('ul', { class: 'lista' }, d.rientri_attesi.map((n) => h('li', { class: 'lista__riga' },
        h('div', {},
          h('p', { class: 'lista__titolo' }, `${n.quantita}× ${n.prodotto_nome}`),
          h('p', { class: 'lista__testo' }, n.fiera_nome)),
        h('span', { class: 'lista__nota lista__nota--allerta' },
          `atteso il ${dataLunga(n.data_fine)}`))))
    : vuoto('Nessun rientro in ritardo', 'Tutto il materiale consegnato è nei tempi.');

  monta(corpo,
    d.criticita.length ? h('div', { class: 'allerta' },
      h('p', { class: 'allerta__titolo' }, '⚠ Sovra-impegno rilevato nei prossimi 30 giorni'),
      h('ul', {}, d.criticita.map((c) => h('li', {},
        `${c.prodotto}: ${c.impegnati} pezzi prenotati su ${c.quantita} disponibili il ${dataLunga(c.giorno)}`)))) : null,

    h('div', { class: 'kpi-griglia' },
      scheda('Parco totale', numero(totali.pezzi), `${numero(d.prodotti_totali)} articoli a catalogo`),
      scheda('Noleggiati oggi', numero(totali.impegnati), `${numero(d.noleggi_attivi)} righe di noleggio attive`, 'kpi--occupato'),
      scheda('Liberi oggi', numero(totali.disponibili), 'pronti da noleggiare', 'kpi--libero'),
      scheda('Fiere in corso', numero(d.fiere_in_corso), `${numero(d.fiere_totali)} fiere registrate`)),

    h('section', { class: 'pannello' },
      h('header', { class: 'pannello__testa' },
        h('div', {},
          h('h2', {}, 'Occupazione del magazzino oggi'),
          h('p', {}, `${numero(totali.impegnati)} pezzi su ${numero(totali.pezzi)} sono fuori`
            + `${totali.manutenzione ? `, ${numero(totali.manutenzione)} in manutenzione` : ''} · ${dataLunga(d.oggi)}`)),
        h('button', { class: 'btn', onclick: () => vai('disponibilita') }, 'Vedi disponibilità')),
      barraOccupazione(totali.impegnati, totali.pezzi)),

    h('div', { class: 'colonne' },
      pannello('Prossime fiere', 'Cosa arriva in calendario',
        prossime,
        h('button', { class: 'btn', onclick: () => vai('fiere') }, 'Tutte le fiere')),
      h('div', { class: 'colonne__pila' },
        pannello('Consegne imminenti', 'Da preparare entro 14 giorni', consegne),
        pannello('Rientri attesi', 'Materiale consegnato oltre la data di fine', rientri))));
}
