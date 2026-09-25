// Autenticazione minimale a password condivisa: l'app è pensata per un piccolo
// team interno, ma finisce online, quindi non deve restare aperta a chiunque.

import crypto from 'node:crypto';
import { HttpError } from './domain.js';

const PASSWORD = process.env.APP_PASSWORD || 'noleggio2026';
const SEGRETO = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE = 'nf_sessione';
const DURATA_MS = 1000 * 60 * 60 * 24 * 30; // 30 giorni

function firma(valore) {
  return crypto.createHmac('sha256', SEGRETO).update(valore).digest('hex');
}

function creaToken() {
  const scadenza = Date.now() + DURATA_MS;
  return `${scadenza}.${firma(String(scadenza))}`;
}

function tokenValido(token) {
  if (typeof token !== 'string') return false;
  const [scadenza, hash] = token.split('.');
  if (!scadenza || !hash) return false;
  if (Number(scadenza) < Date.now()) return false;
  const atteso = firma(scadenza);
  const a = Buffer.from(hash, 'utf8');
  const b = Buffer.from(atteso, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function passwordCorretta(inviata) {
  const a = Buffer.from(crypto.createHash('sha256').update(String(inviata ?? '')).digest());
  const b = Buffer.from(crypto.createHash('sha256').update(PASSWORD).digest());
  return crypto.timingSafeEqual(a, b);
}

export function accedi(req, res) {
  if (!passwordCorretta(req.body?.password)) {
    throw new HttpError(401, 'Password non corretta.');
  }
  res.cookie(COOKIE, creaToken(), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: DURATA_MS,
    secure: req.protocol === 'https' || req.get('x-forwarded-proto') === 'https',
  });
  return { ok: true };
}

export function esci(_req, res) {
  res.clearCookie(COOKIE);
  return { ok: true };
}

export function autenticato(req) {
  return tokenValido(req.cookies?.[COOKIE]);
}

export function richiediAutenticazione(req, _res, next) {
  if (!autenticato(req)) return next(new HttpError(401, 'Sessione scaduta: effettua di nuovo l\'accesso.'));
  return next();
}
