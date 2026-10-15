// Noleggi, in tre schermate:
// - Elenco: i noleggi raggruppati per fiera. Date e nome della fiera compaiono
//   una volta sola nell'intestazione del gruppo, e i noleggi ancora da gestire
//   stanno separati dallo storico.
// - Monitor disponibili: cosa è ancora libero nelle date di una fiera.
// - Planimetria: si trascinano i monitor liberi sulla pianta della fiera; ogni
//   monitor lasciato sulla pianta è un noleggio, salvato subito, che il
//   tecnico ritrova sulla sua pianta.

import { api, caricaAllegato } from '../api.js';
import { apriPianta } from '../pianta/visore.js';
import { stato as statoApp } from '../app.js';
import { selettoreApparecchi } from '../selettore-apparecchi.js';
import { apriDocumenti } from '../documenti.js';
import { standInColonne, padiglione } from '../pianta/stand.js';
import {
  h, monta, badge, modale, avviso, campo, input, select, areaTesto,
  griglia, numero, euro, vuoto, intervalloDate, dataLunga, etichetta, oggiISO, nomeBreve,
  idProdotto,
  campiMontaggio, badgeMontaggio, eSchermo, avvisoPiantane,
  noteInBreve,
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

  // Le fiere già svolte sono in archivio: si propongono solo quelle da fare,
  // più quella del noleggio che si sta modificando.
  const scegliibili = fiere.filter((f) => f.data_fine >= oggiISO() || f.id === n?.fiera_id);
  const elencoFiere = scegliibili.length ? scegliibili : fiere;
  // Nuovo noleggio: si parte dalla prossima fiera, che è il caso più comune.
  const fieraIniziale = n?.fiera_id ?? elencoFiere[0].id;
  const selettore = selettoreApparecchi({ selezionato: n?.prodotto_id ?? null, escludi: n?.id ?? null });
  const daInizio = input('data_inizio', { value: n?.data_inizio || '', type: 'date', required: true });
  const aFine = input('data_fine', { value: n?.data_fine || '', type: 'date', required: true });
  const selFiera = select('fiera_id',
    elencoFiere.map((f) => ({ valore: f.id, testo: `${f.nome} — ${intervalloDate(f.data_inizio, f.data_fine)}` })),
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
        h('div', { class: 'campi-posto' },
          campo('Padiglione', input('padiglione', { value: n?.padiglione || '', placeholder: '5', maxlength: 40 })),
          campo('Stand', input('stand', { value: n?.stand || '', placeholder: '5042' }))),
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
        ...campiMontaggio(n || {}),
        campo('Note interne', areaTesto('note', { value: (n?.note || '').replace(/\[airtable:[^\]]+\]/g, '').trim() }),
          { largo: true, aiuto: 'Solo per l\'ufficio: il tecnico non le vede.' }),
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
      const salvato = modifica ? await api.modificaNoleggio(n.id, dati) : await api.creaNoleggio(dati);
      avviso(modifica ? 'Noleggio aggiornato.' : 'Noleggio creato.');
      avvisoPiantane(salvato);
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

/**
 * La piantana abbinata a un TV non fa riga a sé (sembrerebbe un secondo
 * noleggio dello stesso espositore): sta nella riga del TV, sotto il
 * montaggio. Resta a sé solo se il suo TV non è nell'elenco.
 */
function conPiantaneNelTv(noleggi) {
  const ids = new Set(noleggi.map((n) => n.id));
  const piantane = new Map();
  for (const n of noleggi) {
    if (n.abbinato_a && ids.has(n.abbinato_a)) {
      if (!piantane.has(n.abbinato_a)) piantane.set(n.abbinato_a, []);
      piantane.get(n.abbinato_a).push(n);
    }
  }
  return noleggi
    .filter((n) => !(n.abbinato_a && ids.has(n.abbinato_a)))
    .map((n) => ({ ...n, piantane: piantane.get(n.id) || [] }));
}

function riga(n, azioni) {
  const oggi = oggiISO();
  // Le date compaiono sulla riga solo quando differiscono da quelle della fiera.
  const dateProprie = n.data_inizio !== n.fiera_inizio || n.data_fine !== n.fiera_fine;
  const inRitardo = n.stato === 'consegnato' && n.data_fine < oggi;
  const apparecchio = { nome: n.prodotto_nome, marca: n.prodotto_marca, pollici: n.prodotto_pollici };
  const posto = standInColonne(n.stand, n.fiera_padiglione, n.padiglione);

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
    dateProprie ? h('span', {}, intervalloDate(n.data_inizio, n.data_fine)) : null),
  h('div', { class: 'nol-riga__padiglione' }, posto.padiglione || h('span', { class: 'nol-riga__vuoto' }, '—')),
  h('div', { class: 'nol-riga__stand', title: n.stand || '' },
    // Su telefono le colonne diventano righe: padiglione e stand vanno insieme.
    posto.padiglione ? h('span', { class: 'nol-riga__pad-telefono' }, `Pad. ${posto.padiglione} · `) : null,
    posto.stand ? h('strong', {}, posto.stand) : h('span', { class: 'nol-riga__vuoto' }, '—')),
  h('div', { class: 'nol-riga__apparecchio', title: n.prodotto_nome },
    h('strong', {}, nomeBreve(apparecchio), n.quantita > 1 ? h('em', {}, ` ×${n.quantita}`) : null),
    h('span', {}, idProdotto(n.prodotto_codice) || n.prodotto_categoria,
      // La piantana abbinata in automatico dice a quale TV appartiene.
      n.abbinato_a ? h('em', { class: 'nol-riga__abbinata' }, ` · per il TV ${idProdotto(n.abbinato_codice) || ''}`) : null)),
  h('div', { class: 'nol-riga__montaggio' },
    eSchermo(n.prodotto_categoria) ? badgeMontaggio(n.montaggio, { breve: true }) : h('span', { class: 'nol-riga__vuoto' }, '—'),
    n.piantane?.length ? h('span', { class: 'nol-riga__piantana', title: n.piantane.map((p) => p.prodotto_nome).join(', ') },
      `${n.piantane.length > 1 ? `${n.piantane.length} piantane: ` : 'Piantana '}${n.piantane.map((p) => idProdotto(p.prodotto_codice)).join(', ')}`) : null),
  h('div', { class: 'nol-riga__note' }, noteInBreve(n)),
  h('div', { class: 'nol-riga__importo' }, euro(n.importo)),
  // Stato e bottone per avanzarlo nella stessa colonna, per fare spazio.
  h('div', { class: 'nol-riga__stato' },
    badge(n.stato),
    inRitardo ? h('span', { class: 'nol-riga__ritardo' }, `rientro atteso dal ${dataLunga(n.data_fine)}`) : null,
    PROSSIMO_STATO[n.stato]
      ? h('button', {
          class: 'btn btn--mini btn--primario nol-riga__avanza',
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
    h('ul', { class: 'nol-righe' },
      h('li', { class: 'nol-intestazione', 'aria-hidden': 'true' },
        h('span', {}, 'Cliente'), h('span', { class: 'nol-riga__padiglione' }, 'Pad.'), h('span', {}, 'Stand'),
        h('span', {}, 'Apparecchio'), h('span', {}, 'Montaggio'), h('span', {}, 'Note'),
        h('span', { class: 'nol-riga__importo' }, 'Importo'), h('span', {}, 'Stato')),
      g.righe.map((n) => riga(n, azioni))));
}

/* ---------- schermate ---------- */

// La planimetria è la prima e si apre entrando in Noleggi.
const SCHERMATE = [
  { id: 'planimetria', testo: 'Planimetria' },
  { id: 'elenco', testo: 'Elenco' },
  { id: 'disponibili', testo: 'Monitor disponibili' },
];

// Schermata e fiera stanno nell'indirizzo (#/noleggi?vista=planimetria&fiera=3):
// si ritrovano ricaricando la pagina e si possono mandare a un collega.
const parametri = () => new URLSearchParams(location.hash.split('?')[1] || '');
const indirizzo = (vista, fiera) => `#/noleggi?${new URLSearchParams(
  Object.entries({ vista, fiera }).filter(([, v]) => v),
)}`;

// Prima i monitor e i TV, poi il resto (supporti, accessori…).
const ORDINE_CATEGORIE = ['TV', 'Monitor', 'Videowall', 'Totem', 'Supporto', 'Accessorio'];
const SCHERMI = ['TV', 'Monitor', 'Videowall', 'Totem'];
const posizioneCategoria = (c) => (ORDINE_CATEGORIE.indexOf(c) + 1 || 99);
const perCategoria = (elenco) => {
  const gruppi = new Map();
  for (const a of [...elenco].sort((x, y) => posizioneCategoria(x.categoria) - posizioneCategoria(y.categoria)
    || (x.pollici || 0) - (y.pollici || 0))) {
    if (!gruppi.has(a.categoria)) gruppi.set(a.categoria, []);
    gruppi.get(a.categoria).push(a);
  }
  return [...gruppi.entries()];
};
const testoApparecchio = (a) => [a.nome, a.marca, a.codice, idProdotto(a.codice), a.pollici && `${a.pollici}`, a.categoria]
  .filter(Boolean).join(' ').toLowerCase();

/** La fiera su cui lavorare: quella nell'indirizzo, o la prossima da svolgere. */
function fieraScelta(fiereOrdinate) {
  const id = Number(parametri().get('fiera'));
  return fiereOrdinate.find((f) => f.id === id)
    || fiereOrdinate.find((f) => f.data_fine >= oggiISO())
    || fiereOrdinate[0] || null;
}

function selettoreFiera(fiereOrdinate, scelta, vista) {
  // Le fiere già svolte non servono qui, a parte quella aperta.
  const proposte = fiereOrdinate.filter((f) => f.data_fine >= oggiISO() || f.id === scelta.id);
  const sel = select('fiera', proposte.map((f) => ({
    valore: f.id, testo: `${f.nome} — ${intervalloDate(f.data_inizio, f.data_fine)}`,
  })), scelta.id);
  sel.addEventListener('change', () => { location.hash = indirizzo(vista, sel.value); });
  return sel;
}

/* ---------- monitor disponibili ---------- */

async function schermataDisponibili(corpo, fiereOrdinate) {
  const fiera = fieraScelta(fiereOrdinate);
  if (!fiera) {
    monta(corpo, vuoto('Nessuna fiera', 'Crea prima una fiera: i monitor disponibili si contano nelle sue date.'));
    return;
  }
  const finestra = await api.finestraFiera(fiera.id);
  const elenco = await api.apparecchi({ from: finestra.data_inizio, to: finestra.data_fine });
  const filtri = { q: '', soloSchermi: true };
  const contenitore = h('div', { class: 'disp-elenco' });

  const cerca = input('q', { placeholder: 'Cerca modello, pollici o ID…', type: 'search' });
  cerca.addEventListener('input', () => { filtri.q = cerca.value.trim().toLowerCase(); disegna(); });
  const soloSchermi = h('input', { type: 'checkbox', checked: true });
  soloSchermi.addEventListener('change', () => { filtri.soloSchermi = soloSchermi.checked; disegna(); });

  function riga(a) {
    const occupati = a.quantita - a.liberi;
    return h('li', { class: `disp-riga ${a.liberi ? '' : 'disp-riga--esaurito'}` },
      h('div', { class: 'disp-riga__nome' },
        h('strong', {}, nomeBreve(a)),
        h('span', {}, [idProdotto(a.codice), a.stato === 'manutenzione' ? 'in manutenzione' : null].filter(Boolean).join(' · '))),
      h('div', { class: 'disp-riga__conta' },
        h('strong', {}, numero(a.liberi)), ` liberi su ${numero(a.quantita)}`,
        h('span', { class: 'disp-barra', 'aria-hidden': 'true' },
          h('span', { style: { width: `${a.quantita ? (a.liberi / a.quantita) * 100 : 0}%` } }))),
      h('div', { class: 'disp-riga__occupato' }, occupati && a.occupato_da.length
        ? a.occupato_da.map((o) => `${o.cliente || 'senza cliente'} (${o.fiera_nome})`).join(' · ')
        : h('span', { class: 'nol-riga__vuoto' }, a.stato === 'manutenzione' ? 'In manutenzione' : '—')),
      a.liberi ? h('a', {
        class: 'btn btn--mini',
        href: indirizzo('planimetria', fiera.id),
        title: 'Apri la planimetria e trascinalo dove va montato',
      }, 'Metti sulla pianta →') : h('span'));
  }

  function disegna() {
    const visibili = elenco.filter((a) => (!filtri.soloSchermi || SCHERMI.includes(a.categoria))
      && (!filtri.q || testoApparecchio(a).includes(filtri.q)));
    const liberi = visibili.filter((a) => a.liberi > 0);
    const esauriti = visibili.filter((a) => !a.liberi);
    const pezzi = liberi.reduce((t, a) => t + a.liberi, 0);
    monta(contenitore,
      h('p', { class: 'riepilogo-filtro' },
        h('strong', {}, numero(pezzi)), ` ${pezzi === 1 ? 'pezzo libero' : 'pezzi liberi'} `
        + `dal ${dataLunga(finestra.data_inizio)} al ${dataLunga(finestra.data_fine)}, allestimento e smontaggio compresi.`),
      !visibili.length ? vuoto('Nessun apparecchio trovato', 'Prova a cambiare la ricerca.') : null,
      perCategoria(liberi).map(([categoria, righe]) => h('section', { class: 'disp-gruppo' },
        h('h3', {}, categoria, h('span', {}, ` · ${numero(righe.reduce((t, a) => t + a.liberi, 0))} liberi`)),
        h('ul', {}, righe.map(riga)))),
      esauriti.length ? h('details', { class: 'disp-gruppo disp-gruppo--esauriti' },
        h('summary', {}, `Già tutti noleggiati in queste date (${numero(esauriti.length)})`),
        h('ul', {}, esauriti.map(riga))) : null);
  }

  monta(corpo,
    h('div', { class: 'filtri' },
      selettoreFiera(fiereOrdinate, fiera, 'disponibili'),
      cerca,
      h('label', { class: 'disp-spunta' }, soloSchermi, ' Solo TV e monitor')),
    contenitore);
  disegna();
}

/* ---------- planimetria ---------- */

/** L'elenco a sinistra della pianta: gli apparecchi liberi, da trascinare. */
function tavolozza() {
  const elenco = h('div', { class: 'tav-elenco' });
  const cerca = input('q', { placeholder: 'Cerca…', type: 'search' });
  let ultimo = [];
  let soloSchermi = true;
  const schermi = h('input', { type: 'checkbox', checked: true });
  schermi.addEventListener('change', () => { soloSchermi = schermi.checked; disegna(); });
  cerca.addEventListener('input', () => disegna());

  function disegna() {
    const q = cerca.value.trim().toLowerCase();
    const liberi = ultimo.filter((a) => a.liberi > 0 && (!soloSchermi || SCHERMI.includes(a.categoria))
      && (!q || testoApparecchio(a).includes(q)));
    monta(elenco,
      !liberi.length ? h('p', { class: 'pianta__attesa' }, ultimo.length
        ? 'Nessun apparecchio libero da mostrare.' : 'Carico gli apparecchi liberi…') : null,
      perCategoria(liberi).map(([categoria, righe]) => [
        h('h3', {}, categoria),
        h('ul', {}, righe.map((a) => h('li', {
          class: 'tav-voce',
          title: `Trascina sulla pianta: ${a.nome}`,
          dataset: { prodotto: a.id, etichetta: [nomeBreve(a), idProdotto(a.codice)].filter(Boolean).join(' ') },
        },
        h('span', { class: 'tav-maniglia', 'aria-hidden': 'true' }, '⠿'),
        h('span', { class: 'tav-voce__nome' },
          h('strong', {}, nomeBreve(a)),
          h('span', {}, idProdotto(a.codice) || a.categoria)),
        h('span', { class: 'tav-voce__conta', title: 'Pezzi liberi nelle date della fiera' }, `${a.liberi}`)))),
      ]));
  }

  return {
    lato: h('div', { class: 'tav' },
      h('div', { class: 'tav-testa' },
        h('strong', {}, 'Monitor disponibili'),
        h('p', {}, 'Trascinali sulla pianta, dove vanno montati.'),
        cerca,
        h('label', { class: 'disp-spunta' }, schermi, ' Solo TV e monitor')),
      elenco),
    aggiorna: (apparecchi) => { ultimo = apparecchi; disegna(); },
  };
}

async function schermataPlanimetria(corpo, fiereOrdinate) {
  const fiera = fieraScelta(fiereOrdinate);
  if (!fiera) {
    monta(corpo, vuoto('Nessuna fiera', 'Crea prima una fiera e allega la sua planimetria.'));
    return;
  }
  const [dettaglio, finestra] = await Promise.all([api.fiera(fiera.id), api.finestraFiera(fiera.id)]);
  const piante = dettaglio.allegati.filter((a) => a.tipo === 'application/pdf' || a.tipo.startsWith('image/'));
  const idPianta = Number(parametri().get('pianta'));
  const allegato = piante.find((a) => a.id === idPianta) || piante[0];

  // Allegare una pianta da qui, senza passare dalla scheda della fiera.
  const scegliFile = h('input', { type: 'file', accept: 'application/pdf,image/*', hidden: true });
  scegliFile.addEventListener('change', async () => {
    const file = scegliFile.files[0];
    if (!file) return;
    avviso('Carico la planimetria…');
    try {
      const nuovo = await caricaAllegato(fiera.id, file);
      location.hash = `${indirizzo('planimetria', fiera.id)}&pianta=${nuovo.id}`;
    } catch (err) {
      avviso(err.message, 'errore');
    }
  });
  const carica = h('button', { class: 'btn', onclick: () => scegliFile.click() }, '+ Allega planimetria');

  const zona = h('div', { class: 'nol-pianta' });
  const barraPadiglioni = h('nav', { class: 'padiglioni', 'aria-label': 'Planimetrie della fiera' });
  monta(corpo,
    h('div', { class: 'filtri' }, selettoreFiera(fiereOrdinate, fiera, 'planimetria'), carica, scegliFile),
    piante.length > 1 ? barraPadiglioni : null,
    zona);

  if (!allegato) {
    monta(zona, vuoto('Nessuna planimetria per questa fiera',
      'Allega la pianta della fiera (PDF o foto): poi trascini i monitor dove vanno montati.',
      h('button', { class: 'btn btn--primario', onclick: () => scegliFile.click() }, '+ Allega planimetria')));
    return;
  }

  // "PAD 6" se il padiglione si legge dal nome del file o dal titolo della pianta.
  const padLetti = new Map();
  const etichettaPianta = (a) => {
    const pad = padLetti.get(a.id) || padiglione(String(a.nome || '').replace(/[_-]/g, ' '));
    return pad ? `PAD ${pad}` : nomePianta(a.nome);
  };
  let apparecchi = [];
  let aperta = allegato;
  let lato = null;
  let pianta = null;

  const aggiornaLiberi = async () => {
    apparecchi = await api.apparecchi({ from: finestra.data_inizio, to: finestra.data_fine });
    lato?.aggiorna(apparecchi);
  };

  // Un bottone per planimetria (di solito una per padiglione), con quanti
  // apparecchi ci sono già sopra: si passa dall'una all'altra con un clic.
  async function disegnaPadiglioni() {
    if (piante.length < 2) return;
    const noleggi = await api.noleggi({ fiera_id: fiera.id });
    const conta = (id) => noleggi.filter((n) => n.segnaposto_allegato === id && n.stato !== 'annullato').length;
    // In ordine di padiglione (PAD 4, PAD 5, PAD 6…), poi le altre per nome.
    const numeroPad = (a) => Number((etichettaPianta(a).match(/^PAD (\d+)$/) || [])[1]) || Infinity;
    const ordinate = [...piante].sort((x, y) => numeroPad(x) - numeroPad(y) || x.nome.localeCompare(y.nome, 'it'));
    monta(barraPadiglioni, ordinate.map((a) => {
      const quanti = conta(a.id);
      return h('button', {
        type: 'button',
        class: `padiglione ${a.id === aperta.id ? 'padiglione--attivo' : ''}`,
        'aria-current': a.id === aperta.id ? 'true' : null,
        title: a.nome,
        onclick: () => { if (a.id !== aperta.id) apri(a); },
      }, etichettaPianta(a), h('span', { class: 'padiglione__conta' }, numero(quanti)));
    }));
  }

  const dopoUnaModifica = async () => {
    await aggiornaLiberi();
    await pianta?.ricarica();
    disegnaPadiglioni();
  };

  async function apri(a) {
    aperta = a;
    // Nell'indirizzo, così ricaricando si torna sullo stesso padiglione.
    history.replaceState(null, '', `${indirizzo('planimetria', fiera.id)}&pianta=${a.id}`);
    disegnaPadiglioni();
    lato = tavolozza();
    lato.aggiorna(apparecchi);
    pianta = null;
    pianta = await apriPianta({
      fiera,
      allegato: a,
      contenitore: zona,
      disposizione: {
        lato: lato.lato,
        crea: async (dati) => {
          const salvato = await api.noleggioSullaPianta({ fiera_id: fiera.id, allegato_id: a.id, ...dati });
          avvisoPiantane(salvato);
          return salvato;
        },
        modifica: (n) => apriForm({ ...n, fiera_nome: fiera.nome }, fiereOrdinate, dopoUnaModifica),
        dopo: async () => { await aggiornaLiberi(); disegnaPadiglioni(); },
        dettagli: (id) => dettagliApparecchio(apparecchi.find((x) => x.id === id), finestra),
      },
    });
    if (pianta?.padiglione && !padLetti.has(a.id)) {
      padLetti.set(a.id, pianta.padiglione);
      disegnaPadiglioni();
    }
  }

  aggiornaLiberi();
  await apri(allegato);
}

/** Popup di un apparecchio della lista: cos'è, quanti ne restano e chi ha gli altri. */
function dettagliApparecchio(a, finestra) {
  if (!a) return;
  const riga = (etichetta, valore) => h('div', { class: 'scheda-app__riga' }, h('dt', {}, etichetta), h('dd', {}, valore || '—'));
  modale({
    titolo: nomeBreve(a),
    sottotitolo: [idProdotto(a.codice), a.nome].filter(Boolean).join(' · '),
    corpo: [
      h('dl', { class: 'scheda-app' },
        riga('Categoria', a.categoria),
        a.pollici ? riga('Pollici', `${a.pollici}"`) : null,
        riga('Liberi', `${numero(a.liberi)} su ${numero(a.quantita)} dal ${dataLunga(finestra.data_inizio)} al ${dataLunga(finestra.data_fine)}`),
        a.occupato_da.length ? riga('Già noleggiati a', h('ul', { class: 'scheda-app__lista' },
          a.occupato_da.map((o) => h('li', {}, `${o.cliente || 'cliente da indicare'}${o.stand ? ` · stand ${o.stand}` : ''} (${o.fiera_nome})`)))) : null),
      h('p', { class: 'campo__aiuto' }, 'Per noleggiarlo, trascinalo sulla pianta dove va montato.'),
    ],
    testoConferma: 'Chiudi',
    soloChiudi: true,
    onConferma: async () => {},
  });
}

/** "Padiglione 5 - pianta.pdf" → "Padiglione 5 - pianta": il nome del file, senza estensione. */
const nomePianta = (nome) => String(nome || 'Planimetria').replace(/\.(pdf|png|jpe?g|webp)$/i, '');

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

  const vista = SCHERMATE.find((v) => v.id === parametri().get('vista'))?.id || SCHERMATE[0].id;
  const fieraAperta = vista === 'elenco' ? null : fieraScelta(fiereOrdinate);
  const barraViste = h('nav', { class: 'viste', 'aria-label': 'Schermate dei noleggi' },
    SCHERMATE.map((v) => h('a', {
      class: `vista-bottone ${v.id === vista ? 'vista-bottone--attiva' : ''}`,
      href: indirizzo(v.id, v.id === 'elenco' ? null : fieraAperta?.id || parametri().get('fiera')),
      'aria-current': v.id === vista ? 'page' : null,
    }, v.testo)));

  const filtri = { q: '', fiera_id: '', prodotto_id: '' };
  azioni.append(
    // Parte dalla fiera filtrata nella lista, se ce n'è una.
    h('button', {
      class: 'btn',
      onclick: () => apriDocumenti({ fieraId: filtri.fiera_id || fieraAperta?.id || '' }).catch((e) => avviso(e.message, 'errore')),
    }, 'Scarica PDF'),
    h('button', {
      class: 'btn btn--primario',
      onclick: () => apriForm(null, fiereOrdinate, ricarica),
    }, '+ Nuovo noleggio'));

  if (vista !== 'elenco') {
    const area = h('div', { class: 'vista' });
    monta(corpo, barraViste, area);
    if (vista === 'disponibili') await schermataDisponibili(area, fiereOrdinate);
    else await schermataPlanimetria(area, fiereOrdinate);
    return;
  }

  let scheda = 'attivi';
  let elenco = [];
  const barraSchede = h('div', { class: 'schede nol-schede', role: 'tablist' });
  const contenitore = h('div', { class: 'nol-gruppi' });

  const azioniRiga = {
    apri: (n) => apriForm(n, fiereOrdinate, ricarica),
    avanza: async (n) => {
      const nuovo = PROSSIMO_STATO[n.stato];
      const salvato = await api.statoNoleggio(n.id, nuovo);
      avviso(`${n.cliente || 'Noleggio'}: segnato come ${etichetta(nuovo).toLowerCase()}.`);
      avvisoPiantane(salvato);
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
    elenco = conPiantaneNelTv(await api.noleggi(filtri));
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
    barraViste,
    h('div', { class: 'filtri' }, cerca, selFiera, selProdotto),
    barraSchede,
    contenitore);
  await carica();
}
