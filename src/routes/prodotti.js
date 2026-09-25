import { Router } from 'express';
import db from '../lib/db.js';
import {
  CATEGORIE, STATI_PRODOTTO, HttpError,
  testo, intero, decimale, enumerato, oggi, addGiorni, isData,
  ORDINE_PER_ID,
} from '../lib/domain.js';
import { impegnoMassimo } from '../lib/disponibilita.js';

const router = Router();

function leggiCorpo(body) {
  return {
    nome: testo(body.nome, 'nome', { obbligatorio: true, max: 120 }),
    categoria: enumerato(body.categoria, 'categoria', CATEGORIE, 'TV'),
    marca: testo(body.marca, 'marca', { max: 80 }),
    modello: testo(body.modello, 'modello', { max: 80 }),
    codice: testo(body.codice, 'codice', { max: 80 }),
    pollici: body.pollici === '' || body.pollici == null
      ? null
      : decimale(body.pollici, 'pollici', { min: 1, max: 400 }),
    risoluzione: testo(body.risoluzione, 'risoluzione', { max: 40 }),
    quantita: intero(body.quantita, 'quantita', { min: 1, max: 9999, predefinito: 1 }),
    prezzo_giorno: decimale(body.prezzo_giorno, 'prezzo_giorno', { min: 0, predefinito: 0 }),
    stato: enumerato(body.stato, 'stato', STATI_PRODOTTO, 'attivo'),
    note: testo(body.note, 'note', { max: 2000 }),
    costo_acquisto: decimale(body.costo_acquisto, 'costo d\'acquisto', { min: 0, predefinito: 0 }),
    ean: testo(body.ean, 'EAN', { max: 20 }).replace(/\s+/g, ''),
    larghezza_mm: misura(body.larghezza_mm, 'larghezza'),
    altezza_mm: misura(body.altezza_mm, 'altezza'),
    profondita_mm: misura(body.profondita_mm, 'profondità'),
    altezza_base_mm: misura(body.altezza_base_mm, 'altezza con base'),
    peso_kg: decimale(body.peso_kg, 'peso', { min: 0, max: 1000, predefinito: null }),
    vesa: testo(body.vesa, 'VESA', { max: 30 }),
    scheda_url: testo(body.scheda_url, 'link scheda tecnica', { max: 500 }),
  };
}

// Misure in millimetri, facoltative.
const misura = (v, campo) => decimale(v, campo, { min: 0, max: 20000, predefinito: null });

const CAMPI = ['nome', 'categoria', 'marca', 'modello', 'codice', 'pollici', 'risoluzione', 'quantita',
  'prezzo_giorno', 'stato', 'note', 'costo_acquisto', 'ean', 'larghezza_mm', 'altezza_mm',
  'profondita_mm', 'altezza_base_mm', 'peso_kg', 'vesa', 'scheda_url'];

export function trovaProdotto(id) {
  const prodotto = db.prepare('SELECT * FROM prodotti WHERE id = ?').get(id);
  if (!prodotto) throw new HttpError(404, 'Prodotto non trovato.');
  return prodotto;
}

router.get('/', (req, res) => {
  const { categoria, stato, q } = req.query;
  const condizioni = [];
  const parametri = [];
  if (categoria) { condizioni.push('categoria = ?'); parametri.push(categoria); }
  if (stato) { condizioni.push('stato = ?'); parametri.push(stato); }
  if (q) {
    condizioni.push('(nome LIKE ? OR marca LIKE ? OR modello LIKE ? OR codice LIKE ?)');
    const like = `%${q}%`;
    parametri.push(like, like, like, like);
  }
  let sql = 'SELECT * FROM prodotti';
  if (condizioni.length) sql += ` WHERE ${condizioni.join(' AND ')}`;
  sql += ` ORDER BY ${ORDINE_PER_ID}`;

  const prodotti = db.prepare(sql).all(...parametri);
  // Quanto ha reso ogni apparecchio: la somma degli importi dei suoi noleggi.
  const resa = new Map(db.prepare(`
    SELECT prodotto_id, COALESCE(SUM(importo), 0) AS ricavi, COUNT(*) AS noleggi
      FROM noleggi WHERE stato != 'annullato' GROUP BY prodotto_id`).all()
    .map((r) => [r.prodotto_id, r]));
  const giorno = isData(req.query.giorno) ? req.query.giorno : oggi();

  // Arricchisce ogni prodotto con la situazione "adesso" e nei prossimi 30 giorni.
  const arricchiti = prodotti.map((prodotto) => {
    const oggiImpegno = impegnoMassimo({ prodottoId: prodotto.id, from: giorno, to: giorno });
    const futuro = impegnoMassimo({
      prodottoId: prodotto.id, from: giorno, to: addGiorni(giorno, 30),
    });
    return {
      ...prodotto,
      impegnati_oggi: oggiImpegno.picco,
      disponibili_oggi: prodotto.stato === 'manutenzione'
        ? 0
        : Math.max(prodotto.quantita - oggiImpegno.picco, 0),
      impegno_max_30gg: futuro.picco,
      noleggi_attivi: oggiImpegno.righe.length,
      ricavi: Math.round((resa.get(prodotto.id)?.ricavi || 0) * 100) / 100,
      noleggi_totali: resa.get(prodotto.id)?.noleggi || 0,
    };
  });
  res.json(arricchiti);
});

router.get('/:id', (req, res) => {
  const prodotto = trovaProdotto(req.params.id);
  const storico = db.prepare(`
    SELECT n.*, f.nome AS fiera_nome, f.citta AS fiera_citta
      FROM noleggi n JOIN fiere f ON f.id = n.fiera_id
     WHERE n.prodotto_id = ?
     ORDER BY n.data_inizio ASC`).all(prodotto.id);
  res.json({ ...prodotto, noleggi: storico });
});

router.post('/', (req, res) => {
  const dati = leggiCorpo(req.body);
  const adesso = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO prodotti (${CAMPI.join(', ')}, creato_il, aggiornato_il)
    VALUES (${CAMPI.map((c) => `@${c}`).join(', ')}, @creato_il, @aggiornato_il)`)
    .run({ ...dati, creato_il: adesso, aggiornato_il: adesso });
  res.status(201).json(trovaProdotto(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const prodotto = trovaProdotto(req.params.id);
  const dati = leggiCorpo(req.body);

  // Ridurre lo stock sotto ai pezzi già impegnati creerebbe un sovra-impegno.
  const { picco, giornoPicco } = impegnoMassimo({
    prodottoId: prodotto.id, from: oggi(), to: addGiorni(oggi(), 730),
  });
  if (dati.quantita < picco) {
    throw new HttpError(409,
      `Non puoi scendere a ${dati.quantita} pezzi: il ${giornoPicco} ne risultano già impegnati ${picco}.`);
  }

  db.prepare(`
    UPDATE prodotti SET ${CAMPI.map((c) => `${c}=@${c}`).join(', ')}, aggiornato_il=@aggiornato_il
     WHERE id=@id`)
    .run({ ...dati, id: prodotto.id, aggiornato_il: new Date().toISOString() });
  res.json(trovaProdotto(prodotto.id));
});

router.delete('/:id', (req, res) => {
  const prodotto = trovaProdotto(req.params.id);
  const collegati = db.prepare(
    "SELECT COUNT(*) AS n FROM noleggi WHERE prodotto_id = ? AND stato IN ('prenotato','consegnato')",
  ).get(prodotto.id).n;
  if (collegati > 0) {
    throw new HttpError(409,
      `Il prodotto ha ${collegati} noleggi attivi: annullali o segnali come rientrati prima di eliminarlo.`);
  }
  db.prepare('DELETE FROM prodotti WHERE id = ?').run(prodotto.id);
  res.json({ ok: true });
});

export default router;
