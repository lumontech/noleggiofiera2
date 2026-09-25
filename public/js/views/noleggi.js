// Noleggi raggruppati per fiera: date e nome della fiera compaiono una volta
// sola nell'intestazione del gruppo invece di ripetersi su ogni riga, e i
// noleggi ancora da gestire stanno separati dallo storico.

import { api } from '../api.js';
import { stato as statoApp } from '../app.js';
import { selettoreApparecchi } from '../selettore-apparecchi.js';
import {
  h, monta, badge, modale, avviso, campo, input, select, areaTesto,
  griglia, numero, euro, vuoto, intervalloDate, dataLunga, etichetta, oggiISO, nomeBreve,
  idProdotto,
} from '../ui.js';

const PROSSIMO_STATO = { prenotato: 'consegnato', consegnato: 'rientrato' };
const AZIONE = { prenotato: 'Segna consegnato', consegnato: 'Segna rientrato' };
const ATTIVI = ['prenotato', 'consegnato'];

const SCHEDE = [
  { id: 'attivi', testo: 'Da gestire', filtro: (n) => ATTIVI.includes(n.stato) },
  { id: 'storico', testo: 'Storico', filtro: (n) => !ATTIVI.includes(n.stato) },
  { id: 'tutti', testo: 'Tutti', filtro: () => true },
];

/* ---------- form ---------- */

function apriForm(n, fiere, ricarica) {
  const modifica = Boolean(n?.id);
  if (!fiere.length) {
    return avviso('Crea prima una fiera: ogni noleggio appartiene a una fiera.', 'attenzione');
  }
  const { stati_noleggio: statiNoleggio } = statoApp.costanti;

  // Nuovo noleggio: si parte dalla prossima fiera, che è il caso più comune.
  const fieraIniziale = n?.fiera_id ?? fiere[0].id;
  const selettore = selettoreApparecchi({ selezionato: n?.prodotto_id ?? null, escludi: n?.id ?? null });
  const daInizio = input('data_inizio', { value: n?.data_inizio || '', type: 'date', required: true });
  const aFine = input('data_fine', { value: n?.data_fine || '', type: 'date', required: true });
  const selFiera = select('fiera_id',
    fiere.map((f) => ({ valore: f.id, testo: `${f.nome} — ${intervalloDate(f.data_inizio, f.data_fine)}` })),
    fieraIniziale);

  const aggiorna = () => selettore.aggiorna(daInizio.value, aFine.value);
  const dateDellaFiera = async () => {
    const finestra = await api.finestraFiera(selFiera.value);
    daInizio.value = finestra.data_inizio;
    aFine.value = finestra.data_fine;
    aggiorna();
  };
  selFiera.addEventListener('change', dateDellaFiera);
  daInizio.addEventListener('change', aggiorna);
  aFine.addEventListener('change', aggiorna);

  modale({
    titolo: modifica ? (n.cliente || 'Noleggio') : 'Nuovo noleggio',
    sottotitolo: modifica
      ? `${nomeBreve({ nome: n.prodotto_nome, marca: n.prodotto_marca, pollici: n.prodotto_pollici })} · ${n.fiera_nome}`
      : 'Scegli la fiera: le date si compilano da sole e vedi solo gli apparecchi liberi.',
    corpo: [
      griglia(
        campo('Cliente', input('cliente', { value: n?.cliente || '', placeholder: 'Nome dell\'azienda espositrice' })),
        campo('Stand', input('stand', { value: n?.stand || '', placeholder: 'PAD 5 - 5042' })),
        campo('Fiera', selFiera, { largo: true }),
        campo('Uscita dal magazzino', daInizio),
        campo('Rientro in magazzino', aFine),
        h('label', { class: 'campo campo--largo' },
          h('span', { class: 'campo__etichetta' }, 'Apparecchio'),
          selettore.select,
          selettore.nota),
        campo('Importo (€)', input('importo', {
          value: n?.importo ?? '', type: 'number', min: '0', step: '0.01', placeholder: 'calcolato dal listino',
        }), { aiuto: 'Totale del lavoro, non il prezzo al giorno.' }),
        campo('Pezzi', input('quantita', { value: n?.quantita ?? 1, type: 'number', min: '1', required: true })),
        campo('Stato', select('stato', statiNoleggio, n?.stato || 'prenotato')),
        campo('Note', areaTesto('note', { value: (n?.note || '').replace(/\[airtable:[^\]]+\]/g, '').trim() }), { largo: true }),
      ),
    ],
    testoConferma: modifica ? 'Salva modifiche' : 'Crea noleggio',
    larga: true,
    azionePericolosa: modifica ? {
      testo: 'Elimina noleggio',
      testoConferma: 'Clicca ancora per eliminare',
      onClick: async () => {
        await api.eliminaNoleggio(n.id);
        avviso('Noleggio eliminato.');
        await ricarica();
      },
    } : null,
    onConferma: async (dati) => {
      if (modifica) await api.modificaNoleggio(n.id, dati);
      else await api.creaNoleggio(dati);
      avviso(modifica ? 'Noleggio aggiornato.' : 'Noleggio creato.');
      await ricarica();
    },
  });

  // In modifica si tengono le date del noleggio; se nuovo, quelle della fiera.
  if (modifica) aggiorna();
  else dateDellaFiera();
  return null;
}

/* ---------- gruppi per fiera ---------- */

function quando(inizio, fine) {
  const oggi = oggiISO();
  const giorni = Math.round((new Date(`${inizio}T00:00:00Z`) - new Date(`${oggi}T00:00:00Z`)) / 86400000);
  if (inizio <= oggi && fine >= oggi) return { testo: 'in corso', tono: 'in-corso' };
  if (giorni === 1) return { testo: 'domani', tono: 'vicina' };
  if (giorni > 0) return { testo: `tra ${giorni} gg`, tono: giorni <= 14 ? 'vicina' : 'futura' };
  return { testo: 'conclusa', tono: 'passata' };
}

function raggruppa(elenco) {
  const gruppi = new Map();
  for (const n of elenco) {
    if (!gruppi.has(n.fiera_id)) {
      gruppi.set(n.fiera_id, {
        id: n.fiera_id,
        nome: n.fiera_nome,
        citta: n.fiera_citta,
        inizio: n.fiera_inizio,
        fine: n.fiera_fine,
        righe: [],
      });
    }
    gruppi.get(n.fiera_id).righe.push(n);
  }
  for (const g of gruppi.values()) {
    g.righe.sort((a, b) => (a.cliente || '~').localeCompare(b.cliente || '~', 'it'));
    g.pezzi = g.righe.reduce((t, n) => t + n.quantita, 0);
    g.clienti = new Set(g.righe.map((n) => n.cliente).filter(Boolean)).size;
    g.importo = g.righe.reduce((t, n) => t + n.importo, 0);
  }
  return [...gruppi.values()];
}

function riga(n, azioni) {
  const oggi = oggiISO();
  // Le date compaiono sulla riga solo quando differiscono da quelle della fiera.
  const dateProprie = n.data_inizio !== n.fiera_inizio || n.data_fine !== n.fiera_fine;
  const inRitardo = n.stato === 'consegnato' && n.data_fine < oggi;
  const apparecchio = { nome: n.prodotto_nome, marca: n.prodotto_marca, pollici: n.prodotto_pollici };

  return h('li', {
    class: `nol-riga nol-riga--${n.stato}`,
    tabindex: 0,
    role: 'button',
    title: 'Apri per modificare',
    onclick: () => azioni.apri(n),
    onkeydown: (e) => { if (e.key === 'Enter') azioni.apri(n); },
  },
  h('div', { class: 'nol-riga__cliente' },
    h('strong', {}, n.cliente || 'Cliente non indicato'),
    h('span', {}, [n.stand && `Stand ${n.stand}`, dateProprie && intervalloDate(n.data_inizio, n.data_fine)]
      .filter(Boolean).join(' · ') || ' ')),
  h('div', { class: 'nol-riga__apparecchio', title: n.prodotto_nome },
    h('strong', {}, nomeBreve(apparecchio), n.quantita > 1 ? h('em', {}, ` ×${n.quantita}`) : null),
    h('span', {}, idProdotto(n.prodotto_codice) || n.prodotto_categoria)),
  h('div', { class: 'nol-riga__importo' }, euro(n.importo)),
  h('div', { class: 'nol-riga__stato' },
    badge(n.stato),
    inRitardo ? h('span', { class: 'nol-riga__ritardo' }, `rientro atteso dal ${dataLunga(n.data_fine)}`) : null),
  h('div', { class: 'nol-riga__azione' },
    PROSSIMO_STATO[n.stato]
      ? h('button', {
          class: 'btn btn--mini btn--primario',
          title: `Segna come ${etichetta(PROSSIMO_STATO[n.stato]).toLowerCase()}`,
          onclick: (e) => { e.stopPropagation(); azioni.avanza(n); },
        }, AZIONE[n.stato])
      : null));
}

function gruppo(g, { aperto, azioni }) {
  const q = quando(g.inizio, g.fine);
  return h('details', { class: `nol-gruppo nol-gruppo--${q.tono}`, open: aperto },
    h('summary', { class: 'nol-gruppo__testa' },
      h('div', { class: 'nol-gruppo__titolo' },
        h('h3', {}, g.nome),
        h('p', {},
          intervalloDate(g.inizio, g.fine),
          g.citta ? ` · ${g.citta}` : '',
          h('span', { class: `nol-quando nol-quando--${q.tono}` }, q.testo))),
      h('div', { class: 'nol-gruppo__numeri' },
        h('span', {}, h('strong', {}, numero(g.pezzi)), g.pezzi === 1 ? ' apparecchio' : ' apparecchi'),
        h('span', {}, h('strong', {}, numero(g.clienti)), g.clienti === 1 ? ' cliente' : ' clienti'),
        h('span', { class: 'nol-gruppo__importo' }, euro(g.importo)))),
    h('ul', { class: 'nol-righe' }, g.righe.map((n) => riga(n, azioni))));
}

/* ---------- vista ---------- */

export default async function vistaNoleggi({ corpo, azioni, ricarica }) {
  const [prodotti, fiere] = await Promise.all([api.prodotti(), api.fiere()]);
  // Nel modulo si propone per prima la fiera più vicina ancora da svolgere.
  const fiereOrdinate = [...fiere].sort((a, b) => {
    const oggi = oggiISO();
    const futuraA = a.data_fine >= oggi;
    const futuraB = b.data_fine >= oggi;
    if (futuraA !== futuraB) return futuraA ? -1 : 1;
    return a.data_inizio.localeCompare(b.data_inizio);
  });

  azioni.appendChild(h('button', {
    class: 'btn btn--primario',
    onclick: () => apriForm(null, fiereOrdinate, ricarica),
  }, '+ Nuovo noleggio'));

  const filtri = { q: '', fiera_id: '', prodotto_id: '' };
  let scheda = 'attivi';
  let elenco = [];
  const barraSchede = h('div', { class: 'schede nol-schede', role: 'tablist' });
  const contenitore = h('div', { class: 'nol-gruppi' });

  const azioniRiga = {
    apri: (n) => apriForm(n, fiereOrdinate, ricarica),
    avanza: async (n) => {
      const nuovo = PROSSIMO_STATO[n.stato];
      await api.statoNoleggio(n.id, nuovo);
      avviso(`${n.cliente || 'Noleggio'}: segnato come ${etichetta(nuovo).toLowerCase()}.`);
      await carica();
    },
  };

  function disegna() {
    // Conteggi sulle schede, così si vede subito quanto c'è da gestire.
    monta(barraSchede, SCHEDE.map((s) => h('button', {
      class: `scheda ${s.id === scheda ? 'scheda--attiva' : ''}`,
      role: 'tab',
      'aria-selected': s.id === scheda ? 'true' : 'false',
      dataset: { scheda: s.id },
      onclick: () => { scheda = s.id; disegna(); },
    }, s.testo, h('span', { class: 'scheda__conta' }, numero(elenco.filter(s.filtro).length)))));

    const def = SCHEDE.find((s) => s.id === scheda);
    const visibili = elenco.filter(def.filtro);
    const gruppi = raggruppa(visibili);
    // Sempre in ordine di calendario: prima la fiera che viene prima.
    gruppi.sort((a, b) => a.inizio.localeCompare(b.inizio));

    if (!gruppi.length) {
      const vuotoAttivi = scheda === 'attivi' && !filtri.q;
      monta(contenitore, vuoto(
        vuotoAttivi ? 'Nessun noleggio da gestire' : 'Nessun noleggio trovato',
        vuotoAttivi ? 'Tutto il materiale è rientrato. Lo trovi nello storico.' : 'Prova a cambiare i filtri.',
        vuotoAttivi ? h('button', { class: 'btn', onclick: () => { scheda = 'storico'; disegna(); } }, 'Vai allo storico') : null));
      return;
    }

    const cercando = Boolean(filtri.q || filtri.fiera_id || filtri.prodotto_id);
    const importo = visibili.reduce((t, n) => t + n.importo, 0);
    monta(contenitore,
      h('p', { class: 'riepilogo-filtro' },
        `${numero(visibili.length)} noleggi in ${numero(gruppi.length)} `
        + `${gruppi.length === 1 ? 'fiera' : 'fiere'} · ${euro(importo)}`,
        scheda !== 'attivi' && !cercando ? ' · clicca una fiera per vederne i noleggi' : ''),
      gruppi.map((g, i) => gruppo(g, {
        // Lo storico parte chiuso: si legge come un elenco di fiere, e si apre
        // solo quella che interessa. Cercando, si apre tutto ciò che corrisponde.
        aperto: scheda === 'attivi' || cercando || (scheda === 'tutti' && i < 2),
        azioni: azioniRiga,
      })));
  }

  async function carica() {
    elenco = await api.noleggi(filtri);
    disegna();
  }

  const cerca = input('q', { placeholder: 'Cerca cliente, stand, apparecchio o fiera…', type: 'search' });
  let attesa;
  cerca.addEventListener('input', () => {
    clearTimeout(attesa);
    attesa = setTimeout(() => { filtri.q = cerca.value.trim(); carica(); }, 180);
  });

  const selFiera = select('fiera_id',
    [{ valore: '', testo: 'Tutte le fiere' }, ...fiere.map((f) => ({ valore: f.id, testo: f.nome }))], '');
  selFiera.addEventListener('change', () => { filtri.fiera_id = selFiera.value; carica(); });

  const selProdotto = select('prodotto_id',
    [{ valore: '', testo: 'Tutti gli apparecchi' },
      ...prodotti.map((p) => ({ valore: p.id, testo: `${nomeBreve(p)} — ${idProdotto(p.codice) || p.nome}` }))], '');
  selProdotto.addEventListener('change', () => { filtri.prodotto_id = selProdotto.value; carica(); });

  monta(corpo,
    h('div', { class: 'filtri' }, cerca, selFiera, selProdotto),
    barraSchede,
    contenitore);
  await carica();
}
