// L'intestazione dei documenti scaricabili (PDF del materiale): dati
// dell'azienda e logo. Si modifica dall'app; questi sono i valori di partenza,
// presi dal sito lumontec.it.

import fs from 'node:fs';
import path from 'node:path';
import db, { DATA_DIR } from './db.js';
import { HttpError, testo } from './domain.js';

const PREDEFINITA = {
  ragione_sociale: 'Lumon Tec',
  sottotitolo: 'Noleggio ledwall, videowall, monitor e TV per fiere ed eventi',
  indirizzo: 'Via Silone 1, 80020 Napoli',
  piva: 'IT10433031217',
  telefono: '',
  email: '',
  sito: 'lumontec.it',
};

const CARTELLA = path.join(DATA_DIR, 'intestazione');
const LOGO = { png: 'logo.png', jpg: 'logo.jpg' };
const DIMENSIONE_MASSIMA_LOGO = 2 * 1024 * 1024;

export function leggiIntestazione() {
  const riga = db.prepare("SELECT valore FROM impostazioni WHERE chiave = 'intestazione'").get();
  let salvata = {};
  try { salvata = riga ? JSON.parse(riga.valore) : {}; } catch { salvata = {}; }
  return { ...PREDEFINITA, ...salvata, logo: Boolean(percorsoLogo()) };
}

export function salvaIntestazione(body = {}) {
  const dati = {};
  for (const [campo, max] of Object.entries({
    ragione_sociale: 120, sottotitolo: 160, indirizzo: 200, piva: 40, telefono: 60, email: 120, sito: 120,
  })) {
    dati[campo] = testo(body[campo], campo, { max });
  }
  if (!dati.ragione_sociale) throw new HttpError(400, 'La ragione sociale è obbligatoria.');
  db.prepare(`
    INSERT INTO impostazioni (chiave, valore, aggiornato_il) VALUES ('intestazione', ?, ?)
    ON CONFLICT (chiave) DO UPDATE SET valore = excluded.valore, aggiornato_il = excluded.aggiornato_il`)
    .run(JSON.stringify(dati), new Date().toISOString());
  return leggiIntestazione();
}

/** Il file del logo, se caricato. */
export function percorsoLogo() {
  for (const nome of Object.values(LOGO)) {
    const file = path.join(CARTELLA, nome);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/** Salva il logo: solo PNG o JPG (riconosciuti dal contenuto), fino a 2 MB. */
export function salvaLogo(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new HttpError(400, 'Nessun file ricevuto.');
  if (buffer.length > DIMENSIONE_MASSIMA_LOGO) throw new HttpError(413, 'Il logo è troppo grande: massimo 2 MB.');
  const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!png && !jpg) throw new HttpError(400, 'Il logo deve essere un\'immagine PNG o JPG.');
  eliminaLogo();
  fs.mkdirSync(CARTELLA, { recursive: true });
  fs.writeFileSync(path.join(CARTELLA, png ? LOGO.png : LOGO.jpg), buffer);
}

export function eliminaLogo() {
  for (const nome of Object.values(LOGO)) fs.rmSync(path.join(CARTELLA, nome), { force: true });
}
