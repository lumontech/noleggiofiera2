// "Prodotti" per l'organizzatore di fiera: tutto il nostro parco con l'ID e le
// misure, da girare agli allestitori. Nessun EAN, costo o prezzo: i dati
// arrivano da /api/organizzatore/prodotti, che non li contiene.

import { api } from '../api.js';
import { h, monta, vuoto, numero, input, select, intervalloDate } from '../ui.js';

const cm = (mm) => (mm ? `${String(Math.round(mm) / 10).replace('.', ',')} cm` : '');
const idDi = (p) => (/^\d+$/.test(p.id || '') ? `ID ${p.id}` : p.id || '—');

function riga(p, conFiera) {
  const dimensioni = p.larghezza_mm && p.altezza_mm
    ? `${cm(p.larghezza_mm).replace(' cm', '')} × ${cm(p.altezza_mm)}` : '';
  const cella = (etichetta, valore, classe = '') => h('td', { 'data-etichetta': etichetta, class: classe },
    valore || h('span', { class: 'cat-org__vuoto' }, '—'));
  return h('tr', { class: conFiera && !p.libero ? 'cat-org__riga--occupata' : '' },
    h('td', { class: 'cat-org__id' }, idDi(p)),
    h('td', { class: 'cat-org__nome' },
      h('strong', {}, p.nome),
      h('div', { class: 'sottotesto' }, [p.categoria, p.risoluzione].filter(Boolean).join(' · '))),
    cella('Pollici', p.pollici ? `${p.pollici}"` : ''),
    cella('Larghezza × altezza', dimensioni),
    cella('Profondità', cm(p.profondita_mm)),
    cella('Altezza con base', cm(p.altezza_base_mm)),
    cella('Peso', p.peso_kg ? `${String(p.peso_kg).replace('.', ',')} kg` : ''),
    cella('VESA', p.vesa),
    conFiera ? h('td', { 'data-etichetta': 'In fiera' },
      h('span', { class: `cat-org__stato cat-org__stato--${p.libero ? 'libero' : 'occupato'}` },
        p.libero ? 'Libero' : 'Già impegnato')) : null);
}

export default async function vistaCatalogoOrganizzatore({ corpo }) {
  const { fiere } = await api.fiereOrganizzatore();
  const filtri = { q: '', categoria: '', fiera: fiere[0] ? String(fiere[0].id) : '' };
  let prodotti = [];
  const contenitore = h('div', {});

  const disegna = () => {
    const q = filtri.q.toLowerCase();
    const elenco = prodotti.filter((p) => (!filtri.categoria || p.categoria === filtri.categoria)
      && (!q || [idDi(p), p.id, p.nome, p.categoria, p.marca, p.pollici && `${p.pollici}`]
        .filter(Boolean).join(' ').toLowerCase().includes(q)));
    const conFiera = Boolean(filtri.fiera);
    const liberi = elenco.filter((p) => p.libero).length;
    monta(contenitore,
      h('p', { class: 'riepilogo-filtro' }, `${numero(elenco.length)} prodotti`
        + (conFiera ? ` · ${numero(liberi)} liberi nelle date della fiera` : '')),
      elenco.length
        ? h('div', { class: 'pannello pannello--tabella' },
          h('table', { class: 'tabella cat-org' },
            h('thead', {}, h('tr', {},
              ['ID', 'Prodotto', 'Pollici', 'Larghezza × altezza', 'Profondità', 'Altezza con base', 'Peso', 'VESA',
                ...(conFiera ? ['In fiera'] : [])].map((t) => h('th', {}, t)))),
            h('tbody', {}, elenco.map((p) => riga(p, conFiera)))))
        : vuoto('Nessun prodotto trovato', 'Cambia la ricerca o la categoria.'));
  };

  const carica = async () => {
    prodotti = await api.prodottiOrganizzatore(filtri.fiera);
    disegna();
  };

  const cerca = input('q', { placeholder: 'Cerca per ID, nome o pollici…', type: 'search' });
  cerca.addEventListener('input', () => { filtri.q = cerca.value.trim(); disegna(); });
  const selFiera = select('fiera', [
    { valore: '', testo: 'Senza fiera: solo l\'elenco' },
    ...fiere.map((f) => ({ valore: f.id, testo: `Liberi per ${f.nome} (${intervalloDate(f.data_inizio, f.data_fine)})` })),
  ], filtri.fiera);
  selFiera.addEventListener('change', () => { filtri.fiera = selFiera.value; carica(); });

  prodotti = await api.prodottiOrganizzatore(filtri.fiera);
  const categorie = [...new Set(prodotti.map((p) => p.categoria).filter(Boolean))];
  const selCategoria = select('categoria',
    [{ valore: '', testo: 'Tutte le categorie' }, ...categorie.map((c) => ({ valore: c, testo: c }))], '');
  selCategoria.addEventListener('change', () => { filtri.categoria = selCategoria.value; disegna(); });

  monta(corpo, h('div', { class: 'filtri' }, cerca, selCategoria, selFiera), contenitore);
  disegna();
}
