// Schede tecniche dei modelli presenti in magazzino (dati/schede-tecniche.json).
//
// A ogni avvio si completano i prodotti che corrispondono a un modello, per EAN
// o per un pezzo del nome ("65U8072"). Si riempiono solo i campi vuoti: quello
// che si scrive a mano nell'app non viene mai sovrascritto.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dati', 'schede-tecniche.json');

const CAMPI = ['ean', 'modello', 'risoluzione', 'larghezza_mm', 'altezza_mm', 'profondita_mm',
  'altezza_base_mm', 'peso_kg', 'vesa', 'scheda_url'];

const vuoto = (v) => v === null || v === undefined || v === '';

export function applicaSchede() {
  if (!fs.existsSync(FILE)) return 0;
  let schede;
  try {
    schede = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.error(`Schede tecniche non leggibili: ${err.message}`);
    return 0;
  }
  const prodotti = db.prepare('SELECT * FROM prodotti').all();
  let aggiornati = 0;
  const salva = db.transaction(() => {
    for (const p of prodotti) {
      const nome = p.nome.toUpperCase();
      const scheda = schede.find((s) => (s.ean && (p.ean === s.ean || nome.includes(s.ean)))
        || (s.nel_nome || []).some((pezzo) => nome.includes(pezzo.toUpperCase())));
      if (!scheda) continue;
      const nuovi = CAMPI.filter((c) => vuoto(p[c]) && !vuoto(scheda[c]));
      if (!nuovi.length) continue;
      db.prepare(`UPDATE prodotti SET ${nuovi.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`)
        .run({ ...Object.fromEntries(nuovi.map((c) => [c, scheda[c]])), id: p.id });
      aggiornati += 1;
    }
  });
  salva();
  if (aggiornati) console.log(`Schede tecniche: completati ${aggiornati} prodotti.`);
  return aggiornati;
}
