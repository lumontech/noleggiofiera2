// PDF dei noleggi di una fiera (o di tutte quelle in programma): chi,
// in quale stand, quale apparecchio, come si monta e le note per il tecnico.
// Con gli importi per l'ufficio, senza per chi installa o per l'organizzatore.

import db from './db.js';
// La stessa regola della pianta con TV per leggere il numero dello stand.
import { codiciStand } from '../../public/js/pianta/stand.js';
import { titoloModello } from './catalogo-pdf.js';
import {
  COLORE, periodo, euro, oggi, dataLunga, nuovoDocumento, titoloSezione, tabella, chiudiDocumento,
} from './pdf.js';

const MONTAGGIO = { parete: 'A parete', piantana: 'Su piantana', tavolo: 'Da tavolo' };
const SCHERMI = ['TV', 'Monitor', 'Videowall', 'Totem'];

function noleggiDella(fiera, { soloAttivi }) {
  const righe = db.prepare(`
    SELECT n.*, p.nome, p.marca, p.modello, p.pollici, p.categoria, p.codice
      FROM noleggi n JOIN prodotti p ON p.id = n.prodotto_id
     WHERE n.fiera_id = ? AND n.stato ${soloAttivi ? "IN ('prenotato', 'consegnato')" : "!= 'annullato'"}`).all(fiera.id);
  // In ordine di stand (5017 prima di 5100), poi di espositore; senza stand in fondo.
  const chiave = (n) => codiciStand(n.stand)[0] || '';
  return righe.sort((a, b) => (!chiave(a)) - (!chiave(b))
    || chiave(a).localeCompare(chiave(b), 'it', { numeric: true })
    || (a.cliente || '').localeCompare(b.cliente || '', 'it'));
}

/** Le fiere da mettere nel documento: quella scelta, o tutte quelle in programma con noleggi. */
export function fierePerDocumento(fiera) {
  if (fiera) return [fiera];
  return db.prepare(`
    SELECT * FROM fiere f
     WHERE f.data_fine >= ? AND f.stato NOT IN ('annullata', 'conclusa')
       AND EXISTS (SELECT 1 FROM noleggi n WHERE n.fiera_id = f.id AND n.stato IN ('prenotato', 'consegnato'))
     ORDER BY f.data_inizio`).all(oggi());
}

export function scriviNoleggi(stream, { prezzi, fiera = null }) {
  const fiere = fierePerDocumento(fiera);
  const ctx = nuovoDocumento(stream, {
    titolo: fiera ? `Noleggi · ${fiera.nome}` : 'Noleggi delle fiere in programma',
    sottotitoli: [`Situazione al ${dataLunga(oggi())}`, prezzi && 'Importi IVA esclusa.'],
  });
  const colonne = [
    { titolo: 'Espositore · stand', peso: 27 },
    { titolo: 'Apparecchio', peso: 25 },
    { titolo: 'Montaggio', peso: 13 },
    { titolo: 'Note per il tecnico', peso: prezzi ? 21 : 35 },
    ...(prezzi ? [{ titolo: 'Importo', peso: 14, allinea: 'right' }] : []),
  ];

  let totaleGenerale = 0;
  if (!fiere.length) ctx.doc.font('Helvetica').fontSize(11).fillColor(COLORE.tenue).text('Nessun noleggio in programma.');
  for (const f of fiere) {
    const righe = noleggiDella(f, { soloAttivi: !fiera });
    const pezzi = righe.reduce((t, n) => t + n.quantita, 0);
    const espositori = new Set(righe.map((n) => n.cliente).filter(Boolean)).size;
    titoloSezione(ctx, f.nome, [periodo(f.data_inizio, f.data_fine), [f.luogo, f.citta].filter(Boolean).join(', '),
      `${pezzi} ${pezzi === 1 ? 'apparecchio' : 'apparecchi'}`, `${espositori} ${espositori === 1 ? 'espositore' : 'espositori'}`]
      .filter(Boolean).join(' · '));
    if (!righe.length) {
      ctx.doc.font('Helvetica').fontSize(9.5).fillColor(COLORE.tenue).text('Nessun noleggio su questa fiera.');
      continue;
    }
    const t = tabella(ctx, colonne);
    t.intestazione();
    let totale = 0;
    for (const n of righe) {
      totale += n.importo || 0;
      const schermo = SCHERMI.includes(n.categoria);
      t.riga([
        { testo: n.cliente || '—', grassetto: true, sotto: n.stand ? `Stand ${n.stand}` : '' },
        { testo: `${n.quantita > 1 ? `${n.quantita}× ` : ''}${titoloModello(n)}`, sotto: /^\d+$/.test(n.codice || '') ? `ID ${n.codice}` : n.codice },
        { testo: schermo ? (MONTAGGIO[n.montaggio] || 'Da definire') : '—', corpo: 8.5, colore: schermo && n.montaggio ? COLORE.testo : COLORE.tenue },
        { testo: n.note_tecnico || '', corpo: 8 },
        ...(prezzi ? [{ testo: euro(n.importo || 0), grassetto: true }] : []),
      ]);
    }
    if (prezzi) {
      t.riga([{ testo: 'Totale fiera', grassetto: true }, null, null, null, { testo: euro(totale), grassetto: true, corpo: 10.5 }],
        { sfondo: COLORE.fondo });
      totaleGenerale += totale;
    }
  }
  if (prezzi && fiere.length > 1) {
    ctx.doc.moveDown(0.8);
    ctx.doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORE.testo)
      .text(`Totale complessivo: ${euro(totaleGenerale)}`, ctx.sinistra, ctx.doc.y, { width: ctx.larghezza, align: 'right' });
  }
  chiudiDocumento(ctx);
}
