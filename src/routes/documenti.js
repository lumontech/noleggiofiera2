// Documenti scaricabili e la loro intestazione. Solo amministratori.

import express, { Router } from 'express';
import { intero } from '../lib/domain.js';
import { scriviCatalogo } from '../lib/catalogo-pdf.js';
import {
  leggiIntestazione, salvaIntestazione, salvaLogo, eliminaLogo, percorsoLogo,
} from '../lib/intestazione.js';
import { trovaFiera } from './fiere.js';

const router = Router();

/**
 * PDF del materiale da noleggiare.
 *   ?prezzi=1     con i prezzi di listino (altrimenti senza)
 *   ?fiera_id=N   solo quello libero nelle date di quella fiera
 */
router.get('/materiale.pdf', (req, res) => {
  const prezzi = req.query.prezzi === '1' || req.query.prezzi === 'true';
  const fiera = req.query.fiera_id ? trovaFiera(intero(req.query.fiera_id, 'fiera', { min: 1 })) : null;
  const nome = ['Materiale a noleggio', fiera?.nome, prezzi ? 'con prezzi' : 'senza prezzi'].filter(Boolean).join(' - ');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${nome}.pdf`)}`);
  res.setHeader('Cache-Control', 'no-store');
  scriviCatalogo(res, { prezzi, fiera });
});

router.get('/intestazione', (_req, res) => res.json(leggiIntestazione()));
router.put('/intestazione', (req, res) => res.json(salvaIntestazione(req.body)));

router.get('/intestazione/logo', (_req, res) => {
  const file = percorsoLogo();
  if (!file) return res.status(404).json({ errore: 'Nessun logo caricato.' });
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(file);
});
router.post('/intestazione/logo', express.raw({ type: () => true, limit: '3mb' }), (req, res) => {
  salvaLogo(req.body);
  res.json(leggiIntestazione());
});
router.delete('/intestazione/logo', (_req, res) => {
  eliminaLogo();
  res.json(leggiIntestazione());
});

export default router;
