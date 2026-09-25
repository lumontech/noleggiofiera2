// Archivio dei file allegati alle fiere (planimetrie).
//
// I file stanno nella stessa cartella del database, quindi nel volume Docker:
// sopravvivono ai riavvii e si salvano insieme ai dati. Su disco prendono un
// nome casuale, mai quello scelto dall'utente, così un nome malevolo non può
// finire fuori dalla cartella.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.js';
import { HttpError } from './domain.js';

export const DIMENSIONE_MASSIMA = 30 * 1024 * 1024; // 30 MB: basta per un PDF di planimetria
const CARTELLA = path.join(DATA_DIR, 'allegati');

/**
 * Il tipo si riconosce dai primi byte del file, non dall'estensione né da
 * quanto dichiara il browser: un eseguibile rinominato in .pdf viene
 * rifiutato.
 */
function riconosci(buffer) {
  const testo = (inizio, fine) => buffer.subarray(inizio, fine).toString('latin1');
  if (testo(0, 4) === '%PDF') return { estensione: 'pdf', mime: 'application/pdf' };
  if (buffer[0] === 0x89 && testo(1, 4) === 'PNG') return { estensione: 'png', mime: 'image/png' };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { estensione: 'jpg', mime: 'image/jpeg' };
  if (testo(0, 4) === 'RIFF' && testo(8, 12) === 'WEBP') return { estensione: 'webp', mime: 'image/webp' };
  return null;
}

/** Tiene del nome solo la parte leggibile, senza percorsi. */
export function nomePulito(grezzo) {
  const nome = path.basename(String(grezzo || '')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (nome || 'planimetria').slice(0, 160);
}

function cartellaFiera(fieraId) {
  return path.join(CARTELLA, String(Number(fieraId)));
}

export function salva({ fieraId, buffer, nomeOriginale }) {
  if (!buffer?.length) throw new HttpError(400, 'Il file è vuoto.');
  if (buffer.length > DIMENSIONE_MASSIMA) {
    throw new HttpError(413, 'File troppo grande: il massimo è 30 MB.');
  }
  const tipo = riconosci(buffer);
  if (!tipo) {
    throw new HttpError(415, 'Formato non supportato: allega un PDF o un\'immagine (PNG, JPG, WEBP).');
  }
  const cartella = cartellaFiera(fieraId);
  fs.mkdirSync(cartella, { recursive: true });
  const nomeFile = `${crypto.randomUUID()}.${tipo.estensione}`;
  fs.writeFileSync(path.join(cartella, nomeFile), buffer);
  return { nomeFile, mime: tipo.mime, dimensione: buffer.length, nomeOriginale: nomePulito(nomeOriginale) };
}

export function percorso(fieraId, nomeFile) {
  // nomeFile viene dal database, ma lo si ricontrolla comunque.
  if (!/^[0-9a-f-]{36}\.(pdf|png|jpg|webp)$/.test(nomeFile)) {
    throw new HttpError(404, 'Allegato non trovato.');
  }
  return path.join(cartellaFiera(fieraId), nomeFile);
}

export function elimina(fieraId, nomeFile) {
  fs.rmSync(percorso(fieraId, nomeFile), { force: true });
}

export function eliminaTuttiDellaFiera(fieraId) {
  fs.rmSync(cartellaFiera(fieraId), { recursive: true, force: true });
}

/** Invia al browser il file di un allegato, col tipo stabilito da noi e non dal client. */
export function invia(res, fieraId, allegato) {
  const file = percorso(fieraId, allegato.nome_file);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Il file non è più presente sul server.');
  res.setHeader('Content-Type', allegato.tipo);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(allegato.nome_originale)}`);
  fs.createReadStream(file).pipe(res);
}
