import { api } from '../api.js';
import { stato as statoApp } from '../app.js';
import {
  h, monta, badge, modale, conferma, avviso, campo, input, select, areaTesto,
  griglia, numero, euro, vuoto, intervalloDate, dataLunga, etichetta, oggiISO, addGiorni,
} from '../ui.js';

function formFiera(f = {}) {
  const { stati_fiera: statiFiera } = statoApp.costanti;
  const oggi = oggiISO();
  return [
    griglia(
      campo('Nome della fiera', input('nome', { value: f.nome || '', required: true, placeholder: 'Salone del Mobile' }), { largo: true }),
      campo('Cliente', input('cliente', { value: f.cliente || '', placeholder: 'Arredo Group Srl' })),
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

function apriForm(f, ricarica) {
  const modifica = Boolean(f?.id);
  modale({
    titolo: modifica ? 'Modifica fiera' : 'Nuova fiera',
    sottotitolo: modifica ? f.nome : 'Registra un evento in cui noleggerai il materiale.',
    corpo: formFiera(f || {}),
    testoConferma: modifica ? 'Salva modifiche' : 'Crea fiera',
    larga: true,
    onConferma: async (dati) => {
      if (modifica) await api.modificaFiera(f.id, dati);
      else await api.creaFiera(dati);
      avviso(modifica ? 'Fiera aggiornata.' : 'Fiera creata.');
      await ricarica();
    },
  });
}

/* --- assegnazione prodotti a una fiera --- */

async function apriAssegna(fiera, prodotti, ricarica) {
  const finestra = await api.finestraFiera(fiera.id);
  const selProdotto = select('prodotto_id',
    prodotti.filter((p) => p.stato === 'attivo').map((p) => ({
      valore: p.id,
      testo: `${p.nome} — ${p.quantita} pz in magazzino`,
    })), '');

  modale({
    titolo: 'Assegna materiale alla fiera',
    sottotitolo: `${fiera.nome} · ${intervalloDate(fiera.data_inizio, fiera.data_fine)}`,
    larga: true,
    testoConferma: 'Aggiungi al noleggio',
    corpo: [
      griglia(
        campo('Prodotto', selProdotto, { largo: true }),
        campo('Pezzi', input('quantita', { value: 1, type: 'number', min: '1', required: true })),
        campo('Stato', select('stato', statoApp.costanti.stati_noleggio, 'prenotato')),
        campo('Uscita dal magazzino', input('data_inizio', { value: finestra.data_inizio, type: 'date', required: true }),
          { aiuto: 'Precompilata con i giorni di allestimento.' }),
        campo('Rientro in magazzino', input('data_fine', { value: finestra.data_fine, type: 'date', required: true }),
          { aiuto: 'Precompilata con i giorni di smontaggio.' }),
        campo('Prezzo al giorno (€)', input('prezzo_giorno', { type: 'number', min: '0', step: '0.01', placeholder: 'listino prodotto' })),
        campo('Note', areaTesto('note', {}), { largo: true }),
      ),
    ],
    onConferma: async (dati) => {
      await api.creaNoleggio({ ...dati, fiera_id: fiera.id });
      avviso('Materiale assegnato alla fiera.');
      await ricarica();
    },
  });
}

async function apriDettaglio(id, prodotti, ricarica) {
  const fiera = await api.fiera(id);
  const attivi = fiera.noleggi.filter((n) => n.stato !== 'annullato');

  const tabella = attivi.length
    ? h('table', { class: 'tabella' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Prodotto'), h('th', {}, 'Pezzi'), h('th', {}, 'Periodo'),
          h('th', {}, 'Stato'), h('th', {}, ''))),
        h('tbody', {}, attivi.map((n) => h('tr', {},
          h('td', {}, n.prodotto_nome,
            h('span', { class: 'sottotesto' }, ` ${n.prodotto_categoria}${n.prodotto_pollici ? ` ${n.prodotto_pollici}"` : ''}`)),
          h('td', {}, numero(n.quantita)),
          h('td', {}, intervalloDate(n.data_inizio, n.data_fine)),
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
        h('div', {}, h('span', {}, 'Valore stimato'), h('strong', {}, euro(fiera.valore_stimato)))),
      fiera.note ? h('p', { class: 'dettaglio-note' }, fiera.note) : null,
      tabella,
    ],
    onConferma: async () => {},
  });
}

function schedaFiera(f, prodotti, ricarica) {
  const giorniMancanti = Math.round(
    (new Date(`${f.data_inizio}T00:00:00Z`) - new Date(`${oggiISO()}T00:00:00Z`)) / 86400000);
  return h('article', { class: `fiera fiera--${f.stato}` },
    h('header', { class: 'fiera__testa' },
      h('div', {},
        h('h3', {}, f.nome),
        h('p', { class: 'fiera__luogo' },
          [f.citta, f.luogo].filter(Boolean).join(' · ') || 'Sede da definire',
          f.padiglione ? ` · pad. ${f.padiglione}` : '',
          f.stand ? ` · stand ${f.stand}` : '')),
      badge(f.stato)),

    h('p', { class: 'fiera__date' },
      h('strong', {}, intervalloDate(f.data_inizio, f.data_fine)),
      h('span', {}, ` · ${f.durata_giorni} ${f.durata_giorni === 1 ? 'giorno' : 'giorni'}`),
      f.stato === 'pianificata' && giorniMancanti >= 0
        ? h('span', { class: 'fiera__countdown' }, giorniMancanti === 0 ? 'inizia oggi' : `tra ${giorniMancanti} gg`)
        : null),
    h('p', { class: 'fiera__logistica' },
      `Materiale fuori dal magazzino: ${intervalloDate(f.from, f.to)}`),

    h('div', { class: 'fiera__numeri' },
      h('div', {}, h('span', { class: 'fiera__cifra' }, numero(f.pezzi_totali)), h('span', {}, 'pezzi')),
      h('div', {}, h('span', { class: 'fiera__cifra' }, numero(f.righe_noleggio)), h('span', {}, 'righe')),
      h('div', {}, h('span', { class: 'fiera__cifra' }, euro(f.valore_stimato)), h('span', {}, 'stimati')),
      f.cliente ? h('div', { class: 'fiera__cliente' }, h('span', {}, 'Cliente'), h('strong', {}, f.cliente)) : null),

    h('footer', { class: 'fiera__azioni' },
      h('button', { class: 'btn btn--mini btn--primario', onclick: () => apriAssegna(f, prodotti, ricarica) }, '+ Materiale'),
      h('button', { class: 'btn btn--mini', onclick: () => apriDettaglio(f.id, prodotti, ricarica) }, 'Dettaglio'),
      h('button', { class: 'btn btn--mini', onclick: () => apriForm(f, ricarica) }, 'Modifica'),
      h('button', {
        class: 'btn btn--mini btn--pericolo',
        onclick: () => conferma({
          titolo: 'Eliminare la fiera?',
          messaggio: `"${f.nome}" e le sue ${f.righe_noleggio} righe di noleggio verranno eliminate.`,
          onConferma: async () => {
            await api.eliminaFiera(f.id);
            avviso('Fiera eliminata.');
            await ricarica();
          },
        }),
      }, 'Elimina')));
}

export default async function vistaFiere({ corpo, azioni, ricarica }) {
  const { stati_fiera: statiFiera } = statoApp.costanti;
  azioni.appendChild(h('button', {
    class: 'btn btn--primario', onclick: () => apriForm(null, ricarica),
  }, '+ Nuova fiera'));

  const prodotti = await api.prodotti();
  const filtri = { q: '', stato: '' };
  const contenitore = h('div', {});

  const disegna = async () => {
    const elenco = await api.fiere(filtri);
    monta(contenitore,
      h('p', { class: 'riepilogo-filtro' },
        `${numero(elenco.length)} fiere · ${numero(elenco.reduce((t, f) => t + f.pezzi_totali, 0))} pezzi impegnati complessivamente`),
      elenco.length
        ? h('div', { class: 'griglia-fiere' }, elenco.map((f) => schedaFiera(f, prodotti, ricarica)))
        : vuoto('Nessuna fiera trovata',
            'Registra la prima fiera per assegnarle il materiale.',
            h('button', { class: 'btn btn--primario', onclick: () => apriForm(null, ricarica) }, '+ Nuova fiera')));
  };

  const cerca = input('q', { placeholder: 'Cerca per nome, cliente o città…', type: 'search' });
  cerca.addEventListener('input', () => { filtri.q = cerca.value.trim(); disegna(); });

  const selStato = select('stato',
    [{ valore: '', testo: 'Tutti gli stati' }, ...statiFiera.map((s) => ({ valore: s, testo: etichetta(s) }))], '');
  selStato.addEventListener('change', () => { filtri.stato = selStato.value; disegna(); });

  monta(corpo, h('div', { class: 'filtri' }, cerca, selStato), contenitore);
  await disegna();
}
