import { api } from '../api.js';
import { stato as statoApp } from '../app.js';
import {
  h, monta, badge, modale, conferma, avviso, campo, input, select, areaTesto,
  griglia, numero, euro, vuoto, intervalloDate, etichetta, oggiISO, addGiorni,
} from '../ui.js';

const PROSSIMO_STATO = { prenotato: 'consegnato', consegnato: 'rientrato' };
const AZIONE = { prenotato: 'Segna consegnato', consegnato: 'Segna rientrato' };

function formNoleggio(n, prodotti, fiere) {
  const { stati_noleggio: statiNoleggio } = statoApp.costanti;
  const oggi = oggiISO();
  return [
    griglia(
      campo('Prodotto', select('prodotto_id',
        prodotti.map((p) => ({ valore: p.id, testo: `${p.nome} — ${p.quantita} pz` })),
        n?.prodotto_id), { largo: true }),
      campo('Fiera', select('fiera_id',
        fiere.map((f) => ({ valore: f.id, testo: `${f.nome} — ${intervalloDate(f.data_inizio, f.data_fine)}` })),
        n?.fiera_id), { largo: true }),
      campo('Cliente', input('cliente', { value: n?.cliente || '', placeholder: 'Nome dell\'azienda espositrice' })),
      campo('Stand', input('stand', { value: n?.stand || '', placeholder: 'PAD 5 - 5042' })),
      campo('Pezzi', input('quantita', { value: n?.quantita ?? 1, type: 'number', min: '1', required: true })),
      campo('Stato', select('stato', statiNoleggio, n?.stato || 'prenotato')),
      campo('Uscita dal magazzino', input('data_inizio', { value: n?.data_inizio || oggi, type: 'date', required: true })),
      campo('Rientro in magazzino', input('data_fine', { value: n?.data_fine || addGiorni(oggi, 5), type: 'date', required: true })),
      campo('Importo (€)', input('importo', {
        value: n?.importo ?? '', type: 'number', min: '0', step: '0.01', placeholder: 'calcolato dal listino',
      }), { aiuto: 'Totale del lavoro, non il prezzo al giorno.' }),
      campo('Note', areaTesto('note', { value: n?.note || '' }), { largo: true }),
    ),
  ];
}

function apriForm(n, prodotti, fiere, ricarica) {
  const modifica = Boolean(n?.id);
  if (!prodotti.length || !fiere.length) {
    return avviso('Servono almeno un prodotto e una fiera per creare un noleggio.', 'attenzione');
  }
  return modale({
    titolo: modifica ? 'Modifica noleggio' : 'Nuovo noleggio',
    sottotitolo: modifica ? `${n.prodotto_nome} · ${n.fiera_nome}` : 'Impegna del materiale su una fiera.',
    corpo: formNoleggio(n, prodotti, fiere),
    testoConferma: modifica ? 'Salva modifiche' : 'Crea noleggio',
    larga: true,
    onConferma: async (dati) => {
      if (modifica) await api.modificaNoleggio(n.id, dati);
      else await api.creaNoleggio(dati);
      avviso(modifica ? 'Noleggio aggiornato.' : 'Noleggio creato.');
      await ricarica();
    },
  });
}

export default async function vistaNoleggi({ corpo, azioni, ricarica }) {
  const { stati_noleggio: statiNoleggio } = statoApp.costanti;
  const [prodotti, fiere] = await Promise.all([api.prodotti(), api.fiere()]);

  azioni.appendChild(h('button', {
    class: 'btn btn--primario',
    onclick: () => apriForm(null, prodotti, fiere, ricarica),
  }, '+ Nuovo noleggio'));

  const filtri = { q: '', stato: '', fiera_id: '', prodotto_id: '' };
  const contenitore = h('div', {});

  const disegna = async () => {
    const elenco = await api.noleggi(filtri);
    const attivi = elenco.filter((n) => n.stato !== 'annullato');
    const pezzi = attivi.reduce((t, n) => t + n.quantita, 0);
    const valore = attivi.reduce((t, n) => t + n.importo, 0);

    monta(contenitore,
      h('p', { class: 'riepilogo-filtro' },
        `${numero(elenco.length)} righe · ${numero(pezzi)} pezzi · ${euro(valore)} di valore`),
      elenco.length
        ? h('div', { class: 'pannello pannello--tabella' },
            h('table', { class: 'tabella tabella--ampia' },
              h('thead', {}, h('tr', {},
                h('th', {}, 'Cliente'), h('th', {}, 'Prodotto'), h('th', {}, 'Fiera'),
                h('th', {}, 'Periodo'), h('th', {}, 'Pezzi'), h('th', {}, 'Importo'),
                h('th', {}, 'Stato'), h('th', {}, ''))),
              h('tbody', {}, elenco.map((n) => h('tr', { class: `riga--${n.stato}` },
                h('td', {},
                  h('strong', {}, n.cliente || '—'),
                  n.stand ? h('div', { class: 'sottotesto' }, n.stand) : null),
                h('td', {},
                  n.prodotto_nome,
                  h('div', { class: 'sottotesto' }, n.prodotto_categoria)),
                h('td', {},
                  n.fiera_nome,
                  n.fiera_citta ? h('div', { class: 'sottotesto' }, n.fiera_citta) : null),
                h('td', {},
                  intervalloDate(n.data_inizio, n.data_fine),
                  h('div', { class: 'sottotesto' }, `${n.giorni} gg`)),
                h('td', {}, numero(n.quantita)),
                h('td', {}, euro(n.importo)),
                h('td', {}, badge(n.stato)),
                h('td', { class: 'tabella__azioni' },
                  PROSSIMO_STATO[n.stato] ? h('button', {
                    class: 'btn btn--mini btn--primario',
                    onclick: async () => {
                      await api.statoNoleggio(n.id, PROSSIMO_STATO[n.stato]);
                      avviso(`Noleggio segnato come ${etichetta(PROSSIMO_STATO[n.stato]).toLowerCase()}.`);
                      await disegna();
                    },
                  }, AZIONE[n.stato]) : null,
                  h('button', {
                    class: 'btn btn--mini',
                    onclick: () => apriForm(n, prodotti, fiere, ricarica),
                  }, 'Modifica'),
                  h('button', {
                    class: 'btn btn--mini btn--pericolo',
                    onclick: () => conferma({
                      titolo: 'Eliminare il noleggio?',
                      messaggio: `${n.quantita}× ${n.prodotto_nome} per ${n.cliente || 'cliente non indicato'} `
                        + `su "${n.fiera_nome}" verrà rimosso.`,
                      onConferma: async () => {
                        await api.eliminaNoleggio(n.id);
                        avviso('Noleggio eliminato.');
                        await disegna();
                      },
                    }),
                  }, 'Elimina')))))))
        : vuoto('Nessun noleggio trovato',
            'Assegna del materiale a una fiera per vederlo comparire qui.',
            h('button', {
              class: 'btn btn--primario',
              onclick: () => apriForm(null, prodotti, fiere, ricarica),
            }, '+ Nuovo noleggio')));
  };

  const cerca = input('q', { placeholder: 'Cerca per cliente, stand, prodotto o fiera…', type: 'search' });
  cerca.addEventListener('input', () => { filtri.q = cerca.value.trim(); disegna(); });

  const selStato = select('stato',
    [{ valore: '', testo: 'Tutti gli stati' }, ...statiNoleggio.map((s) => ({ valore: s, testo: etichetta(s) }))], '');
  selStato.addEventListener('change', () => { filtri.stato = selStato.value; disegna(); });

  const selFiera = select('fiera_id',
    [{ valore: '', testo: 'Tutte le fiere' }, ...fiere.map((f) => ({ valore: f.id, testo: f.nome }))], '');
  selFiera.addEventListener('change', () => { filtri.fiera_id = selFiera.value; disegna(); });

  const selProdotto = select('prodotto_id',
    [{ valore: '', testo: 'Tutti i prodotti' }, ...prodotti.map((p) => ({ valore: p.id, testo: p.nome }))], '');
  selProdotto.addEventListener('change', () => { filtri.prodotto_id = selProdotto.value; disegna(); });

  monta(corpo, h('div', { class: 'filtri' }, cerca, selStato, selFiera, selProdotto), contenitore);
  await disegna();
}
