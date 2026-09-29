// Richieste di monitor mandate dagli organizzatori di fiera.
//
// L'organizzatore non sceglie l'apparecchio: chiede "2 TV da 65" e una
// piantana" per un espositore e uno stand. Alla conferma l'amministratore
// assegna gli apparecchi liberi (proposti in automatico) e la richiesta
// diventa noleggi normali, con tutti i controlli di disponibilità.

import db from './db.js';
import { HttpError, testo, intero } from './domain.js';
import { apparecchiPerPeriodo } from './disponibilita.js';
import { finestraLogistica } from '../routes/fiere.js';

export const STATI_RICHIESTA = ['nuova', 'confermata', 'rifiutata', 'annullata'];
const TIPI = ['tv', 'piantana'];
const SCHERMI = ['TV', 'Monitor'];

/** A che tipo di richiesta corrisponde un apparecchio (null se non si chiede così). */
export function tipoDi(apparecchio) {
  if (SCHERMI.includes(apparecchio.categoria) && apparecchio.pollici) {
    return { tipo: 'tv', pollici: Math.round(apparecchio.pollici) };
  }
  if (apparecchio.categoria === 'Supporto' && /piantana/i.test(apparecchio.nome)) return { tipo: 'piantana' };
  return null;
}

export const etichettaRiga = (r) => (r.tipo === 'tv' ? `TV ${r.pollici}"` : 'Piantana');
const stessoTipo = (a, b) => a.tipo === b.tipo && (a.tipo !== 'tv' || a.pollici === b.pollici);

/**
 * Cosa si può chiedere per un'edizione, con quanti apparecchi sono ancora
 * liberi nelle sue date: [{ tipo, pollici, etichetta, liberi }].
 * I tipi sono quelli presenti in magazzino, anche se in quel momento finiti.
 */
export function catalogo(fiera) {
  const { from, to } = finestraLogistica(fiera);
  const voci = [];
  for (const a of apparecchiPerPeriodo({ from, to })) {
    const tipo = tipoDi(a);
    if (!tipo || a.stato === 'dismesso') continue;
    let voce = voci.find((v) => stessoTipo(v, tipo));
    if (!voce) {
      voce = { ...tipo, etichetta: etichettaRiga(tipo), liberi: 0 };
      voci.push(voce);
    }
    voce.liberi += a.liberi;
  }
  return voci.sort((a, b) => (a.tipo === b.tipo ? (a.pollici || 0) - (b.pollici || 0) : a.tipo === 'tv' ? -1 : 1));
}

/** Le righe di una richiesta, validate. Le quantità a zero si scartano. */
export function leggiRighe(valore) {
  const righe = (Array.isArray(valore) ? valore : [])
    .map((r) => {
      const tipo = String(r?.tipo || '');
      if (!TIPI.includes(tipo)) throw new HttpError(400, 'Tipo di apparecchio non valido.');
      const quantita = intero(r.quantita, 'quantità', { min: 0, max: 50, predefinito: 0 });
      return tipo === 'tv'
        ? { tipo, pollici: intero(r.pollici, 'pollici', { min: 10, max: 150 }), quantita }
        : { tipo, quantita };
    })
    .filter((r) => r.quantita > 0);
  if (!righe.length) throw new HttpError(400, 'Indica almeno un monitor o una piantana.');
  return righe;
}

export function leggiRichiesta(body) {
  return {
    espositore: testo(body.espositore, 'espositore', { obbligatorio: true, max: 120 }),
    stand: testo(body.stand, 'stand', { max: 120 }),
    referente: testo(body.referente, 'referente', { max: 160 }),
    note: testo(body.note, 'note', { max: 1000 }),
    righe: leggiRighe(body.righe),
  };
}

/** Una richiesta come la vede l'organizzatore: nessun importo, nessun apparecchio interno. */
export function perOrganizzatore(r) {
  return {
    id: r.id,
    fiera_id: r.fiera_id,
    espositore: r.espositore,
    stand: r.stand,
    referente: r.referente,
    righe: JSON.parse(r.righe),
    note: r.note,
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
  return JSON.parse(richiesta.righe).map((riga) => {
    const adatti = liberi.filter((a) => {
      const t = tipoDi(a);
      return t && stessoTipo(t, riga);
    });
    const proposti = adatti.filter((a) => !usati.has(a.id)).slice(0, riga.quantita);
    proposti.forEach((a) => usati.add(a.id));
    const perElenco = (a) => ({ id: a.id, codice: a.codice, nome: a.nome, marca: a.marca, pollici: a.pollici });
    return {
      ...riga,
      etichetta: etichettaRiga(riga),
      proposti: proposti.map(perElenco),
      alternative: adatti.map(perElenco),
      mancano: Math.max(riga.quantita - proposti.length, 0),
    };
  });
}
