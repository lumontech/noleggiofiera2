// Richieste di monitor mandate dagli organizzatori di fiera.
//
// L'organizzatore non sceglie l'apparecchio: chiede "2 TV da 65", una
// piantana e una cassa" per un espositore e uno stand. Alla conferma l'amministratore
// assegna gli apparecchi liberi (proposti in automatico) e la richiesta
// diventa noleggi normali, con tutti i controlli di disponibilità.

import db from './db.js';
import { HttpError, testo, intero, enumerato, MONTAGGI, nomeSenzaCodici } from './domain.js';
import { apparecchiPerPeriodo } from './disponibilita.js';
import { finestraLogistica } from '../routes/fiere.js';

export const STATI_RICHIESTA = ['nuova', 'confermata', 'rifiutata', 'annullata'];
const SCHERMI = ['TV', 'Monitor', 'Totem', 'Videowall'];

// "CASSA SINGOLA CON MIC" → "Cassa singola con mic"; i nomi scritti normali restano.
const leggibile = (nome) => (nome === nome.toUpperCase() && /[A-Z]{3}/.test(nome)
  ? nome.charAt(0) + nome.slice(1).toLowerCase() : nome);

/**
 * La voce di catalogo di un apparecchio, cioè come lo chiede l'organizzatore:
 * gli schermi per tipo e misura (TV 65", Monitor 65" touch, Totem 55"), le
 * piantane tutte insieme, il resto (casse, segreterie…) per nome.
 * { chiave, etichetta, schermo, ordine }
 */
export function voceDi(a) {
  const pollici = Math.round(Number(a.pollici) || 0);
  if (SCHERMI.includes(a.categoria) && pollici) {
    const touch = /touch/i.test(a.nome || '');
    const tipo = touch ? 'touch' : a.categoria.toLowerCase();
    const nome = touch ? `Monitor ${pollici}" touch` : `${a.categoria} ${pollici}"`;
    return { chiave: `${tipo}_${pollici}`, etichetta: nome, schermo: true, ordine: [['tv', 'monitor', 'touch', 'totem', 'videowall'].indexOf(tipo), pollici] };
  }
  if (a.categoria === 'Supporto' && /piantana/i.test(a.nome || '')) {
    return { chiave: 'piantana', etichetta: 'Piantana', schermo: false, ordine: [10, 0] };
  }
  const nome = leggibile(nomeSenzaCodici(a.nome)) || a.categoria;
  const chiave = `art_${nome.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}`;
  return { chiave, etichetta: nome, schermo: false, ordine: [11, 0] };
}

/** Le righe salvate prima delle voci di catalogo: { tipo: 'tv', pollici } o { tipo: 'piantana' }. */
export function rigaCompleta(r) {
  if (r.chiave) return r;
  if (r.tipo === 'tv') return { ...r, chiave: `tv_${r.pollici}`, etichetta: `TV ${r.pollici}"`, schermo: true };
  return { ...r, chiave: 'piantana', etichetta: 'Piantana', schermo: false };
}

/**
 * Cosa si può chiedere per un'edizione, con quanti apparecchi sono ancora
 * liberi nelle sue date: [{ chiave, etichetta, schermo, liberi }].
 * Le voci sono quelle presenti in magazzino, anche se in quel momento finite.
 */
export function catalogo(fiera) {
  const { from, to } = finestraLogistica(fiera);
  const voci = new Map();
  for (const a of apparecchiPerPeriodo({ from, to })) {
    if (a.stato === 'dismesso') continue;
    const voce = voceDi(a);
    if (!voci.has(voce.chiave)) voci.set(voce.chiave, { ...voce, liberi: 0 });
    voci.get(voce.chiave).liberi += a.liberi;
  }
  return [...voci.values()]
    .sort((a, b) => a.ordine[0] - b.ordine[0] || a.ordine[1] - b.ordine[1] || a.etichetta.localeCompare(b.etichetta, 'it'))
    .map(({ ordine, ...voce }) => voce);
}

/** Le righe di una richiesta, validate sul catalogo della fiera. Le quantità a zero si scartano. */
export function leggiRighe(valore, fiera) {
  const voci = new Map(catalogo(fiera).map((v) => [v.chiave, v]));
  const righe = (Array.isArray(valore) ? valore : [])
    .map((r) => {
      const voce = voci.get(String(r?.chiave || ''));
      if (!voce) throw new HttpError(400, 'Apparecchio non valido: ricarica la pagina e riprova.');
      const quantita = intero(r.quantita, 'quantità', { min: 0, max: 50, predefinito: 0 });
      return { chiave: voce.chiave, etichetta: voce.etichetta, schermo: voce.schermo, quantita };
    })
    .filter((r) => r.quantita > 0);
  if (!righe.length) throw new HttpError(400, 'Indica almeno un apparecchio.');
  return righe;
}

export function leggiRichiesta(body, fiera) {
  return {
    espositore: testo(body.espositore, 'espositore', { obbligatorio: true, max: 120 }),
    stand: testo(body.stand, 'stand', { max: 120 }),
    padiglione: testo(body.padiglione, 'padiglione', { max: 40 }),
    referente: testo(body.referente, 'referente', { max: 160 }),
    note: testo(body.note, 'note', { max: 1000 }),
    // "misto" = alcuni a parete e altri su piantana: il dettaglio va nelle note.
    montaggio: enumerato(body.montaggio, 'montaggio', [...MONTAGGI, 'misto'], ''),
    righe: leggiRighe(body.righe, fiera),
  };
}

/** Una richiesta come la vede l'organizzatore: nessun importo, nessun apparecchio interno. */
export function perOrganizzatore(r) {
  return {
    id: r.id,
    fiera_id: r.fiera_id,
    espositore: r.espositore,
    stand: r.stand,
    padiglione: r.padiglione || '',
    referente: r.referente,
    righe: JSON.parse(r.righe).map(rigaCompleta),
    note: r.note,
    montaggio: r.montaggio || '',
    stato: r.stato,
    risposta: r.risposta,
    inviata_da: r.autore_nome || '',
    creato_il: r.creato_il,
    aggiornato_il: r.aggiornato_il,
  };
}

export function trovaRichiesta(id) {
  const r = db.prepare(`
    SELECT r.*, u.nome AS autore_nome FROM richieste r LEFT JOIN utenti u ON u.id = r.utente_id
     WHERE r.id = ?`).get(id);
  if (!r) throw new HttpError(404, 'Richiesta non trovata.');
  return r;
}

/**
 * Per ogni riga, gli apparecchi liberi che la soddisfano: i primi `quantita`
 * sono la proposta, gli altri alternative. Se non bastano, `mancano` > 0.
 */
export function proposta(richiesta, fiera) {
  const { from, to } = finestraLogistica(fiera);
  const liberi = apparecchiPerPeriodo({ from, to }).filter((a) => a.liberi > 0 && a.stato === 'attivo');
  const usati = new Set();
  return JSON.parse(richiesta.righe).map(rigaCompleta).map((riga) => {
    const adatti = liberi.filter((a) => voceDi(a).chiave === riga.chiave);
    const proposti = adatti.filter((a) => !usati.has(a.id)).slice(0, riga.quantita);
    proposti.forEach((a) => usati.add(a.id));
    const perElenco = (a) => ({ id: a.id, codice: a.codice, nome: a.nome, marca: a.marca, pollici: a.pollici });
    return {
      ...riga,
      proposti: proposti.map(perElenco),
      alternative: adatti.map(perElenco),
      mancano: Math.max(riga.quantita - proposti.length, 0),
    };
  });
}
