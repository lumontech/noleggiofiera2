import { Router } from 'express';
import db from '../lib/db.js';
import {
  CATEGORIE, STATI_PRODOTTO, HttpError,
  testo, intero, decimale, enumerato, oggi, addGiorni, isData,
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
  };
}

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
  sql += ` ORDER BY CASE categoria WHEN 'TV' THEN 1 WHEN 'Monitor' THEN 2 WHEN 'Videowall' THEN 3 WHEN 'Totem' THEN 4 WHEN 'Supporto' THEN 5 ELSE 6 END, pollici DESC, nome ASC`;

  const prodotti = db.prepare(sql).all(...parametri);
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
    INSERT INTO prodotti (nome, categoria, marca, modello, codice, pollici, risoluzione,
                          quantita, prezzo_giorno, stato, note, creato_il, aggiornato_il)
    VALUES (@nome, @categoria, @marca, @modello, @codice, @pollici, @risoluzione,
            @quantita, @prezzo_giorno, @stato, @note, @creato_il, @aggiornato_il)`)
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
    UPDATE prodotti SET nome=@nome, categoria=@categoria, marca=@marca, modello=@modello,
                        codice=@codice, pollici=@pollici, risoluzione=@risoluzione,
                        quantita=@quantita, prezzo_giorno=@prezzo_giorno, stato=@stato,
                        note=@note, aggiornato_il=@aggiornato_il
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
