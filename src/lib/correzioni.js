// Correzioni una tantum ai dati importati, applicate all'avvio.
//
// Tre fiere non avevano date in Airtable e all'importazione erano state
// stimate. Le date vere sono quelle pubblicate dagli organizzatori: si
// correggono l'edizione e i suoi noleggi, ma solo se hanno ancora le date
// stimate (se sono state cambiate a mano, restano come sono).

import db from './db.js';

const DATE_STIMATE_DA_CORREGGERE = [
  { manifestazione: 'BMT', anno: 2026, stimate: ['2026-03-19', '2026-03-21'], vere: ['2026-03-12', '2026-03-14'] },
  { manifestazione: 'Pharmexpo', anno: 2026, stimate: ['2026-10-09', '2026-10-11'], vere: ['2026-10-23', '2026-10-25'] },
  { manifestazione: 'Siferr', anno: 2026, stimate: ['2026-05-21', '2026-05-23'], vere: ['2026-05-16', '2026-05-17'] },
];

const AVVISO_STIMA = /^⚠️ DATE STIMATE:.*\n?/m;

export function correggiDateStimate() {
  const corrette = [];
  const esegui = db.transaction(() => {
    for (const c of DATE_STIMATE_DA_CORREGGERE) {
      const fiera = db.prepare(`
        SELECT * FROM fiere WHERE manifestazione = ? COLLATE NOCASE AND anno = ?
           AND data_inizio = ? AND data_fine = ?`).get(c.manifestazione, c.anno, ...c.stimate);
      if (!fiera) continue;
      const daSpostare = db.prepare(`
        SELECT * FROM noleggi WHERE fiera_id = ? AND data_inizio = ? AND data_fine = ?`)
        .all(fiera.id, ...c.stimate);
      // Un apparecchio già impegnato altrove nelle date vere non si sposta da solo.
      const conflitto = daSpostare.some((n) => db.prepare(`
        SELECT 1 FROM noleggi WHERE prodotto_id = ? AND id != ? AND fiera_id != ?
           AND stato IN ('prenotato', 'consegnato') AND data_inizio <= ? AND data_fine >= ?`)
        .get(n.prodotto_id, n.id, fiera.id, c.vere[1], c.vere[0]));
      if (conflitto) {
        console.warn(`${fiera.nome}: date non corrette in automatico, un apparecchio è già impegnato. Correggile dall'app.`);
        continue;
      }
      const adesso = new Date().toISOString();
      db.prepare('UPDATE fiere SET data_inizio = ?, data_fine = ?, note = ?, aggiornato_il = ? WHERE id = ?')
        .run(...c.vere, (fiera.note || '').replace(AVVISO_STIMA, '').trim(), adesso, fiera.id);
      const aggiorna = db.prepare('UPDATE noleggi SET data_inizio = ?, data_fine = ?, aggiornato_il = ? WHERE id = ?');
      for (const n of daSpostare) aggiorna.run(...c.vere, adesso, n.id);
      corrette.push(`${fiera.nome} (${daSpostare.length} noleggi)`);
    }
  });
  esegui();
  if (corrette.length) console.log(`Date ufficiali applicate: ${corrette.join(', ')}.`);
  return corrette;
}
