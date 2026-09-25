// Vista chiave: in un periodo a scelta, cosa è libero da noleggiare e cosa è
// già noleggiato. Include una timeline stile Gantt dell'occupazione.

import { api } from '../api.js';
import { stato as statoApp } from '../app.js';
import {
  h, monta, badge, numero, vuoto, intervalloDate, dataBreve, dataLunga,
  oggiISO, addGiorni, giorniTra, select,
} from '../ui.js';

const PERIODI_RAPIDI = [
  { id: 'oggi', testo: 'Oggi', calcola: (o) => [o, o] },
  { id: 'settimana', testo: 'Prossimi 7 giorni', calcola: (o) => [o, addGiorni(o, 6)] },
  { id: 'mese', testo: 'Prossimi 30 giorni', calcola: (o) => [o, addGiorni(o, 29)] },
  { id: 'trimestre', testo: 'Prossimi 90 giorni', calcola: (o) => [o, addGiorni(o, 89)] },
];

function barra(impegnati, totale) {
  const perc = totale ? Math.min(Math.round((impegnati / totale) * 100), 100) : 0;
  return h('div', { class: 'barra-occupazione barra-occupazione--sottile' },
    h('div', { class: 'barra-occupazione__riempimento', style: { width: `${perc}%` } }));
}

function rigaDisponibile(r) {
  const p = r.prodotto;
  return h('li', { class: 'disp-riga disp-riga--libera' },
    h('div', { class: 'disp-riga__info' },
      h('p', { class: 'disp-riga__nome' }, p.nome),
      h('p', { class: 'disp-riga__meta' },
        p.categoria, p.pollici ? ` · ${p.pollici}"` : '', p.codice ? ` · ${p.codice}` : '')),
    h('div', { class: 'disp-riga__numeri' },
      h('span', { class: 'disp-riga__cifra disp-riga__cifra--verde' }, numero(r.disponibili)),
      h('span', { class: 'disp-riga__testo' }, `liberi su ${numero(p.quantita)}`)),
    barra(r.impegnati, p.quantita));
}

function rigaOccupata(r) {
  const p = r.prodotto;
  return h('li', { class: `disp-riga ${r.sovra_impegno ? 'disp-riga--critica' : 'disp-riga--occupata'}` },
    h('div', { class: 'disp-riga__info' },
      h('p', { class: 'disp-riga__nome' }, p.nome),
      h('p', { class: 'disp-riga__meta' },
        r.noleggi.map((n) => `${n.quantita}× ${n.fiera_nome}`).join(' · '))),
    h('div', { class: 'disp-riga__numeri' },
      h('span', { class: 'disp-riga__cifra disp-riga__cifra--ambra' }, numero(r.impegnati)),
      h('span', { class: 'disp-riga__testo' },
        r.sovra_impegno
          ? `⚠ ${numero(r.sovra_impegno)} oltre lo stock`
          : `impegnati su ${numero(p.quantita)}`)),
    barra(r.impegnati, p.quantita));
}

/* ---------- timeline ---------- */

function timeline(dati) {
  const { from, to, giorni } = dati.periodo;
  const colonne = [];
  for (let i = 0; i < giorni; i += 1) colonne.push(addGiorni(from, i));
  const passo = giorni > 60 ? 7 : giorni > 30 ? 3 : 1;
  const oggi = oggiISO();

  const intestazione = h('div', { class: 'gantt__riga gantt__riga--testa' },
    h('div', { class: 'gantt__etichetta' }, 'Prodotto'),
    h('div', { class: 'gantt__pista' },
      colonne.map((g, i) => h('div', {
        class: `gantt__giorno ${g === oggi ? 'gantt__giorno--oggi' : ''} ${
          ['0', '6'].includes(String(new Date(`${g}T00:00:00Z`).getUTCDay())) ? 'gantt__giorno--festivo' : ''}`,
        style: { width: `${100 / giorni}%` },
      }, i % passo === 0 ? h('span', {}, dataBreve(g)) : null))));

  const righe = dati.prodotti.map((p) => h('div', { class: 'gantt__riga' },
    h('div', { class: 'gantt__etichetta', title: p.nome },
      h('strong', {}, p.nome),
      h('span', {}, `${p.quantita} pz`)),
    h('div', { class: 'gantt__pista' },
      colonne.map((g) => h('div', {
        class: `gantt__giorno ${g === oggi ? 'gantt__giorno--oggi' : ''} ${
          ['0', '6'].includes(String(new Date(`${g}T00:00:00Z`).getUTCDay())) ? 'gantt__giorno--festivo' : ''}`,
        style: { width: `${100 / giorni}%` },
      })),
      p.blocchi.map((b) => {
        const inizio = b.data_inizio < from ? from : b.data_inizio;
        const fine = b.data_fine > to ? to : b.data_fine;
        const offset = giorniTra(from, inizio) - 1;
        const durata = giorniTra(inizio, fine);
        return h('div', {
          class: `gantt__blocco gantt__blocco--${b.stato}`,
          style: { left: `${(offset / giorni) * 100}%`, width: `${(durata / giorni) * 100}%` },
          title: `${b.fiera_nome} — ${b.quantita} pz — ${intervalloDate(b.data_inizio, b.data_fine)} (${b.stato})`,
        }, h('span', {}, `${b.quantita}× ${b.fiera_nome}`));
      }))));

  return h('div', { class: 'gantt' }, intestazione, righe.length ? righe : vuoto('Nessun prodotto a catalogo'));
}

/* ---------- vista ---------- */

export default async function vistaDisponibilita({ corpo, azioni }) {
  const oggi = oggiISO();
  const stato = { from: oggi, to: addGiorni(oggi, 6), categoria: '', scheda: 'disponibili' };

  const campoDa = h('input', { class: 'controllo', type: 'date', value: stato.from });
  const campoA = h('input', { class: 'controllo', type: 'date', value: stato.to });
  const risultato = h('div', {});
  const pistaGantt = h('div', {});

  const selCategoria = select('categoria',
    [{ valore: '', testo: 'Tutte le categorie' },
      ...statoApp.costanti.categorie.map((c) => ({ valore: c, testo: c }))], '');

  const rapidi = h('div', { class: 'periodi' }, PERIODI_RAPIDI.map((p) => h('button', {
    class: 'chip', dataset: { periodo: p.id },
    onclick: () => {
      const [da, a] = p.calcola(oggiISO());
      campoDa.value = da; campoA.value = a;
      aggiorna();
    },
  }, p.testo)));

  async function aggiorna() {
    stato.from = campoDa.value || oggi;
    stato.to = campoA.value && campoA.value >= stato.from ? campoA.value : stato.from;
    campoA.value = stato.to;
    stato.categoria = selCategoria.value;

    monta(risultato, h('p', { class: 'caricamento' }, 'Calcolo disponibilità…'));
    const [dati, gantt] = await Promise.all([
      api.disponibilita({ from: stato.from, to: stato.to, categoria: stato.categoria }),
      api.timeline({ from: stato.from, to: stato.to }),
    ]);

    for (const chip of rapidi.querySelectorAll('.chip')) {
      const def = PERIODI_RAPIDI.find((p) => p.id === chip.dataset.periodo);
      const [da, a] = def.calcola(oggiISO());
      chip.classList.toggle('chip--attivo', da === stato.from && a === stato.to);
    }

    const { totali, periodo } = dati;
    const elenco = stato.scheda === 'disponibili' ? dati.disponibili : dati.occupati;

    monta(risultato,
      h('div', { class: 'kpi-griglia kpi-griglia--tre' },
        h('div', { class: 'kpi kpi--libero' },
          h('p', { class: 'kpi__etichetta' }, 'Da noleggiare'),
          h('p', { class: 'kpi__valore' }, numero(totali.disponibili)),
          h('p', { class: 'kpi__dettaglio' }, `pezzi liberi per tutto il periodo (${periodo.giorni} gg)`)),
        h('div', { class: 'kpi kpi--occupato' },
          h('p', { class: 'kpi__etichetta' }, 'Noleggiati'),
          h('p', { class: 'kpi__valore' }, numero(totali.impegnati)),
          h('p', { class: 'kpi__dettaglio' }, 'pezzi impegnati nel picco del periodo')),
        h('div', { class: 'kpi' },
          h('p', { class: 'kpi__etichetta' }, 'Parco totale'),
          h('p', { class: 'kpi__valore' }, numero(totali.pezzi)),
          h('p', { class: 'kpi__dettaglio' }, intervalloDate(periodo.from, periodo.to)))),

      h('section', { class: 'pannello' },
        h('div', { class: 'schede' },
          h('button', {
            class: `scheda ${stato.scheda === 'disponibili' ? 'scheda--attiva' : ''}`,
            onclick: () => { stato.scheda = 'disponibili'; aggiorna(); },
          }, `Da noleggiare (${dati.disponibili.length})`),
          h('button', {
            class: `scheda ${stato.scheda === 'occupati' ? 'scheda--attiva' : ''}`,
            onclick: () => { stato.scheda = 'occupati'; aggiorna(); },
          }, `Noleggiati (${dati.occupati.length})`)),
        elenco.length
          ? h('ul', { class: 'disp-lista' },
              elenco.map((r) => (stato.scheda === 'disponibili' ? rigaDisponibile(r) : rigaOccupata(r))))
          : vuoto(
              stato.scheda === 'disponibili' ? 'Nessun prodotto libero nel periodo' : 'Nessun prodotto impegnato nel periodo',
              stato.scheda === 'disponibili'
                ? 'Tutto il materiale è già assegnato: valuta di ampliare il parco o spostare le date.'
                : 'Il magazzino è completamente libero in queste date.')));

    monta(pistaGantt,
      h('section', { class: 'pannello' },
        h('header', { class: 'pannello__testa' },
          h('div', {},
            h('h2', {}, 'Calendario occupazione'),
            h('p', {}, 'Ogni barra è un noleggio: passa sopra per vedere fiera, pezzi e date.')),
          h('div', { class: 'legenda' },
            h('span', { class: 'legenda__voce legenda__voce--prenotato' }, 'Prenotato'),
            h('span', { class: 'legenda__voce legenda__voce--consegnato' }, 'Consegnato'))),
        timeline(gantt)));
  }

  campoDa.addEventListener('change', aggiorna);
  campoA.addEventListener('change', aggiorna);
  selCategoria.addEventListener('change', aggiorna);

  azioni.appendChild(h('span', { class: 'intestazione__nota' }, `Oggi: ${dataLunga(oggi)}`));

  monta(corpo,
    h('div', { class: 'filtri filtri--periodo' },
      h('label', { class: 'campo campo--inline' }, h('span', { class: 'campo__etichetta' }, 'Dal'), campoDa),
      h('label', { class: 'campo campo--inline' }, h('span', { class: 'campo__etichetta' }, 'Al'), campoA),
      selCategoria,
      rapidi),
    risultato,
    pistaGantt);

  await aggiorna();
}
