// La schermata dell'organizzatore di fiera: le sue fiere in programma e le
// richieste di monitor per gli espositori. Nessun prezzo: i dati arrivano da
// /api/organizzatore, che non ne contiene.

import { api } from '../api.js';
import { testoPosto } from '../pianta/stand.js';
import {
  h, monta, modale, avviso, campo, input, areaTesto, griglia, vuoto, numero, intervalloDate, dataLunga,
  select, etichettaMontaggio,
} from '../ui.js';

const STATI = {
  nuova: { testo: 'In attesa', classe: 'attesa' },
  confermata: { testo: 'Confermata', classe: 'ok' },
  rifiutata: { testo: 'Non disponibile', classe: 'no' },
};

const riassunto = (righe) => righe.map((r) => `${r.quantita}× ${r.etichetta}`).join(' · ');

/** "pad. 5 · stand 5042": sempre padiglione e poi stand, anche se lo stand è scritto "PAD 5 - 5042". */
const posto = (r) => testoPosto(r.stand, '', r.padiglione);

/** Un contatore − n + per una voce del catalogo. */
function contatore(voce) {
  const valore = h('input', {
    class: 'contatore__valore', type: 'number', name: `q_${voce.chiave}`, value: 0, min: 0,
    max: voce.liberi, inputmode: 'numeric', 'aria-label': `Quante ${voce.etichetta}`,
  });
  const cambia = (delta) => {
    const n = Math.min(Math.max((Number(valore.value) || 0) + delta, 0), voce.liberi);
    valore.value = n;
    riga.classList.toggle('richiesta-voce--scelta', n > 0);
  };
  valore.addEventListener('change', () => cambia(0));
  const esaurito = voce.liberi === 0;
  const riga = h('div', { class: `richiesta-voce ${esaurito ? 'richiesta-voce--esaurita' : ''}` },
    h('div', { class: 'richiesta-voce__nome' },
      h('strong', {}, voce.etichetta),
      h('span', {}, esaurito ? 'esauriti in queste date' : `ancora ${numero(voce.liberi)} liberi`)),
    h('div', { class: 'contatore' },
      h('button', { type: 'button', class: 'btn contatore__bottone', disabled: esaurito, onclick: () => cambia(-1), 'aria-label': 'Uno in meno' }, '−'),
      valore,
      h('button', { type: 'button', class: 'btn contatore__bottone', disabled: esaurito, onclick: () => cambia(1), 'aria-label': 'Uno in più' }, '+')));
  return riga;
}

function nuovaRichiesta(fiera, ricarica) {
  modale({
    titolo: `Richiesta monitor · ${fiera.nome}`,
    sottotitolo: `${intervalloDate(fiera.data_inizio, fiera.data_fine)}. Ti confermiamo appena possibile.`,
    testoConferma: 'Invia richiesta',
    corpo: [
      griglia(
        campo('Espositore', input('espositore', { required: true, maxlength: 120, placeholder: 'Nome dell\'azienda' }), { largo: true }),
        h('div', { class: 'campi-posto' },
          campo('Padiglione', input('padiglione', { maxlength: 40, placeholder: 'es. 5' })),
          campo('Stand', input('stand', { maxlength: 120, placeholder: 'es. 5042' }))),
        campo('Referente', input('referente', { maxlength: 160, placeholder: 'Nome e telefono' })),
      ),
      h('h3', { class: 'form-sezione' }, 'Cosa serve'),
      // Prima gli schermi, poi piantane, casse e il resto.
      ...[['Schermi', true], ['Piantane e accessori', false]].map(([titolo, schermo]) => {
        const voci = fiera.catalogo.filter((v) => Boolean(v.schermo) === schermo);
        return voci.length ? h('div', { class: 'richiesta-voci' },
          h('p', { class: 'richiesta-voci__titolo' }, titolo), voci.map(contatore)) : null;
      }),
      campo('Come vanno montati i monitor?', select('montaggio', [
        { valore: '', testo: 'Da definire' },
        { valore: 'parete', testo: 'A parete' },
        { valore: 'piantana', testo: 'Su piantana' },
        { valore: 'tavolo', testo: 'Da tavolo' },
        { valore: 'misto', testo: 'Misto: lo spiego nelle note' },
      ], ''), { largo: true }),
      campo('Note', areaTesto('note', { maxlength: 1000, placeholder: 'es. a parete, altezza da terra, orari di consegna…' }), { largo: true }),
    ],
    onConferma: async (dati) => {
      const righe = fiera.catalogo.map((v) => ({
        chiave: v.chiave, quantita: Number(dati[`q_${v.chiave}`]) || 0,
      }));
      await api.inviaRichiesta({
        fiera_id: fiera.id,
        espositore: dati.espositore,
        stand: dati.stand,
        padiglione: dati.padiglione,
        referente: dati.referente,
        note: dati.note,
        montaggio: dati.montaggio,
        righe,
      });
      avviso('Richiesta inviata.');
      await ricarica();
    },
  });
}

function voceRichiesta(r, ricarica) {
  const stato = STATI[r.stato] || { testo: r.stato, classe: 'attesa' };
  return h('li', { class: 'org-richiesta' },
    h('div', { class: 'org-richiesta__testa' },
      h('div', {},
        h('strong', {}, r.espositore),
        posto(r) ? h('span', { class: 'org-richiesta__stand' }, ` · ${posto(r)}`) : null),
      h('span', { class: `org-stato org-stato--${stato.classe}` }, stato.testo)),
    h('p', { class: 'org-richiesta__righe' }, riassunto(r.righe),
      r.montaggio ? h('span', { class: 'org-richiesta__montaggio' }, ` · ${etichettaMontaggio(r.montaggio).toLowerCase()}`) : null),
    r.note ? h('p', { class: 'org-richiesta__nota' }, r.note) : null,
    r.risposta ? h('p', { class: `org-richiesta__risposta org-richiesta__risposta--${stato.classe}` }, r.risposta) : null,
    h('div', { class: 'org-richiesta__piede' },
      h('span', {}, `Inviata ${dataLunga(r.creato_il.slice(0, 10))}${r.inviata_da ? ` da ${r.inviata_da}` : ''}`),
      r.stato === 'nuova' ? h('button', {
        class: 'btn btn--mini',
        onclick: async () => {
          if (!window.confirm(`Ritirare la richiesta per ${r.espositore}?`)) return;
          try {
            await api.ritiraRichiesta(r.id);
            avviso('Richiesta ritirata.');
            await ricarica();
          } catch (err) { avviso(err.message, 'errore'); }
        },
      }, 'Ritira') : null));
}

function schedaFiera(f, ricarica) {
  const inAttesa = f.richieste.filter((r) => r.stato === 'nuova').length;
  return h('section', { class: 'org-fiera' },
    h('header', { class: 'org-fiera__testa' },
      h('div', {},
        h('h2', {}, f.nome),
        h('p', { class: 'org-fiera__quando' }, intervalloDate(f.data_inizio, f.data_fine)),
        [f.luogo, f.citta].filter(Boolean).length
          ? h('p', { class: 'org-fiera__dove' }, [f.luogo, f.citta].filter(Boolean).join(' · ')) : null),
      h('button', { class: 'btn btn--primario org-fiera__nuova', onclick: () => nuovaRichiesta(f, ricarica) }, '+ Richiedi monitor')),
    h('h3', { class: 'titolo-sezione' },
      `Le richieste (${numero(f.richieste.length)})${inAttesa ? ` · ${numero(inAttesa)} in attesa` : ''}`),
    f.richieste.length
      ? h('ul', { class: 'org-richieste' }, f.richieste.map((r) => voceRichiesta(r, ricarica)))
      : h('p', { class: 'org-vuoto' }, 'Nessuna richiesta ancora. Usa "Richiedi monitor" per il primo espositore.'),
    f.confermati.length ? h('details', { class: 'org-confermati' },
      h('summary', {}, `Già confermati alla fiera (${numero(f.confermati.length)} espositori)`),
      h('ul', {}, f.confermati.map((c) => h('li', {},
        h('strong', {}, c.espositore || 'Espositore'), posto(c) ? ` · ${posto(c)}` : '',
        h('span', {}, ` — ${c.apparecchi.map((a) => `${a.quantita}× ${a.nome}`).join(' · ')}`))))) : null);
}

export default async function vistaOrganizzatore({ corpo, ricarica }) {
  const { fiere } = await api.fiereOrganizzatore();
  if (!fiere.length) {
    monta(corpo, vuoto('Nessuna fiera in programma',
      'Quando ci sarà una nuova edizione delle tue fiere, la trovi qui per richiedere i monitor.'));
    return;
  }
  monta(corpo, h('div', { class: 'org-fiere' }, fiere.map((f) => schedaFiera(f, ricarica))));
}
