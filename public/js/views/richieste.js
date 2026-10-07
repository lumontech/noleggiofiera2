// Le richieste mandate dagli organizzatori di fiera. Confermando si scelgono
// gli apparecchi (proposti in automatico tra quelli liberi) e l'importo: la
// richiesta diventa noleggi normali. Rifiutando si scrive il motivo, che
// l'organizzatore legge.

import { api } from '../api.js';
import { testoPosto } from '../pianta/stand.js';
import {
  h, monta, modale, avviso, campo, input, areaTesto, vuoto, numero, intervalloDate, dataLunga,
  nomeBreve, idProdotto,
  MONTAGGI, badgeMontaggio, avvisoPiantane,
} from '../ui.js';

const riassunto = (righe) => righe.map((r) => `${r.quantita}× ${r.tipo === 'tv' ? `TV ${r.pollici}"` : 'Piantana'}`).join(' · ');
const ETICHETTE = { nuova: 'Da gestire', confermata: 'Confermata', rifiutata: 'Rifiutata', annullata: 'Ritirata' };

async function conferma(r, ricarica) {
  const { righe } = await api.propostaRichiesta(r.id);
  const scelte = [];
  // Il montaggio chiesto dall'organizzatore vale per tutti gli schermi; "misto" si decide uno per uno.
  const montaggioChiesto = ['parete', 'piantana', 'tavolo'].includes(r.montaggio) ? r.montaggio : '';
  const corpoRighe = righe.map((riga) => h('div', { class: 'conferma-riga' },
    h('p', { class: 'conferma-riga__titolo' },
      h('strong', {}, `${riga.quantita}× ${riga.etichetta}`),
      riga.mancano ? h('span', { class: 'conferma-riga__manca' },
        ` · ne mancano ${riga.mancano}: in quelle date ci sono solo ${riga.alternative.length} liberi`) : null),
    ...Array.from({ length: riga.quantita }, (_, i) => {
      const apparecchio = h('select', { class: 'controllo', 'aria-label': 'Apparecchio' },
        h('option', { value: '' }, '— nessuno —'),
        riga.alternative.map((a) => h('option', { value: a.id, selected: riga.proposti[i]?.id === a.id },
          `${idProdotto(a.codice)} · ${nomeBreve(a)}`)));
      // Le piantane non hanno un montaggio: solo gli schermi.
      const montaggio = riga.tipo === 'tv' ? h('select', { class: 'controllo', 'aria-label': 'Montaggio' },
        MONTAGGI.map((m) => h('option', { value: m.valore, selected: m.valore === montaggioChiesto }, m.testo))) : null;
      scelte.push({ apparecchio, montaggio });
      return h('div', { class: `conferma-unita ${montaggio ? '' : 'conferma-unita--sola'}` }, apparecchio, montaggio);
    })));

  modale({
    titolo: `Conferma per ${r.espositore}`,
    sottotitolo: `${r.fiera_nome}${posto(r) ? ` · ${posto(r)}` : ''} · ${riassunto(r.righe)}`,
    testoConferma: 'Conferma e crea i noleggi',
    larga: true,
    corpo: [
      h('p', { class: 'form-sezione__testo' },
        'Ho scelto gli apparecchi liberi in quelle date: puoi cambiarli. Diventeranno noleggi "prenotati" per le date della fiera.'),
      ...corpoRighe,
      campo('Note per il tecnico', areaTesto('note_tecnico', {
        maxlength: 500, rows: 2, value: r.note || '', placeholder: 'es. altezza 1,40 da terra',
      }), { aiuto: 'Le vede chi installa: ho riportato le note dell\'organizzatore, correggile se serve.' }),
      campo('Importo totale (€)', input('importo', { type: 'number', min: '0', step: '0.01', placeholder: '0' }),
        { aiuto: 'Il totale del lavoro: si divide tra gli apparecchi. L\'organizzatore non lo vede.' }),
      campo('Messaggio per l\'organizzatore', areaTesto('nota', { maxlength: 500, placeholder: 'es. consegna il giorno prima alle 9' }),
        { aiuto: 'Facoltativo: lo legge nella sua schermata.' }),
    ],
    onConferma: async (dati) => {
      const apparecchi = scelte.filter((s) => s.apparecchio.value)
        .map((s) => ({ id: Number(s.apparecchio.value), montaggio: s.montaggio?.value || '' }));
      const ids = apparecchi.map((a) => a.id);
      if (!ids.length) throw new Error('Scegli almeno un apparecchio.');
      if (new Set(ids).size !== ids.length) throw new Error('Lo stesso apparecchio è scelto due volte.');
      const confermata = await api.confermaRichiesta(r.id, {
        apparecchi, importo: dati.importo, nota: dati.nota, note_tecnico: dati.note_tecnico,
      });
      avviso(`Richiesta di ${r.espositore} confermata: ${ids.length} noleggi creati.`);
      avvisoPiantane(confermata);
      await ricarica();
    },
  });
}

/** "pad. 5 · stand 5042": sempre padiglione e poi stand, anche se lo stand è scritto "PAD 5 - 5042". */
const posto = (r) => testoPosto(r.stand, '', r.padiglione);

function rifiuta(r, ricarica) {
  modale({
    titolo: `Rifiuta la richiesta di ${r.espositore}`,
    sottotitolo: `${r.fiera_nome} · ${riassunto(r.righe)}`,
    testoConferma: 'Rifiuta',
    corpo: [campo('Motivo (lo legge l\'organizzatore)', areaTesto('motivo', {
      maxlength: 500, placeholder: 'es. i TV da 86" sono già tutti impegnati in quelle date',
    }), { largo: true })],
    onConferma: async ({ motivo }) => {
      await api.rifiutaRichiesta(r.id, { motivo });
      avviso('Richiesta rifiutata.');
      await ricarica();
    },
  });
}

function schedaRichiesta(r, ricarica) {
  return h('article', { class: `richiesta richiesta--${r.stato}` },
    h('header', { class: 'richiesta__testa' },
      h('div', {},
        h('h3', {}, r.espositore, posto(r) ? h('span', { class: 'richiesta__stand' }, ` · ${posto(r)}`) : null),
        h('p', {}, `${r.fiera_nome} · ${intervalloDate(r.fiera_inizio, r.fiera_fine)}`)),
      h('span', { class: `org-stato org-stato--${r.stato === 'nuova' ? 'attesa' : r.stato === 'confermata' ? 'ok' : 'no'}` },
        ETICHETTE[r.stato] || r.stato)),
    h('p', { class: 'richiesta__righe' }, riassunto(r.righe), ' ', badgeMontaggio(r.montaggio)),
    r.referente ? h('p', { class: 'richiesta__dettaglio' }, `Referente: ${r.referente}`) : null,
    r.note ? h('p', { class: 'richiesta__dettaglio' }, `Note: ${r.note}`) : null,
    r.risposta ? h('p', { class: 'richiesta__dettaglio' }, `Risposta: ${r.risposta}`) : null,
    h('footer', { class: 'richiesta__piede' },
      h('span', {}, `Da ${r.autore_nome || 'utente eliminato'} · ${dataLunga(r.creato_il.slice(0, 10))}`
        + `${r.stato === 'confermata' ? ` · ${numero(r.noleggi.length)} noleggi creati` : ''}`),
      r.stato === 'nuova' ? h('div', { class: 'richiesta__azioni' },
        h('button', { class: 'btn btn--mini', onclick: () => rifiuta(r, ricarica) }, 'Rifiuta'),
        h('button', { class: 'btn btn--mini btn--primario', onclick: () => conferma(r, ricarica).catch((e) => avviso(e.message, 'errore')) }, 'Conferma…'))
        : null));
}

let scheda = 'nuove';

export default async function vistaRichieste({ corpo, ricarica }) {
  const elenco = await api.richieste();
  const nuove = elenco.filter((r) => r.stato === 'nuova');
  const gestite = elenco.filter((r) => r.stato !== 'nuova');
  const barra = h('div', { class: 'schede', role: 'tablist' });
  const contenitore = h('div', { class: 'richieste' });

  const disegna = () => {
    monta(barra, [['nuove', 'Da gestire', nuove], ['gestite', 'Gestite', gestite]].map(([id, testo, lista]) => h('button', {
      class: `scheda ${id === scheda ? 'scheda--attiva' : ''}`,
      role: 'tab',
      dataset: { scheda: id },
      onclick: () => { scheda = id; disegna(); },
    }, testo, h('span', { class: 'scheda__conta' }, numero(lista.length)))));
    const lista = scheda === 'nuove' ? nuove : gestite;
    monta(contenitore, lista.length
      ? lista.map((r) => schedaRichiesta(r, ricarica))
      : vuoto(scheda === 'nuove' ? 'Nessuna richiesta da gestire' : 'Nessuna richiesta gestita',
          'Le richieste arrivano dagli organizzatori di fiera: crea il loro utente in Utenti, con ruolo "Organizzatore fiera".'));
  };
  monta(corpo, barra, contenitore);
  disegna();
}
