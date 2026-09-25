// Recupero accesso: reimposta la password di un utente dalla riga di comando.
//
//   npm run reimposta-password -- admin nuovaPassword
//   docker compose exec app node src/reimposta-password.js admin nuovaPassword
//
// L'utente viene anche riattivato e le sue sessioni aperte si chiudono. Se il
// nome non esiste, si crea come amministratore: serve quando nessuno riesce
// più a entrare.

import db from './lib/db.js';
import { hashPassword, revocaSessioni } from './lib/auth.js';

const [accesso, password] = process.argv.slice(2);
if (!accesso || !password || password.length < 4) {
  console.error('Uso: node src/reimposta-password.js <nome utente> <nuova password (almeno 4 caratteri)>');
  process.exit(1);
}

const adesso = new Date().toISOString();
const utente = db.prepare('SELECT * FROM utenti WHERE accesso = ?').get(accesso.toLowerCase());
if (utente) {
  db.prepare('UPDATE utenti SET password_hash = ?, attivo = 1, aggiornato_il = ? WHERE id = ?')
    .run(hashPassword(password), adesso, utente.id);
  revocaSessioni(utente.id);
  console.log(`Password di "${utente.accesso}" (${utente.ruolo}) reimpostata; utente attivo.`);
} else {
  db.prepare(`
    INSERT INTO utenti (nome, accesso, password_hash, ruolo, creato_il, aggiornato_il)
    VALUES (?, ?, ?, 'amministratore', ?, ?)`)
    .run(accesso, accesso.toLowerCase(), hashPassword(password), adesso, adesso);
  console.log(`Creato l'amministratore "${accesso.toLowerCase()}".`);
}
