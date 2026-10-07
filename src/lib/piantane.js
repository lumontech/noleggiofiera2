// Piantane abbinate ai TV "su piantana".
//
// Il montaggio "su piantana" non è solo un'indicazione: serve una piantana
// vera, che deve risultare occupata. A ogni TV su piantana si abbina quindi un
// noleggio di una piantana libera e adatta alla misura (43-55 per i TV fino a
// 55", 43-85 per i più grandi), nello stesso stand e nelle stesse date. La
// piantana segue il TV: date, stand e stato; se il TV cambia montaggio, viene
// annullato o eliminato, la piantana prenotata si libera.

import db from './db.js';
import { verificaCapienza } from './disponibilita.js';

const SCHERMI = ['TV', 'Monitor', 'Videowall', 'Totem'];
const ATTIVI = ['prenotato', 'consegnato'];

/** "Piantana 43-85" → [43, 85]; senza misure nel nome, null (va bene per tutti). */
export function portataPiantana(nome) {
  const m = /(\d{2})\s*[-–]\s*(\d{2,3})/.exec(nome || '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Le piantane adatte a un TV, dalla più "giusta" (portata più stretta) alla più larga. */
function piantaneAdatte(pollici) {
  return db.prepare(`
    SELECT * FROM prodotti
     WHERE categoria = 'Supporto' AND lower(nome) LIKE '%piantana%' AND stato = 'attivo'`).all()
    .map((p) => ({ ...p, portata: portataPiantana(p.nome) }))
    .filter((p) => !p.portata || !pollici || (pollici >= p.portata[0] - 1 && pollici <= p.portata[1] + 1))
    .sort((a, b) => ((a.portata ? a.portata[1] - a.portata[0] : 999) - (b.portata ? b.portata[1] - b.portata[0] : 999))
      || a.id - b.id);
}

const libera = (piantana, from, to, escludi = null) => verificaCapienza({
  prodotto: piantana, quantita: 1, from, to, escludiNoleggio: escludi,
}).ok;

/**
 * Allinea le piantane di un noleggio TV. Restituisce quante ne ha create e
 * quante mancano perché non ce n'erano di libere.
 */
export function sincronizzaPiantane(noleggioId) {
  const tv = db.prepare(`
    SELECT n.*, p.categoria, p.pollici, p.nome AS prodotto_nome, p.codice AS prodotto_codice
      FROM noleggi n JOIN prodotti p ON p.id = n.prodotto_id WHERE n.id = ?`).get(noleggioId);
  const esito = { create: 0, mancanti: 0 };
  if (!tv) return esito;
  const collegate = db.prepare('SELECT * FROM noleggi WHERE abbinato_a = ? ORDER BY id').all(tv.id);
  const servono = SCHERMI.includes(tv.categoria) && tv.montaggio === 'piantana' && tv.stato !== 'annullato'
    ? tv.quantita : 0;
  const adesso = new Date().toISOString();

  // Quelle in più: si tolgono se erano solo prenotate, altrimenti seguono lo stato del TV.
  for (const p of collegate.slice(servono)) {
    if (p.stato === 'prenotato') db.prepare('DELETE FROM noleggi WHERE id = ?').run(p.id);
    else if (tv.stato === 'annullato') db.prepare("UPDATE noleggi SET stato = 'annullato', aggiornato_il = ? WHERE id = ?").run(adesso, p.id);
  }

  // Quelle che restano seguono il TV; se nelle nuove date la piantana è occupata
  // se ne cerca un'altra, e se non c'è si toglie.
  const tenute = collegate.slice(0, servono);
  const usate = new Set();
  let attive = 0;
  for (const p of tenute) {
    const piantana = db.prepare('SELECT * FROM prodotti WHERE id = ?').get(p.prodotto_id);
    let prodottoId = p.prodotto_id;
    if (ATTIVI.includes(tv.stato) && !libera(piantana, tv.data_inizio, tv.data_fine, p.id)) {
      const altra = piantaneAdatte(tv.pollici).find((x) => !usate.has(x.id) && libera(x, tv.data_inizio, tv.data_fine, p.id));
      if (!altra) {
        // Si toglie; sotto si riprova a trovarne una, e se non c'è si conta come mancante.
        db.prepare('DELETE FROM noleggi WHERE id = ?').run(p.id);
        continue;
      }
      prodottoId = altra.id;
    }
    usate.add(prodottoId);
    attive += 1;
    db.prepare(`
      UPDATE noleggi SET prodotto_id = ?, fiera_id = ?, cliente = ?, stand = ?, padiglione = ?,
                         data_inizio = ?, data_fine = ?, stato = ?, aggiornato_il = ?
       WHERE id = ?`).run(prodottoId, tv.fiera_id, tv.cliente, tv.stand, tv.padiglione || '',
      tv.data_inizio, tv.data_fine, tv.stato, adesso, p.id);
  }

  // Quelle che mancano: solo per un TV ancora da installare o installato.
  if (ATTIVI.includes(tv.stato)) {
    for (let i = attive; i < servono; i += 1) {
      const piantana = piantaneAdatte(tv.pollici).find((x) => !usate.has(x.id) && libera(x, tv.data_inizio, tv.data_fine));
      if (!piantana) { esito.mancanti += 1; continue; }
      usate.add(piantana.id);
      db.prepare(`
        INSERT INTO noleggi (prodotto_id, fiera_id, cliente, stand, padiglione, quantita, data_inizio, data_fine,
                             stato, importo, note, montaggio, note_tecnico, abbinato_a, creato_il, aggiornato_il)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 0, ?, '', '', ?, ?, ?)`)
        .run(piantana.id, tv.fiera_id, tv.cliente, tv.stand, tv.padiglione || '', tv.data_inizio, tv.data_fine,
          tv.stato, `Piantana per il TV ${/^\d+$/.test(tv.prodotto_codice || '') ? `ID ${tv.prodotto_codice}` : tv.prodotto_nome}`,
          tv.id, adesso, adesso);
      esito.create += 1;
    }
  }
  return esito;
}

/** Prima di eliminare un TV: le sue piantane prenotate si tolgono, le altre restano senza abbinamento. */
export function sganciaPiantane(noleggioId) {
  db.prepare("DELETE FROM noleggi WHERE abbinato_a = ? AND stato = 'prenotato'").run(noleggioId);
  db.prepare('UPDATE noleggi SET abbinato_a = NULL WHERE abbinato_a = ?').run(noleggioId);
}

/** Messaggio per chi ha salvato, se qualcosa sulle piantane va detto. */
export function avvisoPiantane(esito) {
  if (esito.mancanti) {
    return `Nessuna piantana libera e adatta in quelle date per ${esito.mancanti === 1 ? 'un TV' : `${esito.mancanti} TV`}: `
      + 'il montaggio resta "su piantana" ma la piantana va trovata.';
  }
  if (esito.create) return `${esito.create === 1 ? 'Abbinata una piantana' : `Abbinate ${esito.create} piantane`} al TV.`;
  return '';
}

/**
 * Una volta sola: collega ai TV "su piantana" le piantane già noleggiate nello
 * stesso stand, e abbina una piantana ai TV ancora da installare che non ce
 * l'hanno. Restituisce quante ne ha collegate e create.
 */
export function abbinaPiantaneEsistenti() {
  const fatto = db.prepare("SELECT 1 FROM impostazioni WHERE chiave = 'piantane_abbinate'").get();
  if (fatto) return null;
  const esito = { collegate: 0, create: 0, mancanti: 0 };
  db.transaction(() => {
    const tv = db.prepare(`
      SELECT n.* FROM noleggi n JOIN prodotti p ON p.id = n.prodotto_id
       WHERE n.montaggio = 'piantana' AND p.categoria IN ('TV', 'Monitor', 'Videowall', 'Totem')
       ORDER BY n.id`).all();
    const libere = db.prepare(`
      SELECT n.id FROM noleggi n JOIN prodotti p ON p.id = n.prodotto_id
       WHERE n.abbinato_a IS NULL AND p.categoria = 'Supporto' AND lower(p.nome) LIKE '%piantana%'
         AND n.fiera_id = ? AND lower(trim(n.cliente)) = lower(trim(?)) AND lower(trim(n.stand)) = lower(trim(?))
       ORDER BY n.id LIMIT ?`);
    for (const t of tv) {
      for (const p of libere.all(t.fiera_id, t.cliente || '', t.stand || '', t.quantita)) {
        db.prepare('UPDATE noleggi SET abbinato_a = ? WHERE id = ?').run(t.id, p.id);
        esito.collegate += 1;
      }
    }
    const oggi = new Date().toISOString().slice(0, 10);
    for (const t of tv.filter((x) => ATTIVI.includes(x.stato) && x.data_fine >= oggi)) {
      const r = sincronizzaPiantane(t.id);
      esito.create += r.create;
      esito.mancanti += r.mancanti;
    }
    db.prepare("INSERT INTO impostazioni (chiave, valore, aggiornato_il) VALUES ('piantane_abbinate', '1', ?)")
      .run(new Date().toISOString());
  })();
  if (esito.collegate || esito.create || esito.mancanti) {
    console.log(`Piantane: ${esito.collegate} collegate ai loro TV, ${esito.create} abbinate ai TV su piantana`
      + `${esito.mancanti ? `, ${esito.mancanti} senza piantana libera` : ''}.`);
  }
  return esito;
}
