// Costanti di dominio e utility condivise (date, validazione).

export const CATEGORIE = ['TV', 'Monitor', 'Videowall', 'Totem', 'Supporto', 'Accessorio'];
export const STATI_PRODOTTO = ['attivo', 'manutenzione', 'dismesso'];
export const STATI_FIERA = ['pianificata', 'in_corso', 'conclusa', 'annullata'];
export const STATI_NOLEGGIO = ['prenotato', 'consegnato', 'rientrato', 'annullato'];

// Solo questi stati tengono occupata la merce in magazzino.
export const STATI_IMPEGNATIVI = ['prenotato', 'consegnato'];

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const bad = (message, details) => new HttpError(400, message, details);

export function oggi() {
  return new Date().toISOString().slice(0, 10);
}

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

export function isData(valore) {
  if (typeof valore !== 'string' || !RE_DATA.test(valore)) return false;
  const d = new Date(`${valore}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valore;
}

export function data(valore, campo) {
  if (!isData(valore)) throw bad(`Il campo "${campo}" deve essere una data valida (AAAA-MM-GG).`);
  return valore;
}

export function addGiorni(iso, giorni) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + giorni);
  return d.toISOString().slice(0, 10);
}

export function giorniTra(inizio, fine) {
  const a = new Date(`${inizio}T00:00:00Z`).getTime();
  const b = new Date(`${fine}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000) + 1; // estremi inclusi
}

export function siSovrappongono(aInizio, aFine, bInizio, bFine) {
  return aInizio <= bFine && aFine >= bInizio;
}

export function testo(valore, campo, { obbligatorio = false, max = 500 } = {}) {
  const v = (valore ?? '').toString().trim();
  if (obbligatorio && !v) throw bad(`Il campo "${campo}" è obbligatorio.`);
  if (v.length > max) throw bad(`Il campo "${campo}" non può superare ${max} caratteri.`);
  return v;
}

export function intero(valore, campo, { min = 0, max = 100000, predefinito } = {}) {
  if (valore === undefined || valore === null || valore === '') {
    if (predefinito !== undefined) return predefinito;
    throw bad(`Il campo "${campo}" è obbligatorio.`);
  }
  const n = Number(valore);
  if (!Number.isInteger(n)) throw bad(`Il campo "${campo}" deve essere un numero intero.`);
  if (n < min || n > max) throw bad(`Il campo "${campo}" deve essere compreso tra ${min} e ${max}.`);
  return n;
}

export function decimale(valore, campo, { min = 0, max = 1e9, predefinito } = {}) {
  if (valore === undefined || valore === null || valore === '') {
    if (predefinito !== undefined) return predefinito;
    throw bad(`Il campo "${campo}" è obbligatorio.`);
  }
  const n = Number(valore);
  if (!Number.isFinite(n)) throw bad(`Il campo "${campo}" deve essere un numero.`);
  if (n < min || n > max) throw bad(`Il campo "${campo}" deve essere compreso tra ${min} e ${max}.`);
  return n;
}

export function enumerato(valore, campo, ammessi, predefinito) {
  if (valore === undefined || valore === null || valore === '') {
    if (predefinito !== undefined) return predefinito;
    throw bad(`Il campo "${campo}" è obbligatorio.`);
  }
  const v = valore.toString().trim();
  if (!ammessi.includes(v)) {
    throw bad(`Valore non valido per "${campo}". Ammessi: ${ammessi.join(', ')}.`);
  }
  return v;
}

export function periodo(body) {
  const inizio = data(body.data_inizio, 'data_inizio');
  const fine = data(body.data_fine, 'data_fine');
  if (fine < inizio) throw bad('La data di fine non può precedere la data di inizio.');
  return { inizio, fine };
}
