import { api } from '../api.js';
import { stato as statoApp } from '../app.js';
import { selettoreApparecchi } from '../selettore-apparecchi.js';
import {
  h, monta, badge, modale, conferma, avviso, campo, input, select, areaTesto,
  griglia, numero, euro, vuoto, intervalloDate, etichetta, oggiISO, addGiorni, notePulite,
} from '../ui.js';

function formFiera(f = {}, manifestazioniNote = []) {
  const { stati_fiera: statiFiera } = statoApp.costanti;
  const elenco = h('datalist', { id: 'manifestazioni-note' },
    manifestazioniNote.map((m) => h('option', { value: m })));
  const oggi = oggiISO();
  return [
    griglia(
      elenco,
      campo('Manifestazione', input('manifestazione', {
        value: f.manifestazione || '', required: true, placeholder: 'Pharmexpo',
        list: 'manifestazioni-note', autocomplete: 'off',
      }), { aiuto: 'Il nome che si ripete ogni anno, senza l\'anno. Scegline una già presente per raggruppare le edizioni.' }),
      campo('Anno', input('anno', { value: f.anno || '', type: 'number', min: '2000', max: '2100', placeholder: '2026' })),
      campo('Nome dell\'edizione', input('nome', { value: f.nome || '', placeholder: 'lasciato vuoto: "Pharmexpo 2026"' }), { largo: true }),
      campo('Stato', select('stato', statiFiera, f.stato || 'pianificata')),
      campo('Quartiere fieristico', input('luogo', { value: f.luogo || '', placeholder: 'Fiera Milano Rho' })),
      campo('Città', input('citta', { value: f.citta || '', placeholder: 'Milano' })),
      campo('Padiglione', input('padiglione', { value: f.padiglione || '', placeholder: '12' })),
      campo('Stand', input('stand', { value: f.stand || '', placeholder: 'C24' })),
      campo('Primo giorno', input('data_inizio', { value: f.data_inizio || addGiorni(oggi, 14), type: 'date', required: true })),
      campo('Ultimo giorno', input('data_fine', { value: f.data_fine || addGiorni(oggi, 17), type: 'date', required: true })),
      campo('Giorni di allestimento', input('giorni_allestimento', { value: f.giorni_allestimento ?? 1, type: 'number', min: '0' }),
        { aiuto: 'Giorni prima dell\'apertura in cui il materiale è già fuori.' }),
      campo('Giorni di smontaggio', input('giorni_smontaggio', { value: f.giorni_smontaggio ?? 1, type: 'number', min: '0' }),
        { aiuto: 'Giorni dopo la chiusura prima del rientro in magazzino.' }),
      campo('Note', areaTesto('note', { value: f.note || '' }), { largo: true }),
    ),
  ];
}

function apriForm(f, ricarica, manifestazioniNote = []) {
  const modifica = Boolean(f?.id);
  modale({
    titolo: modifica ? 'Modifica edizione' : 'Nuova edizione',
    sottotitolo: modifica ? f.nome : 'Registra un\'edizione in cui noleggerai il materiale.',
    corpo: formFiera(f || {}, manifestazioniNote),
    testoConferma: modifica ? 'Salva modifiche' : 'Crea edizione',
    larga: true,
    onConferma: async (dati) => {
      if (modifica) {
        const esito = await api.modificaFiera(f.id, dati);
        const parti = ['Edizione aggiornata.'];
        if (esito.noleggi_spostati) parti.push(`${esito.noleggi_spostati} noleggi spostati sulle nuove date.`);
        if (esito.noleggi_con_date_proprie) {
          parti.push(`${esito.noleggi_con_date_proprie} con date proprie sono rimasti invariati.`);
        }
        avviso(parti.join(' '));
      } else {
        await api.creaFiera(dati);
        avviso('Edizione creata.');
      }
      await ricarica();
    },
  });
}

/* --- assegnazione prodotti a una fiera --- */

async function apriAssegna(fiera, _prodotti, ricarica) {
  const finestra = await api.finestraFiera(fiera.id);
  const selettore = selettoreApparecchi();
  const daInizio = input('data_inizio', { value: finestra.data_inizio, type: 'date', required: true });
  const aFine = input('data_fine', { value: finestra.data_fine, type: 'date', required: true });
  const aggiorna = () => selettore.aggiorna(daInizio.value, aFine.value);
  daInizio.addEventListener('change', aggiorna);
  aFine.addEventListener('change', aggiorna);

  modale({
    titolo: 'Assegna materiale',
    sottotitolo: `${fiera.nome} · ${intervalloDate(fiera.data_inizio, fiera.data_fine)}`,
    larga: true,
    testoConferma: 'Aggiungi al noleggio',
    corpo: [
      griglia(
        campo('Cliente', input('cliente', { placeholder: 'Nome dell\'azienda espositrice' })),
        campo('Stand', input('stand', { placeholder: 'PAD 5 - 5042' })),
        campo('Uscita dal magazzino', daInizio, { aiuto: 'Precompilata con i giorni di allestimento.' }),
        campo('Rientro in magazzino', aFine, { aiuto: 'Precompilata con i giorni di smontaggio.' }),
        h('label', { class: 'campo campo--largo' },
          h('span', { class: 'campo__etichetta' }, 'Apparecchio'),
          selettore.select,
          selettore.nota),
        campo('Importo (€)', input('importo', { type: 'number', min: '0', step: '0.01', placeholder: 'calcolato dal listino' }),
          { aiuto: 'Totale del lavoro, non il prezzo al giorno.' }),
        campo('Pezzi', input('quantita', { value: 1, type: 'number', min: '1', required: true })),
        campo('Stato', select('stato', statoApp.costanti.stati_noleggio, 'prenotato')),
        campo('Note', areaTesto('note', {}), { largo: true }),
      ),
    ],
    onConferma: async (dati) => {
      await api.creaNoleggio({ ...dati, fiera_id: fiera.id });
      avviso('Materiale assegnato alla fiera.');
      await ricarica();
    },
  });
  aggiorna();
}

async function apriDettaglio(id, prodotti, ricarica) {
  const fiera = await api.fiera(id);
  const attivi = fiera.noleggi.filter((n) => n.stato !== 'annullato');

  const tabella = attivi.length
    ? h('table', { class: 'tabella' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Cliente'), h('th', {}, 'Prodotto'), h('th', {}, 'Pezzi'),
          h('th', {}, 'Periodo'), h('th', {}, 'Importo'), h('th', {}, 'Stato'), h('th', {}, ''))),
        h('tbody', {}, attivi.map((n) => h('tr', {},
          h('td', {}, h('strong', {}, n.cliente || '—'),
            n.stand ? h('div', { class: 'sottotesto' }, n.stand) : null),
          h('td', {}, n.prodotto_nome,
            h('div', { class: 'sottotesto' }, `${n.prodotto_categoria}${n.prodotto_pollici ? ` ${n.prodotto_pollici}"` : ''}`)),
          h('td', {}, numero(n.quantita)),
          h('td', {}, intervalloDate(n.data_inizio, n.data_fine)),
          h('td', {}, euro(n.importo)),
          h('td', {}, badge(n.stato)),
          h('td', { class: 'tabella__azioni' },
            h('button', {
              class: 'btn btn--mini btn--pericolo',
              onclick: async (e) => {
                await api.eliminaNoleggio(n.id);
                e.target.closest('tr').remove();
                avviso('Riga rimossa dalla fiera.');
                await ricarica();
              },
            }, 'Rimuovi'))))))
    : vuoto('Nessun materiale assegnato', 'Aggiungi i primi prodotti da portare in fiera.');

  modale({
    titolo: fiera.nome,
    sottotitolo: [
      [fiera.citta, fiera.luogo].filter(Boolean).join(' · '),
      fiera.padiglione && `pad. ${fiera.padiglione}`,
      fiera.stand && `stand ${fiera.stand}`,
    ].filter(Boolean).join(' — ') || 'Sede da definire',
    larga: true,
    testoConferma: 'Chiudi',
    corpo: [
      h('div', { class: 'dettaglio-numeri' },
        h('div', {}, h('span', {}, 'Apertura'), h('strong', {}, intervalloDate(fiera.data_inizio, fiera.data_fine))),
        h('div', {}, h('span', {}, 'Materiale fuori'), h('strong', {}, intervalloDate(fiera.from, fiera.to))),
        h('div', {}, h('span', {}, 'Pezzi'), h('strong', {}, numero(fiera.pezzi_totali))),
        h('div', {}, h('span', {}, 'Valore'), h('strong', {}, euro(fiera.valore)))),
      notePulite(fiera.note) ? h('p', { class: 'dettaglio-note' }, notePulite(fiera.note)) : null,
      fiera.altre_edizioni.length
        ? h('div', { class: 'edizioni-storico' },
            h('h3', {}, `Le altre edizioni di ${fiera.manifestazione}`),
            h('table', { class: 'tabella' },
              h('thead', {}, h('tr', {},
                h('th', {}, 'Edizione'), h('th', {}, 'Periodo'),
                h('th', {}, 'Pezzi'), h('th', {}, 'Clienti'), h('th', {}, 'Fatturato'))),
              h('tbody', {}, fiera.altre_edizioni.map((e) => h('tr', {},
                h('td', {}, e.nome),
                h('td', {}, intervalloDate(e.data_inizio, e.data_fine)),
                h('td', {}, numero(e.pezzi)),
                h('td', {}, numero(e.clienti)),
                h('td', {}, euro(e.valore)))))))
        : null,
      tabella,
    ],
    onConferma: async () => {},
  });
}

function schedaEdizione(f, prodotti, ricarica) {
  const giorniMancanti = Math.round(
    (new Date(`${f.data_inizio}T00:00:00Z`) - new Date(`${oggiISO()}T00:00:00Z`)) / 86400000);
  return h('article', { class: `fiera fiera--${f.stato}` },
    h('header', { class: 'fiera__testa' },
      h('div', {},
        h('h3', {}, f.anno || f.nome),
        h('p', { class: 'fiera__luogo' },
          [f.citta, f.luogo].filter(Boolean).join(' · ') || 'Sede da definire')),
      badge(f.stato)),

    h('p', { class: 'fiera__date' },
      h('strong', {}, intervalloDate(f.data_inizio, f.data_fine)),
      h('span', {}, ` · ${f.durata_giorni} ${f.durata_giorni === 1 ? 'giorno' : 'giorni'}`),
      f.stato === 'pianificata' && giorniMancanti >= 0
        ? h('span', { class: 'fiera__countdown' }, giorniMancanti === 0 ? 'inizia oggi' : `tra ${giorniMancanti} gg`)
        : null),

    h('div', { class: 'fiera__numeri' },
      h('div', {}, h('span', { class: 'fiera__cifra' }, numero(f.pezzi_totali)), h('span', {}, 'pezzi')),
      h('div', {}, h('span', { class: 'fiera__cifra' }, numero(f.clienti)), h('span', {}, 'clienti')),
      h('div', {}, h('span', { class: 'fiera__cifra' }, euro(f.valore)), h('span', {}, 'fatturato'))),

    h('footer', { class: 'fiera__azioni' },
      h('button', { class: 'btn btn--mini btn--primario', onclick: () => apriAssegna(f, prodotti, ricarica) }, '+ Materiale'),
      h('button', { class: 'btn btn--mini', onclick: () => apriDettaglio(f.id, prodotti, ricarica) }, 'Dettaglio'),
      h('button', { class: 'btn btn--mini', onclick: () => apriForm(f, ricarica, f.manifestazioniNote || []) }, 'Modifica'),
      h('button', {
        class: 'btn btn--mini btn--pericolo',
        onclick: () => conferma({
          titolo: 'Eliminare l\'edizione?',
          messaggio: `"${f.nome}" e i suoi ${f.righe_noleggio} noleggi verranno eliminati.`,
          onConferma: async () => {
            await api.eliminaFiera(f.id);
            avviso('Edizione eliminata.');
            await ricarica();
          },
        }),
      }, 'Elimina')));
}

/** Una manifestazione con sotto tutte le sue edizioni. */
function gruppoManifestazione(g, prodotti, ricarica) {
  return h('section', { class: 'manifestazione' },
    h('header', { class: 'manifestazione__testa' },
      h('div', {},
        h('h2', {}, g.manifestazione),
        h('p', {},
          `${g.edizioni.length} ${g.edizioni.length === 1 ? 'edizione' : 'edizioni'}`,
          ` · ${numero(g.pezzi_totali)} pezzi noleggiati in totale`,
          ` · ${euro(g.valore_totale)}`)),
      g.prossima
        ? h('span', { class: 'manifestazione__prossima' },
            `Prossima edizione: ${intervalloDate(g.prossima.data_inizio, g.prossima.data_fine)}`)
        : null),
    h('div', { class: 'griglia-fiere' }, g.edizioni.map((e) => schedaEdizione(e, prodotti, ricarica))));
}

export default async function vistaFiere({ corpo, azioni, ricarica }) {
  const { stati_fiera: statiFiera } = statoApp.costanti;
  azioni.appendChild(h('button', {
    class: 'btn btn--primario', onclick: () => apriForm(null, ricarica, note),
  }, '+ Nuova edizione'));

  const prodotti = await api.prodotti();
  const filtri = { q: '', stato: '' };
  const contenitore = h('div', { class: 'manifestazioni' });
  let note = [];

  const disegna = async () => {
    const gruppi = await api.manifestazioni();
    note = gruppi.map((g) => g.manifestazione);
    const testo = filtri.q.toLowerCase();

    // I filtri agiscono sulle edizioni; una manifestazione resta se ne salva almeno una.
    const visibili = gruppi
      .map((g) => ({
        ...g,
        edizioni: g.edizioni.filter((e) => (!filtri.stato || e.stato === filtri.stato)
          && (!testo || `${g.manifestazione} ${e.nome} ${e.citta} ${e.luogo}`.toLowerCase().includes(testo))),
      }))
      .filter((g) => g.edizioni.length);

    const edizioni = visibili.reduce((t, g) => t + g.edizioni.length, 0);
    monta(contenitore,
      h('p', { class: 'riepilogo-filtro' },
        `${numero(visibili.length)} manifestazioni · ${numero(edizioni)} edizioni · `
        + `${euro(visibili.reduce((t, g) => t + g.edizioni.reduce((s, e) => s + e.valore, 0), 0))} di fatturato`),
      visibili.length
        ? visibili.map((g) => gruppoManifestazione(g, prodotti, ricarica))
        : vuoto('Nessuna fiera trovata',
            'Cambia i filtri oppure registra la prima edizione.',
            h('button', { class: 'btn btn--primario', onclick: () => apriForm(null, ricarica, note) }, '+ Nuova edizione')));
  };

  const cerca = input('q', { placeholder: 'Cerca per manifestazione o città…', type: 'search' });
  cerca.addEventListener('input', () => { filtri.q = cerca.value.trim(); disegna(); });

  const selStato = select('stato',
    [{ valore: '', testo: 'Tutti gli stati' }, ...statiFiera.map((s) => ({ valore: s, testo: etichetta(s) }))], '');
  selStato.addEventListener('change', () => { filtri.stato = selStato.value; disegna(); });

  monta(corpo, h('div', { class: 'filtri' }, cerca, selStato), contenitore);
  await disegna();
}
