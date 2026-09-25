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
  apparecchi: (p) => richiesta('GET', `/api/disponibilita/apparecchi${qs(p)}`),

  prodotti: (p) => richiesta('GET', `/api/prodotti${qs(p)}`),
  prodotto: (id) => richiesta('GET', `/api/prodotti/${id}`),
  creaProdotto: (d) => richiesta('POST', '/api/prodotti', d),
  modificaProdotto: (id, d) => richiesta('PUT', `/api/prodotti/${id}`, d),
  eliminaProdotto: (id) => richiesta('DELETE', `/api/prodotti/${id}`),

  fiere: (p) => richiesta('GET', `/api/fiere${qs(p)}`),
  eliminaAllegato: (fieraId, id) => richiesta('DELETE', `/api/fiere/${fieraId}/allegati/${id}`),
  manifestazioni: () => richiesta('GET', '/api/fiere/raggruppate'),
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

/**
 * Carica un file su una fiera. Usa XMLHttpRequest invece di fetch perché
 * fetch non riporta l'avanzamento dell'invio, e una planimetria di 20 MB dal
 * telefono in fiera richiede di vedere che sta andando.
 */
export function caricaAllegato(fieraId, file, suAvanzamento = () => {}) {
  return new Promise((risolvi, rifiuta) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/fiere/${fieraId}/allegati`);
    xhr.setRequestHeader('X-Nome-File', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) suAvanzamento(e.loaded / e.total); };
    xhr.onload = () => {
      let dati = null;
      try { dati = JSON.parse(xhr.responseText); } catch { dati = null; }
      if (xhr.status === 401) {
        alLogout();
        rifiuta(new Error('Sessione scaduta: effettua di nuovo l\'accesso.'));
      } else if (xhr.status >= 200 && xhr.status < 300) {
        risolvi(dati);
      } else {
        rifiuta(new Error(dati?.errore || `Caricamento non riuscito (errore ${xhr.status}).`));
      }
    };
    xhr.onerror = () => rifiuta(new Error('Connessione interrotta durante il caricamento.'));
    xhr.send(file);
  });
}
