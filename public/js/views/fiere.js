// Fiere: ogni manifestazione (Pharmexpo) raccoglie le sue edizioni (2025, 2026).
// "Nuova fiera" crea una manifestazione; "Nuova edizione", dentro una fiera,
// ne aggiunge un anno partendo dai dati dell'edizione precedente.

import { api, caricaAllegato } from '../api.js';
import { stato as statoApp } from '../app.js';
import { selettoreApparecchi } from '../selettore-apparecchi.js';
import { apriPianta } from '../pianta/visore.js';
import {
  h, monta, badge, modale, avviso, campo, input, select, areaTesto,
  griglia, numero, euro, vuoto, intervalloDate, dataLunga, etichetta, oggiISO, addGiorni,
  notePulite, dimensioneFile,
} from '../ui.js';

const DIMENSIONE_MASSIMA = 30 * 1024 * 1024;
const TIPI_ACCETTATI = 'application/pdf,image/png,image/jpeg,image/webp';

/* ---------- form fiera / edizione ---------- */

/**
 * modo: 'fiera'    → nuova manifestazione, con la sua prima edizione
 *       'edizione' → nuovo anno di una manifestazione esistente
 *       'modifica' → modifica di un'edizione
 */
function formFiera(f, { modo, manifestazioniNote }) {
  const { stati_fiera: statiFiera } = statoApp.costanti;
  const oggi = oggiISO();

  let campoManifestazione;
  if (modo === 'edizione') {
    // La manifestazione è quella da cui si è partiti: non si cambia qui.
    campoManifestazione = h('input', { type: 'hidden', name: 'manifestazione', value: f.manifestazione });
  } else {
    const avvisoEsistente = h('span', { class: 'campo__aiuto' },
      modo === 'fiera'
        ? 'Il nome che si ripete ogni anno, senza l\'anno: "Pharmexpo", non "Pharmexpo 2026".'
        : 'Scrivendo il nome di un\'altra fiera, questa edizione passa sotto quella.');
    const controllo = input('manifestazione', {
      value: f.manifestazione || '', required: true, placeholder: 'Pharmexpo', autocomplete: 'off',
      list: modo === 'modifica' ? 'manifestazioni-note' : null,
    });
    // Se in "Nuova fiera" si scrive un nome già esistente, lo si dice subito:
    // verrà aggiunta come nuova edizione di quella fiera, non come fiera nuova.
    if (modo === 'fiera') {
      controllo.addEventListener('input', () => {
        const scritta = controllo.value.trim().toLowerCase();
        const trovata = manifestazioniNote.find((m) => m.toLowerCase() === scritta);
        avvisoEsistente.className = trovata ? 'campo__aiuto campo__aiuto--attenzione' : 'campo__aiuto';
        avvisoEsistente.textContent = trovata
          ? `"${trovata}" esiste già: questa diventerà una sua nuova edizione.`
          : 'Il nome che si ripete ogni anno, senza l\'anno: "Pharmexpo", non "Pharmexpo 2026".';
      });
    }
    campoManifestazione = h('label', { class: 'campo' },
      h('span', { class: 'campo__etichetta' }, 'Nome della fiera'),
      controllo,
      avvisoEsistente,
      modo === 'modifica'
        ? h('datalist', { id: 'manifestazioni-note' }, manifestazioniNote.map((m) => h('option', { value: m })))
        : null);
  }

  return [
    griglia(
      campoManifestazione,
      campo('Anno', input('anno', { value: f.anno || '', type: 'number', min: '2000', max: '2100', placeholder: '2026' })),
      modo === 'edizione' ? null : campo('Stato', select('stato', statiFiera, f.stato || 'pianificata')),
      campo('Primo giorno', input('data_inizio', { value: f.data_inizio || addGiorni(oggi, 14), type: 'date', required: true })),
      campo('Ultimo giorno', input('data_fine', { value: f.data_fine || addGiorni(oggi, 17), type: 'date', required: true })),
      campo('Quartiere fieristico', input('luogo', { value: f.luogo || '', placeholder: 'Mostra d\'Oltremare' })),
      campo('Città', input('citta', { value: f.citta || '', placeholder: 'Napoli' })),
      campo('Giorni di allestimento', input('giorni_allestimento', { value: f.giorni_allestimento ?? 1, type: 'number', min: '0' }),
        { aiuto: 'Giorni prima dell\'apertura in cui il materiale è già fuori.' }),
      campo('Giorni di smontaggio', input('giorni_smontaggio', { value: f.giorni_smontaggio ?? 1, type: 'number', min: '0' }),
        { aiuto: 'Giorni dopo la chiusura prima del rientro in magazzino.' }),
      modo === 'modifica'
        ? campo('Nome dell\'edizione', input('nome', { value: f.nome || '', placeholder: 'lasciato vuoto: "Pharmexpo 2026"' }), { largo: true })
        : null,
      campo('Note', areaTesto('note', { value: notePulite(f.note) }), { largo: true }),
    ),
  ];
}

/** Stessa data un anno dopo; il 29 febbraio diventa 28 se l'anno non è bisestile. */
function unAnnoDopo(iso) {
  const [a, m, g] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(a + 1, m - 1, g));
  if (d.getUTCMonth() !== m - 1) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/**
 * Proposta per la nuova edizione: sede, giorni di montaggio e periodo
 * dell'ultima edizione, spostati di un anno. Si correggono le date e basta.
 */
function propostaNuovaEdizione(g) {
  const ultima = g.edizioni[0];
  const annoUltima = ultima.anno || Number(ultima.data_inizio.slice(0, 4));
  return {
    manifestazione: g.manifestazione,
    anno: annoUltima + 1,
    luogo: ultima.luogo,
    citta: ultima.citta,
    giorni_allestimento: ultima.giorni_allestimento,
    giorni_smontaggio: ultima.giorni_smontaggio,
    data_inizio: unAnnoDopo(ultima.data_inizio),
    data_fine: unAnnoDopo(ultima.data_fine),
  };
}

function apriForm({ modo, fiera = {}, ricarica, manifestazioniNote = [] }) {
  const TESTI = {
    fiera: { titolo: 'Nuova fiera', sotto: 'Crea la fiera e la sua prima edizione.', ok: 'Crea fiera' },
    edizione: {
      titolo: `Nuova edizione di ${fiera.manifestazione}`,
      sotto: 'Sede e giorni di montaggio sono quelli dell\'ultima edizione; controlla le date.',
      ok: 'Crea edizione',
    },
    modifica: { titolo: 'Modifica edizione', sotto: fiera.nome, ok: 'Salva modifiche' },
  }[modo];

  modale({
    titolo: TESTI.titolo,
    sottotitolo: TESTI.sotto,
    corpo: formFiera(fiera, { modo, manifestazioniNote }),
    testoConferma: TESTI.ok,
    larga: true,
    azionePericolosa: modo === 'modifica' ? {
      testo: 'Elimina edizione',
      testoConferma: fiera.righe_noleggio
        ? `Elimina anche i suoi ${fiera.righe_noleggio} noleggi`
        : 'Clicca ancora per eliminare',
      onClick: async () => {
        await api.eliminaFiera(fiera.id);
        avviso(`${fiera.nome} eliminata.`);
        await ricarica();
      },
    } : null,
    onConferma: async (dati) => {
      if (modo === 'modifica') {
        const esito = await api.modificaFiera(fiera.id, dati);
        const parti = ['Edizione aggiornata.'];
        if (esito.noleggi_spostati) parti.push(`${esito.noleggi_spostati} noleggi spostati sulle nuove date.`);
        if (esito.noleggi_con_date_proprie) {
          parti.push(`${esito.noleggi_con_date_proprie} con date proprie sono rimasti invariati.`);
        }
        avviso(parti.join(' '));
      } else {
        const creata = await api.creaFiera({ stato: 'pianificata', ...dati });
        avviso(modo === 'fiera' ? `${creata.manifestazione} creata.` : `${creata.nome} creata.`);
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


/* ---------- planimetrie ---------- */

function voceAllegato(fiera, a, { gestione, dopoModifica }) {
  const immagine = a.tipo.startsWith('image/');
  const anteprima = immagine
    ? h('img', { class: 'allegato__anteprima', src: a.url, alt: '', loading: 'lazy' })
    : h('span', { class: 'allegato__anteprima allegato__anteprima--pdf', 'aria-hidden': 'true' }, 'PDF');

  const elimina = gestione ? (() => {
    let armato = false;
    const b = h('button', {
      class: 'btn btn--mini btn--pericolo',
      type: 'button',
      onclick: async () => {
        if (!armato) {
          armato = true;
          b.textContent = 'Conferma';
          b.classList.add('btn--armato');
          setTimeout(() => { armato = false; b.textContent = 'Elimina'; b.classList.remove('btn--armato'); }, 4000);
          return;
        }
        b.disabled = true;
        await api.eliminaAllegato(fiera.id, a.id);
        avviso(`${a.nome} eliminata.`);
        dopoModifica();
      },
    }, 'Elimina');
    return b;
  })() : null;

  return h('li', { class: 'allegato' },
    h('a', { class: 'allegato__apri', href: a.url, target: '_blank', rel: 'noopener', title: 'Apri in una nuova scheda' },
      anteprima,
      h('span', { class: 'allegato__testo' },
        h('strong', {}, a.nome),
        h('span', {}, `${dimensioneFile(a.dimensione)} · caricata il ${dataLunga(a.creato_il.slice(0, 10))}`))),
    h('div', { class: 'allegato__azioni' },
      h('button', {
        class: 'btn btn--mini btn--primario',
        type: 'button',
        title: 'La planimetria con coperti gli stand dove vanno i televisori',
        onclick: () => apriPianta({ fiera, allegato: a }),
      }, 'Pianta con TV'),
      h('a', { class: 'btn btn--mini', href: a.url, target: '_blank', rel: 'noopener' }, 'Apri'),
      elimina));
}

async function apriPlanimetrie(fiera, ricarica) {
  const elenco = h('ul', { class: 'allegati' });
  const caricamenti = h('ul', { class: 'caricamenti' });
  const scegli = h('input', { type: 'file', accept: TIPI_ACCETTATI, multiple: true, hidden: true });

  const aggiornaElenco = async () => {
    const allegati = (await api.fiera(fiera.id)).allegati;
    monta(elenco, allegati.length
      ? allegati.map((a) => voceAllegato(fiera, a, { gestione: true, dopoModifica: aggiorna }))
      : h('li', { class: 'allegati__vuoto' }, 'Nessuna planimetria ancora.'));
  };
  // Dopo ogni modifica si aggiorna anche la pagina sotto, per il contatore sulla scheda.
  const aggiorna = async () => { await aggiornaElenco(); ricarica(); };

  async function caricaFile(file) {
    const barra = h('span', { class: 'caricamento__barra' });
    const stato = h('span', { class: 'caricamento__stato' }, 'in caricamento…');
    const voce = h('li', { class: 'caricamento' },
      h('span', { class: 'caricamento__nome' }, file.name), stato,
      h('span', { class: 'caricamento__traccia' }, barra));
    caricamenti.appendChild(voce);

    // Controlli immediati, per non aspettare un invio destinato a fallire.
    const errore = file.size > DIMENSIONE_MASSIMA
      ? `troppo grande (${dimensioneFile(file.size)}, massimo 30 MB)`
      : !TIPI_ACCETTATI.split(',').includes(file.type) && !/\.(pdf|png|jpe?g|webp)$/i.test(file.name)
        ? 'formato non supportato: servono PDF o immagini'
        : null;
    if (errore) {
      voce.classList.add('caricamento--errore');
      stato.textContent = errore;
      return false;
    }
    try {
      await caricaAllegato(fiera.id, file, (quota) => { barra.style.width = `${Math.round(quota * 100)}%`; });
      voce.remove();
      return true;
    } catch (err) {
      voce.classList.add('caricamento--errore');
      stato.textContent = err.message;
      return false;
    }
  }

  async function caricaTutti(files) {
    const riusciti = (await Promise.all([...files].map(caricaFile))).filter(Boolean).length;
    if (riusciti) {
      avviso(riusciti === 1 ? 'Planimetria caricata.' : `${riusciti} planimetrie caricate.`);
      await aggiorna();
    }
  }

  scegli.addEventListener('change', () => { caricaTutti(scegli.files); scegli.value = ''; });

  const zona = h('div', {
    class: 'zona-caricamento',
    ondragover: (e) => { e.preventDefault(); zona.classList.add('zona-caricamento--sopra'); },
    ondragleave: () => zona.classList.remove('zona-caricamento--sopra'),
    ondrop: (e) => {
      e.preventDefault();
      zona.classList.remove('zona-caricamento--sopra');
      caricaTutti(e.dataTransfer.files);
    },
  },
  h('p', { class: 'zona-caricamento__titolo' }, 'Trascina qui la planimetria'),
  h('p', { class: 'zona-caricamento__testo' }, 'PDF o immagine, fino a 30 MB. Dal telefono puoi anche fotografarla.'),
  h('button', { class: 'btn btn--primario', type: 'button', onclick: () => scegli.click() }, 'Scegli file'),
  scegli);

  modale({
    titolo: `Planimetrie · ${fiera.nome}`,
    sottotitolo: 'Si aprono con un clic. Puoi allegarne più d\'una, per esempio una per padiglione.',
    larga: true,
    soloChiudi: true,
    testoConferma: 'Chiudi',
    corpo: [h('div', { class: 'planimetrie' }, zona, caricamenti, elenco)],
    onConferma: async () => {},
  });
  await aggiornaElenco();
}

async function apriDettaglio(id, prodotti, ricarica) {
  const fiera = await api.fiera(id);
  const attivi = fiera.noleggi.filter((n) => n.stato !== 'annullato');

  const tabella = attivi.length
    ? h('table', { class: 'tabella' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Cliente'), h('th', {}, 'Prodotto'), h('th', {}, 'Pezzi'),
          h('th', {}, 'Periodo'), h('th', {}, 'Importo'), h('th', {}, 'Stato'))),
        h('tbody', {}, attivi.map((n) => h('tr', {},
          h('td', {}, h('strong', {}, n.cliente || '—'),
            n.stand ? h('div', { class: 'sottotesto' }, n.stand) : null),
          h('td', {}, n.prodotto_nome,
            h('div', { class: 'sottotesto' }, `${n.prodotto_categoria}${n.prodotto_pollici ? ` ${n.prodotto_pollici}"` : ''}`)),
          h('td', {}, numero(n.quantita)),
          h('td', {}, intervalloDate(n.data_inizio, n.data_fine)),
          h('td', {}, euro(n.importo)),
          h('td', {}, badge(n.stato))))))
    : vuoto('Nessun materiale assegnato', 'Aggiungi i primi prodotti da portare in fiera.');

  modale({
    titolo: fiera.nome,
    sottotitolo: [fiera.citta, fiera.luogo].filter(Boolean).join(' · ') || 'Sede da definire',
    larga: true,
    soloChiudi: true,
    testoConferma: 'Chiudi',
    corpo: [
      h('div', { class: 'dettaglio-numeri' },
        h('div', {}, h('span', {}, 'Apertura'), h('strong', {}, intervalloDate(fiera.data_inizio, fiera.data_fine))),
        h('div', {}, h('span', {}, 'Materiale fuori'), h('strong', {}, intervalloDate(fiera.from, fiera.to))),
        h('div', {}, h('span', {}, 'Pezzi'), h('strong', {}, numero(fiera.pezzi_totali))),
        h('div', {}, h('span', {}, 'Valore'), h('strong', {}, euro(fiera.valore)))),
      notePulite(fiera.note) ? h('p', { class: 'dettaglio-note' }, notePulite(fiera.note)) : null,
      fiera.allegati.length
        ? h('div', { class: 'dettaglio-sezione' },
            h('h3', {}, `Planimetrie (${fiera.allegati.length})`),
            h('ul', { class: 'allegati' },
              fiera.allegati.map((a) => voceAllegato(fiera, a, { gestione: false }))))
        : null,
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

function schedaEdizione(f, { prodotti, ricarica, note }) {
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
      h('button', {
        class: `btn btn--mini btn--planimetrie ${f.num_allegati ? 'btn--planimetrie-piene' : ''}`,
        onclick: () => apriPlanimetrie(f, ricarica),
      }, f.num_allegati ? `Planimetrie (${f.num_allegati})` : 'Planimetria'),
      h('button', { class: 'btn btn--mini', onclick: () => apriDettaglio(f.id, prodotti, ricarica) }, 'Dettaglio'),
      h('button', {
        class: 'btn btn--mini',
        onclick: () => apriForm({ modo: 'modifica', fiera: f, ricarica, manifestazioniNote: note }),
      }, 'Modifica')));
}

/** Una fiera con sotto tutte le sue edizioni, e il bottone per aggiungerne una. */
function gruppoManifestazione(g, contesto) {
  return h('section', { class: 'manifestazione' },
    h('header', { class: 'manifestazione__testa' },
      h('div', {},
        h('h2', {}, g.manifestazione),
        h('p', {},
          `${g.edizioni.length} ${g.edizioni.length === 1 ? 'edizione' : 'edizioni'}`,
          ` · ${numero(g.pezzi_totali)} pezzi noleggiati in totale`,
          ` · ${euro(g.valore_totale)}`)),
      h('div', { class: 'manifestazione__azioni' },
        g.prossima
          ? h('span', { class: 'manifestazione__prossima' },
              `Prossima: ${intervalloDate(g.prossima.data_inizio, g.prossima.data_fine)}`)
          : null,
        h('button', {
          class: 'btn btn--mini',
          onclick: () => apriForm({
            modo: 'edizione', fiera: propostaNuovaEdizione(g), ricarica: contesto.ricarica,
          }),
        }, '+ Nuova edizione'))),
    h('div', { class: 'griglia-fiere' }, g.edizioni.map((e) => schedaEdizione(e, contesto))));
}

export default async function vistaFiere({ corpo, azioni, ricarica }) {
  const { stati_fiera: statiFiera } = statoApp.costanti;
  const prodotti = await api.prodotti();
  const filtri = { q: '', stato: '' };
  const contenitore = h('div', { class: 'manifestazioni' });
  const contesto = { prodotti, ricarica, note: [] };

  const nuovaFiera = () => apriForm({ modo: 'fiera', ricarica, manifestazioniNote: contesto.note });
  azioni.appendChild(h('button', { class: 'btn btn--primario', onclick: nuovaFiera }, '+ Nuova fiera'));

  const disegna = async () => {
    const gruppi = await api.manifestazioni();
    contesto.note = gruppi.map((g) => g.manifestazione);
    const testo = filtri.q.toLowerCase();

    // I filtri agiscono sulle edizioni; una fiera resta se ne salva almeno una.
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
        `${numero(visibili.length)} fiere · ${numero(edizioni)} edizioni · `
        + `${euro(visibili.reduce((t, g) => t + g.edizioni.reduce((s, e) => s + e.valore, 0), 0))} di fatturato`),
      visibili.length
        ? visibili.map((g) => gruppoManifestazione(g, contesto))
        : vuoto('Nessuna fiera trovata',
            'Cambia i filtri oppure crea la prima fiera.',
            h('button', { class: 'btn btn--primario', onclick: nuovaFiera }, '+ Nuova fiera')));
  };

  const cerca = input('q', { placeholder: 'Cerca per fiera o città…', type: 'search' });
  cerca.addEventListener('input', () => { filtri.q = cerca.value.trim(); disegna(); });

  const selStato = select('stato',
    [{ valore: '', testo: 'Tutti gli stati' }, ...statiFiera.map((s) => ({ valore: s, testo: etichetta(s) }))], '');
  selStato.addEventListener('change', () => { filtri.stato = selStato.value; disegna(); });

  monta(corpo, h('div', { class: 'filtri' }, cerca, selStato), contenitore);
  await disegna();
}
