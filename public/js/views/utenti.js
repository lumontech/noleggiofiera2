// Chi può entrare e cosa vede. Tre ruoli: l'amministratore vede tutto; il
// tecnico solo le installazioni (cosa montare, dove, con la pianta); l'organizzatore
// di fiera solo le sue fiere, da cui manda le richieste di monitor. Gli ultimi
// due non vedono mai prezzi.

import { api } from '../api.js';
import { stato as statoApp } from '../app.js';
import {
  h, monta, modale, avviso, campo, input, select, griglia, vuoto, dataBreve,
} from '../ui.js';

const RUOLI = [
  { valore: 'tecnico', testo: 'Tecnico' },
  { valore: 'organizzatore', testo: 'Organizzatore fiera' },
  { valore: 'amministratore', testo: 'Amministratore' },
];

const DESCRIZIONE_RUOLO = {
  tecnico: 'Vede solo cosa installare, in quale stand e la pianta con le TV. Nessun prezzo, nessun importo.',
  organizzatore: 'Vede solo le sue fiere in programma e manda le richieste di monitor per gli espositori. Nessun prezzo.',
  amministratore: 'Vede e modifica tutto: prodotti, fiere, noleggi, importi e utenti.',
};

const nomeRuolo = (ruolo) => RUOLI.find((r) => r.valore === ruolo)?.testo || ruolo;

function formUtente(u, manifestazioni, sceltaFiere) {
  const modifica = Boolean(u.id);
  const aiutoRuolo = h('span', { class: 'campo__aiuto' }, DESCRIZIONE_RUOLO[u.ruolo || 'tecnico']);
  const ruolo = select('ruolo', RUOLI, u.ruolo || 'tecnico');
  const campoRuolo = campo('Ruolo', ruolo);
  campoRuolo.appendChild(aiutoRuolo);

  // Le fiere dell'organizzatore: caselle, visibili solo con quel ruolo.
  const giaScelte = new Set((u.manifestazioni || []).map((m) => m.toLowerCase()));
  const caselle = manifestazioni.map((m) => h('label', { class: 'casella' },
    h('input', { type: 'checkbox', value: m, checked: giaScelte.has(m.toLowerCase()) }), m));
  sceltaFiere.caselle = caselle;
  const campoFiere = h('div', { class: 'campo campo--largo', hidden: (u.ruolo || 'tecnico') !== 'organizzatore' },
    h('span', { class: 'campo__etichetta' }, 'Le sue fiere'),
    h('div', { class: 'caselle' }, caselle),
    h('span', { class: 'campo__aiuto' }, 'Vedrà solo le edizioni in programma di queste fiere.'));
  ruolo.addEventListener('change', () => {
    aiutoRuolo.textContent = DESCRIZIONE_RUOLO[ruolo.value];
    campoFiere.hidden = ruolo.value !== 'organizzatore';
  });

  return griglia(
    campo('Nome e cognome', input('nome', { value: u.nome || '', required: true, maxlength: 80, placeholder: 'Mario Rossi' })),
    campo('Nome utente', input('accesso', {
      value: u.accesso || '', required: true, maxlength: 40, placeholder: 'mario',
      autocomplete: 'off', autocapitalize: 'none', spellcheck: false,
    }), { aiuto: 'Serve per entrare. Lettere minuscole, numeri, punto o trattino.' }),
    campoRuolo,
    campo(modifica ? 'Nuova password' : 'Password', input('password', {
      type: 'password', required: !modifica, minlength: 4, autocomplete: 'new-password',
      placeholder: modifica ? 'Lascia vuoto per non cambiarla' : 'Almeno 4 caratteri',
    }), { aiuto: modifica ? 'Se la cambi, l\'utente viene disconnesso da tutti i dispositivi.' : null }),
    campoFiere,
  );
}

function apriForm(u, ricarica, manifestazioni) {
  const modifica = Boolean(u?.id);
  const io = modifica && u.id === statoApp.utente?.id;
  const sceltaFiere = { caselle: [] };
  modale({
    titolo: modifica ? `Modifica ${u.nome}` : 'Nuovo utente',
    sottotitolo: modifica ? `Nome utente: ${u.accesso}` : 'Comunica tu nome utente e password alla persona.',
    corpo: formUtente(u || {}, manifestazioni, sceltaFiere),
    testoConferma: modifica ? 'Salva modifiche' : 'Crea utente',
    azionePericolosa: modifica && !io ? {
      testo: 'Elimina utente',
      testoConferma: 'Tocca ancora per eliminare',
      onClick: async () => {
        await api.eliminaUtente(u.id);
        avviso(`${u.nome} eliminato.`);
        await ricarica();
      },
    } : null,
    onConferma: async (dati) => {
      if (!dati.password) delete dati.password;
      dati.manifestazioni = dati.ruolo === 'organizzatore'
        ? sceltaFiere.caselle.filter((c) => c.firstChild.checked).map((c) => c.firstChild.value) : [];
      if (dati.ruolo === 'organizzatore' && !dati.manifestazioni.length) {
        throw new Error('Scegli almeno una fiera per l\'organizzatore.');
      }
      if (modifica) await api.modificaUtente(u.id, dati);
      else await api.creaUtente(dati);
      avviso(modifica ? 'Utente aggiornato.' : `Utente ${dati.accesso} creato.`);
      await ricarica();
    },
  });
}

function rigaUtente(u, ricarica, manifestazioni) {
  const io = u.id === statoApp.utente?.id;
  return h('article', { class: `utente ${u.attivo ? '' : 'utente--disattivato'}` },
    h('div', { class: 'utente__iniziale', 'aria-hidden': 'true' }, (u.nome || '?').trim().charAt(0).toUpperCase()),
    h('div', { class: 'utente__testo' },
      h('h3', {}, u.nome, io ? h('span', { class: 'utente__tu' }, ' (tu)') : null),
      h('p', {}, h('span', { class: 'utente__accesso' }, u.accesso), ' · ',
        u.ultimo_accesso ? `ultimo accesso ${dataBreve(u.ultimo_accesso.slice(0, 10))}` : 'mai entrato',
        u.ruolo === 'organizzatore' && u.manifestazioni.length ? ` · fiere: ${u.manifestazioni.join(', ')}` : '')),
    h('span', { class: `badge badge--ruolo-${u.ruolo}` }, nomeRuolo(u.ruolo)),
    u.attivo ? null : h('span', { class: 'badge badge--annullato' }, 'Disattivato'),
    h('div', { class: 'utente__azioni' },
      io ? null : h('button', {
        class: 'btn btn--mini',
        title: u.attivo ? 'Non potrà più entrare finché non lo riattivi' : 'Potrà di nuovo entrare',
        onclick: async () => {
          try {
            await api.modificaUtente(u.id, { attivo: !u.attivo });
            avviso(u.attivo ? `${u.nome} disattivato: è stato disconnesso.` : `${u.nome} riattivato.`);
            await ricarica();
          } catch (err) { avviso(err.message, 'errore'); }
        },
      }, u.attivo ? 'Disattiva' : 'Riattiva'),
      h('button', { class: 'btn btn--mini', onclick: () => apriForm(u, ricarica, manifestazioni) }, 'Modifica')));
}

export default async function vistaUtenti({ corpo, azioni, ricarica }) {
  const [elenco, gruppi] = await Promise.all([api.utenti(), api.manifestazioni()]);
  const manifestazioni = gruppi.map((g) => g.manifestazione).sort((a, b) => a.localeCompare(b, 'it'));
  const nuovo = () => apriForm(null, ricarica, manifestazioni);
  azioni.appendChild(h('button', { class: 'btn btn--primario', onclick: nuovo }, '+ Nuovo utente'));

  const perRuolo = (ruolo) => elenco.filter((u) => u.ruolo === ruolo);
  const tecnici = perRuolo('tecnico');
  const organizzatori = perRuolo('organizzatore');
  const amministratori = perRuolo('amministratore');
  const righe = (lista) => h('div', { class: 'utenti' }, lista.map((u) => rigaUtente(u, ricarica, manifestazioni)));

  monta(corpo,
    h('div', { class: 'ruoli' },
      RUOLI.map((r) => h('div', { class: 'ruoli__voce' },
        h('span', { class: `badge badge--ruolo-${r.valore}` }, r.testo),
        h('p', {}, DESCRIZIONE_RUOLO[r.valore])))),
    h('h2', { class: 'titolo-sezione' }, `Tecnici (${tecnici.length})`),
    tecnici.length
      ? righe(tecnici)
      : vuoto('Nessun tecnico',
          'Crea un utente con ruolo Tecnico: vedrà solo cosa installare e dove, senza prezzi.',
          h('button', { class: 'btn btn--primario', onclick: nuovo }, '+ Nuovo utente')),
    h('h2', { class: 'titolo-sezione' }, `Organizzatori fiera (${organizzatori.length})`),
    organizzatori.length
      ? righe(organizzatori)
      : vuoto('Nessun organizzatore',
          'Crea un utente con ruolo "Organizzatore fiera" e scegli le sue fiere: potrà richiedere i monitor da solo.'),
    h('h2', { class: 'titolo-sezione' }, `Amministratori (${amministratori.length})`),
    righe(amministratori));
}
