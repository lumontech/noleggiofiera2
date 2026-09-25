// Importa lo storico dalla base Airtable "Noleggio Breve Termine".
//
//   npm run importa            prova senza scrivere niente
//   npm run importa -- --scrivi  esegue davvero
//
// È idempotente: ogni riga porta il proprio ID Airtable nelle note, quindi una
// seconda esecuzione riconosce ciò che ha già importato e non lo duplica.

import fs from 'node:fs';
import path from 'node:path';
import db from './lib/db.js';
import { oggi, giorniTra } from './lib/domain.js';

const SCRIVI = process.argv.includes('--scrivi');
const CARTELLA = path.join(process.cwd(), 'dati');
const leggi = (nome) => JSON.parse(fs.readFileSync(path.join(CARTELLA, nome), 'utf8'));

const prodottiAirtable = leggi('airtable-prodotti.json');
const fiereAirtable = leggi('airtable-fiere.json');
const noleggiAirtable = leggi('airtable-noleggi.json');

const GIORNO = oggi();
const adesso = new Date().toISOString();
const marca = (id) => `[airtable:${id}]`;

/* ---------- mappature ---------- */

// In Airtable lo stato descrive il singolo apparecchio.
const STATO_PRODOTTO = {
  'Da noleggiare': 'attivo',
  Guasto: 'manutenzione',
  Regalata: 'dismesso',
};

// Airtable non ha un campo categoria: la si deduce dal nome e dai pollici.
function categoria(nome, pollici) {
  const n = nome.toLowerCase();
  if (n.includes('piantana') || n.includes('staffa') || n.includes('supporto')) return 'Supporto';
  if (n.includes('segreteria') || n.includes('cassa') || n.includes('mic')) return 'Accessorio';
  if (n.includes('totem')) return 'Totem';
  if (n.includes('videowall')) return 'Videowall';
  // Un apparecchio con i pollici è uno schermo: monitor se il nome lo dice,
  // altrimenti un televisore.
  if (pollici) return n.includes('monitor') ? 'Monitor' : 'TV';
  if (n.includes('monitor')) return 'Monitor';
  return 'Accessorio';
}

// Fiere per cui Airtable non riporta date su nessuna richiesta: si stima il
// periodo dal momento in cui le righe sono state inserite. Vanno confermate.
const DATE_STIMATE = {
  'recPQpmr2ItoDpNYV': ['2026-03-19', '2026-03-21'], // BMT 2026
  'recPguldBDBtaHw9I': ['2026-10-09', '2026-10-11'], // Pharmexpo 2026
  'recE96akFiwhiUXzQ': ['2026-05-21', '2026-05-23'], // Siferr 2026
};

/**
 * In Airtable la fiera è una riga per edizione, col nome che porta l'anno
 * ("Pharmexpo 2025", "Pharmexpo 2026"). Qui si separa la manifestazione
 * ricorrente dall'anno, così le edizioni si raggruppano.
 *
 * Alcune edizioni della stessa manifestazione sono state scritte in modo
 * diverso negli anni: questa tabella le riconcilia.
 */
const ALIAS_MANIFESTAZIONE = {
  'LTS Expo': 'LTS',
};

function scomponiNome(nome) {
  const trovato = nome.match(/^(.*?)\s+((?:19|20)\d{2})$/);
  if (!trovato) return { manifestazione: nome, anno: null };
  const grezza = trovato[1].trim();
  return {
    manifestazione: ALIAS_MANIFESTAZIONE[grezza] || grezza,
    anno: Number(trovato[2]),
  };
}

/* ---------- calcolo delle date di ogni fiera ---------- */

const periodoFiera = new Map();
for (const [, , , , , inizio, fine, fieraId] of noleggiAirtable) {
  if (!inizio || !fine) continue;
  const attuale = periodoFiera.get(fieraId);
  periodoFiera.set(fieraId, attuale
    ? [inizio < attuale[0] ? inizio : attuale[0], fine > attuale[1] ? fine : attuale[1]]
    : [inizio, fine]);
}

const daConfermare = [];
for (const [idAirtable] of fiereAirtable) {
  if (periodoFiera.has(idAirtable)) continue;
  if (DATE_STIMATE[idAirtable]) {
    periodoFiera.set(idAirtable, DATE_STIMATE[idAirtable]);
    daConfermare.push(idAirtable);
  }
}

/* ---------- importazione ---------- */

const esistente = (tabella, idAirtable) =>
  db.prepare(`SELECT id FROM ${tabella} WHERE note LIKE ?`).get(`%${marca(idAirtable)}%`)?.id;

const conteggi = { prodotti: 0, fiere: 0, noleggi: 0, saltati: 0, senzaFiera: 0 };
const mappaProdotti = new Map();
const mappaFiere = new Map();

const importa = db.transaction(() => {
  // --- prodotti: una riga per apparecchio fisico, come in Airtable ---
  for (const [idA, numero, nome, marchio, pollici, sede, stato, costo] of prodottiAirtable) {
    const gia = esistente('prodotti', idA);
    if (gia) { mappaProdotti.set(idA, gia); conteggi.saltati += 1; continue; }
    const note = [
      sede && `Sede: ${sede}`,
      costo && `Costo d'acquisto: ${costo} €`,
      marca(idA),
    ].filter(Boolean).join('\n');
    const info = db.prepare(`
      INSERT INTO prodotti (nome, categoria, marca, modello, codice, pollici, risoluzione,
                            quantita, prezzo_giorno, stato, note, creato_il, aggiornato_il)
      VALUES (?, ?, ?, '', ?, ?, '', 1, 0, ?, ?, ?, ?)`)
      .run(nome, categoria(nome, pollici), marchio || '', `INV-${numero}`, pollici,
        STATO_PRODOTTO[stato] || 'attivo', note, adesso, adesso);
    mappaProdotti.set(idA, info.lastInsertRowid);
    conteggi.prodotti += 1;
  }

  // --- fiere ---
  for (const [idA, nome] of fiereAirtable) {
    const gia = esistente('fiere', idA);
    if (gia) { mappaFiere.set(idA, gia); conteggi.saltati += 1; continue; }
    const periodo = periodoFiera.get(idA);
    if (!periodo) { conteggi.senzaFiera += 1; continue; } // nessun noleggio collegato
    const stimata = daConfermare.includes(idA);
    const note = [
      stimata && '⚠️ DATE STIMATE: in Airtable non erano indicate. Da correggere.',
      marca(idA),
    ].filter(Boolean).join('\n');
    // Senza allestimento/smontaggio: le date importate sono già quelle reali
    // di uscita e rientro del materiale.
    const { manifestazione, anno } = scomponiNome(nome);
    const info = db.prepare(`
      INSERT INTO fiere (nome, manifestazione, anno, cliente, luogo, citta, padiglione, stand,
                         data_inizio, data_fine, giorni_allestimento, giorni_smontaggio,
                         stato, note, creato_il, aggiornato_il)
      VALUES (?, ?, ?, '', '', '', '', '', ?, ?, 0, 0, ?, ?, ?, ?)`)
      .run(nome, manifestazione, anno ?? Number(periodo[0].slice(0, 4)), periodo[0], periodo[1],
        periodo[1] < GIORNO ? 'conclusa' : 'pianificata', note, adesso, adesso);
    mappaFiere.set(idA, info.lastInsertRowid);
    conteggi.fiere += 1;
  }

  // --- noleggi ---
  for (const [idA, cliente, stand, prodotti, costo, inizio, fine, fieraId, task] of noleggiAirtable) {
    if (esistente('noleggi', idA)) { conteggi.saltati += 1; continue; }
    if (!prodotti.length) { conteggi.senzaFiera += 1; continue; } // riga senza materiale
    const fieraLocale = mappaFiere.get(fieraId);
    if (!fieraLocale) { conteggi.senzaFiera += 1; continue; }

    const periodo = periodoFiera.get(fieraId);
    const da = inizio || periodo[0];
    const a = fine || periodo[1];

    // Uno storico non deve occupare il magazzino: quanto è già rientrato viene
    // registrato come tale, così non falsa il calcolo delle disponibilità.
    const stato = task === 'Da Installare' ? 'prenotato' : a < GIORNO ? 'rientrato' : 'consegnato';

    // Il costo Airtable è del lavoro intero: se copre più apparecchi si divide.
    const quota = Math.round((costo / prodotti.length) * 100) / 100;

    for (const prodottoA of prodotti) {
      const prodottoLocale = mappaProdotti.get(prodottoA);
      if (!prodottoLocale) continue;
      const note = [
        !inizio && 'Date ereditate dalla fiera: in Airtable la richiesta non le riportava.',
        marca(idA),
      ].filter(Boolean).join('\n');
      db.prepare(`
        INSERT INTO noleggi (prodotto_id, fiera_id, cliente, stand, quantita, data_inizio,
                             data_fine, stato, importo, note, creato_il, aggiornato_il)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`)
        .run(prodottoLocale, fieraLocale, cliente || '', stand || '', da, a, stato, quota,
          note, adesso, adesso);
      conteggi.noleggi += 1;
    }
  }

  if (!SCRIVI) throw new Error('PROVA');
});

try {
  importa();
  console.log('Importazione completata.');
} catch (errore) {
  if (errore.message !== 'PROVA') throw errore;
  console.log('PROVA: nessuna modifica scritta. Rilancia con --scrivi per confermare.');
}

console.log(`
  prodotti creati : ${conteggi.prodotti}
  fiere create    : ${conteggi.fiere}
  noleggi creati  : ${conteggi.noleggi}
  già presenti    : ${conteggi.saltati}
  righe ignorate  : ${conteggi.senzaFiera}`);

const manifestazioni = db.prepare(`
  SELECT manifestazione, COUNT(*) AS edizioni, GROUP_CONCAT(anno, ', ') AS anni
    FROM fiere GROUP BY manifestazione HAVING COUNT(*) > 1`).all();
if (manifestazioni.length) {
  console.log('\n  Manifestazioni con più edizioni riconosciute:');
  for (const m of manifestazioni) {
    console.log(`      ${m.manifestazione} → ${m.anni}`);
  }
}

if (daConfermare.length) {
  const nomi = daConfermare.map((id) => fiereAirtable.find((f) => f[0] === id)[1]);
  console.log(`
  ⚠️  Queste fiere non avevano date in Airtable e hanno ricevuto una stima.
      Correggile dall'app (Fiere → Modifica):
      ${nomi.join(', ')}`);
}
