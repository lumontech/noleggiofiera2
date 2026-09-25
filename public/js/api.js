// Client HTTP verso le API. Centralizza gestione errori e sessione scaduta.

let alLogout = () => {};
export const impostaGestoreLogout = (fn) => { alLogout = fn; };

async function richiesta(metodo, url, corpo) {
  const risposta = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

  if (risposta.status === 401 && !url.endsWith('/api/accesso')) {
    alLogout();
    throw new Error('Sessione scaduta: effettua di nuovo l\'accesso.');
  }

  const testo = await risposta.text();
  const dati = testo ? JSON.parse(testo) : null;
  if (!risposta.ok) throw new Error(dati?.errore || `Errore ${risposta.status}`);
  return dati;
}

const qs = (parametri) => {
  const p = new URLSearchParams(
    Object.entries(parametri || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined),
  );
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  sessione: () => richiesta('GET', '/api/sessione'),
  accesso: (password) => richiesta('POST', '/api/accesso', { password }),
  uscita: () => richiesta('POST', '/api/uscita'),

  costanti: () => richiesta('GET', '/api/disponibilita/costanti'),
  dashboard: () => richiesta('GET', '/api/disponibilita/dashboard'),
  disponibilita: (p) => richiesta('GET', `/api/disponibilita${qs(p)}`),
  timeline: (p) => richiesta('GET', `/api/disponibilita/timeline${qs(p)}`),

  prodotti: (p) => richiesta('GET', `/api/prodotti${qs(p)}`),
  prodotto: (id) => richiesta('GET', `/api/prodotti/${id}`),
  creaProdotto: (d) => richiesta('POST', '/api/prodotti', d),
  modificaProdotto: (id, d) => richiesta('PUT', `/api/prodotti/${id}`, d),
  eliminaProdotto: (id) => richiesta('DELETE', `/api/prodotti/${id}`),

  fiere: (p) => richiesta('GET', `/api/fiere${qs(p)}`),
  fiera: (id) => richiesta('GET', `/api/fiere/${id}`),
  finestraFiera: (id) => richiesta('GET', `/api/fiere/${id}/finestra`),
  creaFiera: (d) => richiesta('POST', '/api/fiere', d),
  modificaFiera: (id, d) => richiesta('PUT', `/api/fiere/${id}`, d),
  eliminaFiera: (id) => richiesta('DELETE', `/api/fiere/${id}`),

  noleggi: (p) => richiesta('GET', `/api/noleggi${qs(p)}`),
  creaNoleggio: (d) => richiesta('POST', '/api/noleggi', d),
  modificaNoleggio: (id, d) => richiesta('PUT', `/api/noleggi/${id}`, d),
  statoNoleggio: (id, stato) => richiesta('PATCH', `/api/noleggi/${id}/stato`, { stato }),
  eliminaNoleggio: (id) => richiesta('DELETE', `/api/noleggi/${id}`),
};
