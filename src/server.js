import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';

import './lib/db.js';
import { applicaSchede } from './lib/schede.js';
import { correggiDateStimate } from './lib/correzioni.js';
import { HttpError } from './lib/domain.js';
import {
  accedi, esci, sessione, richiediAutenticazione, soloAmministratore,
} from './lib/auth.js';
import prodotti from './routes/prodotti.js';
import fiere from './routes/fiere.js';
import noleggi from './routes/noleggi.js';
import disponibilita from './routes/disponibilita.js';
import utenti, { profilo } from './routes/utenti.js';
import tecnico from './routes/tecnico.js';

const RADICE = path.dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT || 3000);

correggiDateStimate();
applicaSchede();

const app = express();
app.disable('x-powered-by');
// X-Forwarded-For si può falsificare: gli si crede solo se arriva da un proxy
// sulla stessa macchina. Altrimenti il limite ai tentativi di accesso si
// aggirerebbe cambiando indirizzo finto a ogni tentativo. Dietro un reverse
// proxy su un'altra macchina, impostare TRUST_PROXY con il suo indirizzo.
const fiduciaProxy = process.env.TRUST_PROXY;
app.set('trust proxy', fiduciaProxy === undefined ? 'loopback' : fiduciaProxy === 'true' ? true : fiduciaProxy);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// Express 4 non propaga i rifiuti delle async handler: wrapper esplicito.
const asincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// La versione è il commit in uso, impostato dall'aggiornamento automatico.
const VERSIONE = process.env.VERSIONE || 'sviluppo';
app.get('/api/salute', (_req, res) => res.json({ ok: true, versione: VERSIONE }));

app.post('/api/accesso', asincrono((req, res) => res.json(accedi(req, res))));
app.post('/api/uscita', asincrono((req, res) => res.json(esci(req, res))));
app.get('/api/sessione', (req, res) => res.json(sessione(req)));

app.use('/api', richiediAutenticazione);

// Aperto a ogni ruolo: il canale del tecnico (senza prezzi) e la propria password.
app.use('/api/tecnico', tecnico);
app.use('/api/profilo', profilo);

// Da qui in poi solo amministratori: prezzi, magazzino, fiere, utenti.
app.use('/api', soloAmministratore);
app.use('/api/utenti', utenti);
app.use('/api/prodotti', prodotti);
app.use('/api/fiere', fiere);
app.use('/api/noleggi', noleggi);
app.use('/api/disponibilita', disponibilita);

// Qualunque metodo su un percorso /api sconosciuto deve rispondere in JSON,
// non con la pagina d'errore HTML di Express.
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint non trovato.')));

// pdf.js per disegnare le planimetrie nel browser. Servito da qui e non da un
// sito esterno, così l'app non dipende da altri. Express 4 non conosce
// l'estensione .mjs: senza il tipo esplicito il browser rifiuta il modulo.
app.use('/vendor/pdfjs', express.static(
  path.join(RADICE, '..', 'node_modules', 'pdfjs-dist', 'build'),
  {
    maxAge: '30d',
    setHeaders: (res, file) => {
      if (file.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    },
  },
));

app.use(express.static(path.join(RADICE, '..', 'public'), { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(path.join(RADICE, '..', 'public', 'index.html')));

// eslint-disable-next-line no-unused-vars -- Express riconosce il gestore errori da 4 argomenti.
app.use((errore, _req, res, _next) => {
  if (errore.type === 'entity.too.large') {
    return res.status(413).json({ errore: 'File troppo grande: il massimo è 30 MB.' });
  }
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
