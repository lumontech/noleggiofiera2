import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';

import './lib/db.js';
import { HttpError } from './lib/domain.js';
import { accedi, esci, autenticato, richiediAutenticazione } from './lib/auth.js';
import prodotti from './routes/prodotti.js';
import fiere from './routes/fiere.js';
import noleggi from './routes/noleggi.js';
import disponibilita from './routes/disponibilita.js';

const RADICE = path.dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT || 3000);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// Express 4 non propaga i rifiuti delle async handler: wrapper esplicito.
const asincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/salute', (_req, res) => res.json({ ok: true, versione: '1.0.0' }));

app.post('/api/accesso', asincrono((req, res) => res.json(accedi(req, res))));
app.post('/api/uscita', asincrono((req, res) => res.json(esci(req, res))));
app.get('/api/sessione', (req, res) => res.json({ autenticato: autenticato(req) }));

app.use('/api', richiediAutenticazione);
app.use('/api/prodotti', prodotti);
app.use('/api/fiere', fiere);
app.use('/api/noleggi', noleggi);
app.use('/api/disponibilita', disponibilita);

// Qualunque metodo su un percorso /api sconosciuto deve rispondere in JSON,
// non con la pagina d'errore HTML di Express.
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint non trovato.')));

app.use(express.static(path.join(RADICE, '..', 'public'), { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(path.join(RADICE, '..', 'public', 'index.html')));

// eslint-disable-next-line no-unused-vars -- Express riconosce il gestore errori da 4 argomenti.
app.use((errore, _req, res, _next) => {
  const status = errore.status || 500;
  if (status >= 500) console.error(errore);
  res.status(status).json({
    errore: status >= 500 ? 'Errore interno del server.' : errore.message,
    dettagli: errore.details,
  });
});

app.listen(PORTA, '0.0.0.0', () => {
  console.log(`NoleggioFiera in ascolto su http://0.0.0.0:${PORTA}`);
});
