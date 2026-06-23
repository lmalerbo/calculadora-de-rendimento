const EARTH_RADIUS_M = 6371000;
const DEFAULT_CONSIDERAR = ['04_Curvas_Existentes', '05_Base_Largas_Existentes'];

const VARIAVEIS_PADRAO = [
  { id: 'embutido_bom', nome: 'REFORMAR EMBUTIDO BOM', taxaMH: 50 },
  { id: 'embutido_ruim', nome: 'REFORMAR EMBUTIDO RUIM', taxaMH: 35 },
  { id: 'base_larga_bom', nome: 'REFORMAR BASE LARGA BOM', taxaMH: 100 },
  { id: 'base_larga_ruim', nome: 'REFORMAR BASE LARGA RUIM', taxaMH: 80 },
  { id: 'embutido_novo', nome: 'FAZER EMBUTIDO NOVO', taxaMH: null },
  { id: 'base_larga_novo', nome: 'FAZER BASE LARGA NOVO', taxaMH: null },
  { id: 'transf_bl_embutido', nome: 'TRANSFORMAR BASE LARGA EM EMBUTIDO', taxaMH: null },
  { id: 'transf_embutido_bl', nome: 'TRANSFORMAR EMBUTIDO EM BASE LARGA', taxaMH: 300 },
];

function loadVariaveis() {
  try {
    const stored = JSON.parse(localStorage.getItem('variaveisLista') || 'null');
    if (Array.isArray(stored) && stored.length > 0) return stored;
  } catch (err) {
    // ignora e cai no fallback abaixo
  }

  // migra edicoes pontuais salvas pela versao anterior (antes de suportar add/excluir)
  let overrides = {};
  try {
    overrides = JSON.parse(localStorage.getItem('variaveisOverrides') || '{}');
  } catch (err) {
    overrides = {};
  }
  return VARIAVEIS_PADRAO.map((v) => ({ ...v, ...overrides[v.id] }));
}

function saveVariaveis() {
  localStorage.setItem('variaveisLista', JSON.stringify(VARIAVEIS));
}

function novoVariavelId() {
  return `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

let VARIAVEIS = loadVariaveis();

const NIVEL_CUSTOS = { 1: 516.84, 2: 852.79, 3: 1213.48, 4: 1705.58 };
const NIVEL_MAX = 4;
const NIVEL_ROUND_BREAKPOINT = 0.7;

// faixas de h/ha por talhão: nível 1 (0-2,1) · nível 2 (2,2-3,1) · nível 3 (3,2-4,1) · nível 4 (a partir de 4,2)
const NIVEL_FAIXAS = [
  { ateMenosDe: 2.2, nivel: 1 },
  { ateMenosDe: 3.2, nivel: 2 },
  { ateMenosDe: 4.2, nivel: 3 },
  { ateMenosDe: Infinity, nivel: 4 },
];

function lookupNivel(horaHectare) {
  const faixa = NIVEL_FAIXAS.find((f) => horaHectare < f.ateMenosDe) || NIVEL_FAIXAS[NIVEL_FAIXAS.length - 1];
  return { nivel: faixa.nivel, custo: NIVEL_CUSTOS[faixa.nivel] };
}

// usado só para arredondar a média ponderada dos níveis (nível aproximado da fazenda)
function roundNivelPonderado(nivelPonderado) {
  const base = Math.floor(nivelPonderado);
  const frac = nivelPonderado - base;
  let nivel = frac >= NIVEL_ROUND_BREAKPOINT ? base + 1 : base;
  return Math.max(1, Math.min(NIVEL_MAX, nivel));
}

const CUSTO_SEM_NIVEL_HA = 927.67;

const uploadBox = document.getElementById('uploadBox');
const kmlInput = document.getElementById('kmlInput');
const selectFileBtn = document.getElementById('selectFileBtn');
const fileNameEl = document.getElementById('fileName');
const errorMsg = document.getElementById('errorMsg');
const resultsSection = document.getElementById('resultsSection');
const layersBody = document.getElementById('layersBody');
const totalConsideradoEl = document.getElementById('totalConsiderado');
const qtdConsideradaEl = document.getElementById('qtdConsiderada');

const fazendaSelect = document.getElementById('fazendaSelect');
const talhoesSection = document.getElementById('talhoesSection');
const talhoesHint = document.getElementById('talhoesHint');
const talhoesBody = document.getElementById('talhoesBody');
const variavelSection = document.getElementById('variavelSection');
const variavelBody = document.getElementById('variavelBody');
const nivelSection = document.getElementById('nivelSection');
const nivelBody = document.getElementById('nivelBody');
const resumoSection = document.getElementById('resumoSection');
const resumoBody = document.getElementById('resumoBody');
const resumoFoot = document.getElementById('resumoFoot');
const resumoAproximado = document.getElementById('resumoAproximado');
const resumoNivelPonderadoHint = document.getElementById('resumoNivelPonderadoHint');
const resumoNivelAprox = document.getElementById('resumoNivelAprox');
const resumoValorHaAprox = document.getElementById('resumoValorHaAprox');
const resumoCustoTotalAprox = document.getElementById('resumoCustoTotalAprox');
const resumoEconomiaAprox = document.getElementById('resumoEconomiaAprox');

const logoInput = document.getElementById('logoInput');
const logoPreview = document.getElementById('logoPreview');
const companyNameInput = document.getElementById('companyNameInput');
const exportBtn = document.getElementById('exportBtn');
const orcamentoPrint = document.getElementById('orcamentoPrint');

const menuToggleBtn = document.getElementById('menuToggleBtn');
const menuOverlay = document.getElementById('menuOverlay');
const menuDrawer = document.getElementById('menuDrawer');
const menuCloseBtn = document.getElementById('menuCloseBtn');
const variaveisConfigBody = document.getElementById('variaveisConfigBody');

const kmlMap = L.map('kmlMap', { zoomControl: true }).setView([-14.2, -51.9], 4);
L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { attribution: 'Tiles &copy; Esri', maxZoom: 19 }
).addTo(kmlMap);
const mapTalhoesLayer = L.layerGroup().addTo(kmlMap);
const mapLinesLayer = L.layerGroup().addTo(kmlMap);

function renderMap() {
  mapTalhoesLayer.clearLayers();
  mapLinesLayer.clearLayers();

  for (const t of talhoes) {
    const key = t.layerCode || String(t.talhao);
    const considerado = isTalhaoConsiderado(key);
    const polyLayer = L.geoJSON(t.feature, {
      style: considerado
        ? { color: '#b8893a', weight: 2, fillOpacity: 0.05 }
        : { color: '#888', weight: 1, dashArray: '4 4', fillOpacity: 0 },
    });
    polyLayer.addTo(mapTalhoesLayer);

    const center = turf.pointOnFeature(t.feature);
    const [lon, lat] = center.geometry.coordinates;
    L.marker([lat, lon], {
      icon: L.divIcon({
        className: considerado ? 'talhao-label' : 'talhao-label talhao-label--off',
        html: String(t.talhao),
        iconSize: [28, 16],
      }),
      interactive: false,
    }).addTo(mapTalhoesLayer);
  }

  for (const layerObj of layers) {
    for (const line of layerObj.lines) {
      const baseColor = line.color ? line.color.hex : '#ff6b00';
      const color = line.considerar ? baseColor : 'rgba(120, 120, 120, 0.55)';
      const weight = line.considerar ? 3 : 1.5;
      for (const points of line.geometries) {
        const latlngs = points.map((p) => [p.lat, p.lon]);
        L.polyline(latlngs, { color, weight }).addTo(mapLinesLayer);

        if (line.considerar) {
          const lineFeature = turf.lineString(points.map((p) => [p.lon, p.lat]));
          const totalLen = turf.length(lineFeature, { units: 'meters' });
          const mid = turf.along(lineFeature, totalLen / 2, { units: 'meters' });
          const [midLon, midLat] = mid.geometry.coordinates;
          L.marker([midLat, midLon], {
            icon: L.divIcon({
              className: 'line-label-wrapper',
              html: `<span class="line-label">${escapeHtml(line.name)}</span>`,
              iconSize: [0, 0],
            }),
            interactive: false,
          }).addTo(mapLinesLayer);
        }
      }
    }
  }

  const combined = [];
  mapTalhoesLayer.eachLayer((l) => combined.push(l));
  mapLinesLayer.eachLayer((l) => combined.push(l));
  if (combined.length > 0) {
    const bounds = L.featureGroup(combined).getBounds();
    if (bounds.isValid()) {
      kmlMap.invalidateSize();
      kmlMap.fitBounds(bounds, { padding: [40, 40] });
    }
  }
}

window.addEventListener('resize', () => kmlMap.invalidateSize());

let layers = [];
let kmlDocumentName = '';
let talhoesAll = [];
let talhoes = [];
let companyLogoDataUrl = localStorage.getItem('companyLogo') || '';
let companyNameValue = localStorage.getItem('companyName') || '';
const variavelSelections = new Map();
const talhaoConsiderar = new Map();

function isTalhaoConsiderado(talhaoKey) {
  return talhaoConsiderar.get(talhaoKey) !== false;
}

if (companyLogoDataUrl) {
  logoPreview.src = companyLogoDataUrl;
  logoPreview.hidden = false;
}
companyNameInput.value = companyNameValue;

logoInput.addEventListener('change', () => {
  const file = logoInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    companyLogoDataUrl = reader.result;
    logoPreview.src = companyLogoDataUrl;
    logoPreview.hidden = false;
    try {
      localStorage.setItem('companyLogo', companyLogoDataUrl);
    } catch (err) {
      // ignora se o logo for grande demais pra localStorage
    }
  };
  reader.readAsDataURL(file);
});

companyNameInput.addEventListener('input', () => {
  companyNameValue = companyNameInput.value;
  localStorage.setItem('companyName', companyNameValue);
});

function openMenu() {
  menuOverlay.hidden = false;
  menuDrawer.hidden = false;
}

function closeMenu() {
  menuOverlay.hidden = true;
  menuDrawer.hidden = true;
}

menuToggleBtn.addEventListener('click', openMenu);
menuCloseBtn.addEventListener('click', closeMenu);
menuOverlay.addEventListener('click', closeMenu);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menuDrawer.hidden) closeMenu();
});

function renderVariaveisConfig() {
  variaveisConfigBody.innerHTML = '';

  for (const variavel of VARIAVEIS) {
    const row = document.createElement('tr');

    const nomeCell = document.createElement('td');
    const nomeInput = document.createElement('input');
    nomeInput.type = 'text';
    nomeInput.value = variavel.nome;
    nomeInput.addEventListener('change', () => {
      const novoNome = nomeInput.value.trim();
      variavel.nome = novoNome || variavel.nome;
      nomeInput.value = variavel.nome;
      saveVariaveis();
      refreshAfterVariavelEdit();
    });
    nomeCell.appendChild(nomeInput);

    const taxaCell = document.createElement('td');
    const taxaInput = document.createElement('input');
    taxaInput.type = 'number';
    taxaInput.min = '0';
    taxaInput.step = '1';
    taxaInput.placeholder = '—';
    if (variavel.taxaMH != null) taxaInput.value = variavel.taxaMH;
    taxaInput.addEventListener('change', () => {
      const parsed = taxaInput.value === '' ? null : Number(taxaInput.value);
      variavel.taxaMH = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
      taxaInput.value = variavel.taxaMH != null ? variavel.taxaMH : '';
      saveVariaveis();
      refreshAfterVariavelEdit();
    });
    taxaCell.appendChild(taxaInput);

    const deleteCell = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'config-delete-btn';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Excluir variável';
    deleteBtn.addEventListener('click', () => {
      const ok = window.confirm(
        `Excluir "${variavel.nome}"? Talhões/linhas que já usam essa variável ficarão sem variável definida.`
      );
      if (!ok) return;
      VARIAVEIS = VARIAVEIS.filter((v) => v.id !== variavel.id);
      saveVariaveis();
      renderVariaveisConfig();
      refreshAfterVariavelEdit();
    });
    deleteCell.appendChild(deleteBtn);

    row.append(nomeCell, taxaCell, deleteCell);
    variaveisConfigBody.appendChild(row);
  }

  const addRow = document.createElement('tr');
  const addCell = document.createElement('td');
  addCell.colSpan = 3;
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'config-add-btn';
  addBtn.textContent = '+ Adicionar variável';
  addBtn.addEventListener('click', () => {
    VARIAVEIS.push({ id: novoVariavelId(), nome: 'NOVA VARIÁVEL', taxaMH: null });
    saveVariaveis();
    renderVariaveisConfig();
    refreshAfterVariavelEdit();
    const inputs = variaveisConfigBody.querySelectorAll('input[type="text"]');
    const lastInput = inputs[inputs.length - 1];
    if (lastInput) {
      lastInput.focus();
      lastInput.select();
    }
  });
  addCell.appendChild(addBtn);
  addRow.appendChild(addCell);
  variaveisConfigBody.appendChild(addRow);
}

function refreshAfterVariavelEdit() {
  if (layers.length > 0 && talhoes.length > 0) {
    renderTalhoes();
  }
}

renderVariaveisConfig();

exportBtn.addEventListener('click', () => {
  buildOrcamentoHTML();
  window.print();
});

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function buildOrcamentoHTML() {
  const { breakdown, sortedKeys } = getRefreshedBreakdown();
  const rows = computeNivelPorTalhao(breakdown, sortedKeys);
  const validRows = rows.filter((r) => r.valido);

  const fazendaInfo = talhoes[0];
  const fazendaNome = fazendaInfo ? fazendaInfo.desc : '';
  const fazendaCodigo = fazendaInfo ? fazendaInfo.secao : '';
  const agora = new Date();
  const dataGeracao = `${agora.toLocaleDateString('pt-BR')} ${agora.toLocaleTimeString('pt-BR')}`;

  const bodyRows = rows
    .map((r) => {
      if (!r.valido) {
        return `<tr><td>Talhão ${escapeHtml(String(r.talhao.talhao))}</td><td class="num">${formatNumberPtBR(
          r.areaProd
        )}</td><td colspan="5">sem variável definida</td></tr>`;
      }
      return `<tr>
        <td>Talhão ${escapeHtml(String(r.talhao.talhao))}</td>
        <td class="num">${formatNumberPtBR(r.areaProd)}</td>
        <td class="num">${r.nivel}</td>
        <td class="num">${formatReais(r.valorHa)}</td>
        <td class="num">${formatReais(r.custoPorNivel)}</td>
        <td class="num">${formatReais(r.custoSemNivel)}</td>
        <td class="num">${formatReais(r.economia)}</td>
      </tr>`;
    })
    .join('');

  let totalRowHtml = '';
  let summaryBoxHtml = '';
  if (validRows.length > 0) {
    const areaTotal = validRows.reduce((s, r) => s + r.areaProd, 0);
    const custoPorNivelTotal = validRows.reduce((s, r) => s + r.custoPorNivel, 0);
    const custoSemNivelTotal = validRows.reduce((s, r) => s + r.custoSemNivel, 0);
    const nivelPonderado = validRows.reduce((s, r) => s + r.nivel * r.areaProd, 0) / areaTotal;
    const valorHaPonderado = custoPorNivelTotal / areaTotal;
    const economiaTotal = custoSemNivelTotal - custoPorNivelTotal;

    totalRowHtml = `<tr class="orc-total-row">
      <td>TOTAL / MÉDIA PONDERADA</td>
      <td class="num">${formatNumberPtBR(areaTotal)}</td>
      <td class="num">${formatNumberPtBR(nivelPonderado)}</td>
      <td class="num">${formatReais(valorHaPonderado)}</td>
      <td class="num">${formatReais(custoPorNivelTotal)}</td>
      <td class="num">${formatReais(custoSemNivelTotal)}</td>
      <td class="num">${formatReais(economiaTotal)}</td>
    </tr>`;

    summaryBoxHtml = `<div class="orc-summary-box">
      <span>Custo total estimado (com nível de dificuldade)</span>
      <strong>${formatReais(custoPorNivelTotal)}</strong>
    </div>`;
  }

  const logoHtml = companyLogoDataUrl ? `<img src="${companyLogoDataUrl}" class="orc-logo" alt="logo">` : '';
  const companyNameHtml = companyNameValue
    ? `<span class="orc-company-name">${escapeHtml(companyNameValue)}</span>`
    : '';
  const letterheadHtml =
    logoHtml || companyNameHtml ? `<div class="orc-letterhead">${logoHtml}${companyNameHtml}</div>` : '';

  orcamentoPrint.innerHTML = `
    ${letterheadHtml}
    <div class="orc-title-block">
      <h1>Orçamento de Custo Operacional</h1>
      <p>Gerado em ${dataGeracao}</p>
    </div>
    <div class="orc-meta-bar">
      <strong>Fazenda:</strong> ${escapeHtml(fazendaNome)} (${escapeHtml(String(fazendaCodigo))})
    </div>
    <table class="orc-table">
      <thead>
        <tr>
          <th>Talhão</th>
          <th>Área (ha)</th>
          <th>Nível</th>
          <th>R$/ha</th>
          <th>Custo c/ nível</th>
          <th>Custo s/ nível</th>
          <th>Economia</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
      <tfoot>${totalRowHtml}</tfoot>
    </table>
    ${summaryBoxHtml}
    <p class="orc-footer">Documento gerado automaticamente pela Calculadora de Rendimento.</p>
  `;
}

selectFileBtn.addEventListener('click', () => kmlInput.click());
kmlInput.addEventListener('change', () => {
  if (kmlInput.files[0]) handleFile(kmlInput.files[0]);
});

['dragenter', 'dragover'].forEach((evt) =>
  uploadBox.addEventListener(evt, (e) => {
    e.preventDefault();
    uploadBox.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  uploadBox.addEventListener(evt, (e) => {
    e.preventDefault();
    uploadBox.classList.remove('dragover');
  })
);
uploadBox.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  fileNameEl.textContent = file.name;
  hideError();
  const reader = new FileReader();
  reader.onload = () => {
    try {
      layers = parseKML(reader.result);
      if (layers.length === 0) {
        showError('Nenhuma linha (LineString) foi encontrada nesse KML.');
        resultsSection.hidden = true;
        return;
      }
      renderLayers(layers);
      resultsSection.hidden = false;
      autoMatchFazenda();
      renderTalhoes();
    } catch (err) {
      showError(err.message || 'Não foi possível ler esse arquivo KML.');
      resultsSection.hidden = true;
    }
  };
  reader.onerror = () => showError('Falha ao ler o arquivo.');
  reader.readAsText(file);
}

talhoesAll = TALHOES_DATA.features
  .filter((f) => f.geometry)
  .map((f) => ({
    talhao: f.properties.TALHAO,
    layerCode: f.properties.Layer != null ? String(f.properties.Layer) : '',
    secao: f.properties.SECAO != null ? String(f.properties.SECAO) : '',
    desc: f.properties.DESC_SECAO || '',
    areaProd: Number(f.properties.AREA_PROD),
    feature: f,
  }));

populateFazendaPicker();
autoMatchFazenda();

function populateFazendaPicker() {
  const fazendasBySecao = new Map();
  for (const t of talhoesAll) {
    if (!fazendasBySecao.has(t.secao)) fazendasBySecao.set(t.secao, t.desc);
  }
  const fazendas = Array.from(fazendasBySecao.entries()).sort((a, b) =>
    a[1].localeCompare(b[1], 'pt-BR')
  );

  fazendaSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Selecione a fazenda…';
  fazendaSelect.appendChild(placeholder);

  for (const [secao, desc] of fazendas) {
    const option = document.createElement('option');
    option.value = secao;
    option.textContent = `${desc} (${secao})`;
    fazendaSelect.appendChild(option);
  }
}

fazendaSelect.addEventListener('change', () => {
  selectFazenda(fazendaSelect.value);
});

function autoMatchFazenda() {
  if (talhoesAll.length === 0) return;
  const match = kmlDocumentName.match(/(\d+)/);
  if (match) {
    const code = match[1];
    const hasOption = Array.from(fazendaSelect.options).some((opt) => opt.value === code);
    if (hasOption) fazendaSelect.value = code;
  }
  selectFazenda(fazendaSelect.value);
}

function selectFazenda(secaoValue) {
  talhoes = talhoesAll.filter((t) => t.secao === secaoValue);
  layers.forEach((layer) => layer.lines.forEach((line) => delete line._talhaoCache));
  renderTalhoes();
}

function showError(message) {
  errorMsg.textContent = message;
  errorMsg.hidden = false;
}

function hideError() {
  errorMsg.hidden = true;
}

function parseKML(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Arquivo KML inválido.');
  }

  const root = doc.getElementsByTagName('Document')[0] || doc.documentElement;
  const docNameEl = directChild(root, 'name');
  kmlDocumentName = docNameEl ? docNameEl.textContent.trim() : '';
  const found = [];
  const styleMap = buildKmlStyleMap(doc);
  const linhasSemCor = [];

  function walk(parentEl, pathPrefix) {
    for (const child of Array.from(parentEl.children)) {
      if (child.tagName !== 'Folder') continue;

      const nameEl = directChild(child, 'name');
      const folderName = nameEl ? nameEl.textContent.trim() : '(sem nome)';
      const fullPath = pathPrefix ? `${pathPrefix} > ${folderName}` : folderName;

      const isDefaultConsiderado = DEFAULT_CONSIDERAR.includes(fullPath);
      const lines = Array.from(child.children)
        .filter((c) => c.tagName === 'Placemark')
        .map((pm) => placemarkToLine(pm, styleMap))
        .filter((line) => line && line.length > 0)
        .map((line) => ({ ...line, considerar: isDefaultConsiderado }));

      for (const line of lines) {
        if (!line.color) linhasSemCor.push(`${fullPath} > ${line.name}`);
      }

      if (lines.length > 0) {
        found.push({ name: fullPath, lines });
      }

      walk(child, fullPath);
    }
  }

  walk(root, '');

  if (linhasSemCor.length > 0) {
    console.warn(
      `Não foi possível identificar a cor original no KML para ${linhasSemCor.length} linha(s) (vão usar a cor padrão):`,
      linhasSemCor
    );
  }

  return found;
}

function buildKmlStyleMap(doc) {
  const map = new Map();
  for (const styleEl of doc.getElementsByTagName('Style')) {
    const id = styleEl.getAttribute('id');
    if (!id) continue;
    const lineStyle = directChild(styleEl, 'LineStyle');
    const colorEl = lineStyle ? directChild(lineStyle, 'color') : null;
    if (colorEl && colorEl.textContent.trim()) {
      map.set(id, colorEl.textContent.trim());
    }
  }
  return map;
}

function parseKmlColor(hexStr) {
  if (!hexStr || hexStr.length < 8) return null;
  const clean = hexStr.trim();
  const aa = clean.slice(0, 2);
  const bb = clean.slice(2, 4);
  const gg = clean.slice(4, 6);
  const rr = clean.slice(6, 8);
  const alpha = parseInt(aa, 16) / 255;
  const hex = `#${rr}${gg}${bb}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return { hex, alpha: Number.isFinite(alpha) ? alpha : 1 };
}

function getPlacemarkLineColor(placemark, styleMap) {
  const inlineStyle = directChild(placemark, 'Style');
  const inlineLineStyle = inlineStyle ? directChild(inlineStyle, 'LineStyle') : null;
  const inlineColorEl = inlineLineStyle ? directChild(inlineLineStyle, 'color') : null;
  if (inlineColorEl && inlineColorEl.textContent.trim()) {
    return parseKmlColor(inlineColorEl.textContent.trim());
  }

  const styleUrlEl = directChild(placemark, 'styleUrl');
  if (styleUrlEl && styleUrlEl.textContent.trim()) {
    const id = styleUrlEl.textContent.trim().split('#').pop();
    const colorHex = styleMap.get(id);
    if (colorHex) return parseKmlColor(colorHex);
  }

  return null;
}

function directChild(el, tagName) {
  return Array.from(el.children).find((c) => c.tagName === tagName) || null;
}

function placemarkToLine(placemark, styleMap) {
  const lineStrings = placemark.getElementsByTagName('LineString');
  let totalLength = 0;
  const geometries = [];
  for (const ls of lineStrings) {
    const coordsEl = directChild(ls, 'coordinates');
    if (!coordsEl) continue;
    const points = parseCoordinates(coordsEl.textContent);
    if (points.length < 2) continue;
    geometries.push(points);
    totalLength += pointsLength(points);
  }
  if (totalLength === 0) return null;

  const nameEl = directChild(placemark, 'name');
  const name = nameEl ? nameEl.textContent.trim() : placemark.getAttribute('id') || '(sem nome)';
  const color = getPlacemarkLineColor(placemark, styleMap);
  return { name, length: totalLength, geometries, color };
}

function parseCoordinates(text) {
  return text
    .trim()
    .split(/\s+/)
    .map((tuple) => {
      const [lon, lat] = tuple.split(',').map(Number);
      return { lon, lat };
    })
    .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
}

function pointsLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return total;
}

function haversineMeters(p1, p2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(p2.lat - p1.lat);
  const dLon = toRad(p2.lon - p1.lon);
  const lat1 = toRad(p1.lat);
  const lat2 = toRad(p2.lat);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(a));
}

function formatMeters(value) {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
}

function layerConsideradoSum(layer) {
  return layer.lines.filter((l) => l.considerar).reduce((sum, l) => sum + l.length, 0);
}

function renderLayers(layers) {
  layersBody.innerHTML = '';

  layers.forEach((layer) => {
    const row = document.createElement('tr');

    const checkboxCell = document.createElement('td');
    const layerCheckbox = document.createElement('input');
    layerCheckbox.type = 'checkbox';
    checkboxCell.appendChild(layerCheckbox);

    const totalCell = document.createElement('td');
    totalCell.className = 'num';

    function syncLayer() {
      const checkedCount = layer.lines.filter((l) => l.considerar).length;
      layerCheckbox.checked = checkedCount === layer.lines.length;
      layerCheckbox.indeterminate = checkedCount > 0 && checkedCount < layer.lines.length;
      row.classList.toggle('layer-disabled', checkedCount === 0);
      totalCell.textContent = formatMeters(layerConsideradoSum(layer));
    }

    const nameCell = document.createElement('td');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = layer.name;
    details.appendChild(summary);

    const list = document.createElement('ul');
    list.className = 'lines-detail';
    layer.lines.forEach((line) => {
      const li = document.createElement('li');

      const lineCheckbox = document.createElement('input');
      lineCheckbox.type = 'checkbox';
      lineCheckbox.checked = line.considerar;
      lineCheckbox.addEventListener('change', () => {
        line.considerar = lineCheckbox.checked;
        syncLayer();
        recomputeAll();
      });

      const nameSpan = document.createElement('span');
      nameSpan.className = 'line-name';
      nameSpan.textContent = line.name;

      const lengthSpan = document.createElement('span');
      lengthSpan.textContent = formatMeters(line.length);

      li.append(lineCheckbox, nameSpan, lengthSpan);
      list.appendChild(li);
    });
    details.appendChild(list);
    nameCell.appendChild(details);

    layerCheckbox.addEventListener('change', () => {
      const newState = layerCheckbox.checked;
      layer.lines.forEach((line) => {
        line.considerar = newState;
      });
      list.querySelectorAll('input[type=checkbox]').forEach((cb) => {
        cb.checked = newState;
      });
      syncLayer();
      recomputeAll();
    });

    const countCell = document.createElement('td');
    countCell.className = 'num';
    countCell.textContent = layer.lines.length;

    row.append(checkboxCell, nameCell, countCell, totalCell, document.createElement('td'));
    layersBody.appendChild(row);

    syncLayer();
  });

  updateTotal(layers);
}

function updateTotal(layers) {
  const total = layers.reduce((sum, layer) => sum + layerConsideradoSum(layer), 0);
  const qtd = layers.reduce((sum, layer) => sum + layer.lines.filter((l) => l.considerar).length, 0);
  totalConsideradoEl.textContent = formatMeters(total);
  qtdConsideradaEl.textContent = `${qtd} ${qtd === 1 ? 'linha' : 'linhas'}`;
}

function recomputeAll() {
  updateTotal(layers);
  renderTalhoes();
}

function intersectionLengthMeters(lineFeature, polygonFeature) {
  const lineBox = turf.bbox(lineFeature);
  const polyBox = turf.bbox(polygonFeature);
  const bboxOverlap =
    lineBox[0] <= polyBox[2] && lineBox[2] >= polyBox[0] && lineBox[1] <= polyBox[3] && lineBox[3] >= polyBox[1];
  if (!bboxOverlap) return 0;

  let pieces;
  try {
    const boundary = turf.polygonToLine(polygonFeature);
    const split = turf.lineSplit(lineFeature, boundary);
    pieces = split.features.length > 0 ? split.features : [lineFeature];
  } catch (err) {
    pieces = [lineFeature];
  }

  let total = 0;
  for (const piece of pieces) {
    const coords = piece.geometry.coordinates;
    if (coords.length < 2) continue;
    const pieceLength = turf.length(piece, { units: 'meters' });
    const mid = turf.along(piece, pieceLength / 2, { units: 'meters' });
    if (turf.booleanPointInPolygon(mid, polygonFeature)) {
      total += pieceLength;
    }
  }
  return total;
}

function lineTalhaoBreakdown(line) {
  const byTalhaoKey = new Map();

  for (const points of line.geometries) {
    const lineFeature = turf.lineString(points.map((p) => [p.lon, p.lat]));

    for (const t of talhoes) {
      const len = intersectionLengthMeters(lineFeature, t.feature);
      if (len > 0.5) {
        const key = t.layerCode || String(t.talhao);
        byTalhaoKey.set(key, (byTalhaoKey.get(key) || 0) + len);
      }
    }
  }

  return { byTalhaoKey };
}

function computeTalhaoBreakdown() {
  const result = new Map();

  for (const layer of layers) {
    for (const line of layer.lines) {
      if (!line.considerar) continue;
      if (!line._talhaoCache) {
        line._talhaoCache = lineTalhaoBreakdown(line);
      }
      const { byTalhaoKey } = line._talhaoCache;

      for (const [key, meters] of byTalhaoKey) {
        if (!result.has(key)) {
          const t = talhoes.find((x) => (x.layerCode || String(x.talhao)) === key);
          result.set(key, { talhao: t, byLayer: new Map() });
        }
        const entry = result.get(key);
        if (!entry.byLayer.has(layer.name)) {
          entry.byLayer.set(layer.name, { total: 0, lines: new Map() });
        }
        const layerEntry = entry.byLayer.get(layer.name);
        layerEntry.total += meters;
        layerEntry.lines.set(line.name, (layerEntry.lines.get(line.name) || 0) + meters);
      }
    }
  }

  return result;
}

function resolveVariavelId(talhaoKey, layerName, lineName) {
  const layerKey = `${talhaoKey}::${layerName}`;
  const lineKey = `${layerKey}::${lineName}`;
  return variavelSelections.get(lineKey) || variavelSelections.get(layerKey) || '';
}

function renderTalhoes() {
  renderMap();

  if (talhoes.length === 0 || layers.length === 0) {
    talhoesSection.hidden = true;
    variavelSection.hidden = true;
    resumoSection.hidden = true;
    return;
  }

  const breakdown = computeTalhaoBreakdown();
  const allSortedKeys = Array.from(breakdown.keys()).sort((a, b) =>
    a.localeCompare(b, 'pt-BR', { numeric: true })
  );
  const consideredKeys = allSortedKeys.filter(isTalhaoConsiderado);

  renderVariavelTable(breakdown, allSortedKeys);
  renderTalhoesTable(breakdown, consideredKeys);
  renderNivelTable(breakdown, consideredKeys);
  renderResumoFazenda(breakdown, consideredKeys);
}

function getRefreshedBreakdown() {
  const breakdown = computeTalhaoBreakdown();
  const sortedKeys = Array.from(breakdown.keys())
    .filter(isTalhaoConsiderado)
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  return { breakdown, sortedKeys };
}

function renderTalhoesTable(breakdown, sortedKeys) {
  talhoesBody.innerHTML = '';

  for (const key of sortedKeys) {
    const entry = breakdown.get(key);
    const layerNames = Array.from(entry.byLayer.keys()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const talhaoLabel = `Talhão ${entry.talhao.talhao}`;
    const areaLabel = entry.talhao.areaProd.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    layerNames.forEach((layerName, i) => {
      const row = document.createElement('tr');
      if (i === 0) {
        const talhaoCell = document.createElement('td');
        talhaoCell.textContent = talhaoLabel;
        talhaoCell.rowSpan = layerNames.length;
        const areaCell = document.createElement('td');
        areaCell.className = 'num';
        areaCell.textContent = areaLabel;
        areaCell.rowSpan = layerNames.length;
        row.append(talhaoCell, areaCell);
      }
      const layerCell = document.createElement('td');
      layerCell.textContent = layerName;
      const metersCell = document.createElement('td');
      metersCell.className = 'num';
      metersCell.textContent = formatMeters(entry.byLayer.get(layerName).total);
      row.append(layerCell, metersCell);
      talhoesBody.appendChild(row);
    });
  }

  talhoesHint.textContent = `${sortedKeys.length} talhão(ões) com linhas · cruzamento considera apenas as linhas/camadas marcadas acima`;
  talhoesSection.hidden = false;
}

function buildVariavelOptions(select, { withInherit } = {}) {
  if (withInherit) {
    const inheritOption = document.createElement('option');
    inheritOption.value = '';
    inheritOption.textContent = 'Usar padrão da camada';
    select.appendChild(inheritOption);
  } else {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecione…';
    select.appendChild(placeholder);
  }

  for (const variavel of VARIAVEIS) {
    const option = document.createElement('option');
    option.value = variavel.id;
    option.textContent =
      variavel.taxaMH != null ? `${variavel.nome} (${variavel.taxaMH} m/h)` : `${variavel.nome} (taxa não definida)`;
    select.appendChild(option);
  }
}

function refreshNivelAndResumo() {
  const { breakdown, sortedKeys } = getRefreshedBreakdown();
  renderNivelTable(breakdown, sortedKeys);
  renderResumoFazenda(breakdown, sortedKeys);
}

function renderVariavelTable(breakdown, sortedKeys) {
  variavelBody.innerHTML = '';

  for (const key of sortedKeys) {
    const entry = breakdown.get(key);
    const layerNames = Array.from(entry.byLayer.keys()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const considerado = isTalhaoConsiderado(key);

    layerNames.forEach((layerName, i) => {
      const row = document.createElement('tr');
      row.classList.toggle('layer-disabled', !considerado);
      if (i === 0) {
        const talhaoCell = document.createElement('td');
        talhaoCell.rowSpan = layerNames.length;
        talhaoCell.className = 'talhao-checkbox-cell';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = considerado;
        checkbox.title = 'Considerar este talhão no cálculo';
        checkbox.addEventListener('change', () => {
          talhaoConsiderar.set(key, checkbox.checked);
          renderTalhoes();
        });

        const label = document.createElement('span');
        label.textContent = entry.talhao.talhao;

        talhaoCell.append(checkbox, label);
        row.append(talhaoCell);
      }

      const layerEntry = entry.byLayer.get(layerName);
      const layerKey = `${key}::${layerName}`;

      const layerCell = document.createElement('td');
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `${layerName} (${layerEntry.lines.size} linha${layerEntry.lines.size === 1 ? '' : 's'})`;
      details.appendChild(summary);

      const lineList = document.createElement('ul');
      lineList.className = 'lines-detail';

      for (const [lineName, meters] of layerEntry.lines) {
        const li = document.createElement('li');
        const lineKey = `${layerKey}::${lineName}`;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'line-name';
        nameSpan.textContent = `${lineName} (${formatMeters(meters)})`;

        const lineSelect = document.createElement('select');
        buildVariavelOptions(lineSelect, { withInherit: true });
        lineSelect.value = variavelSelections.get(lineKey) || '';
        lineSelect.addEventListener('change', () => {
          if (lineSelect.value) {
            variavelSelections.set(lineKey, lineSelect.value);
          } else {
            variavelSelections.delete(lineKey);
          }
          refreshNivelAndResumo();
        });

        li.append(nameSpan, lineSelect);
        lineList.appendChild(li);
      }

      details.appendChild(lineList);
      layerCell.appendChild(details);

      const selectCell = document.createElement('td');
      const select = document.createElement('select');
      buildVariavelOptions(select);

      select.value = variavelSelections.get(layerKey) || '';
      select.addEventListener('change', () => {
        if (select.value) {
          variavelSelections.set(layerKey, select.value);
        } else {
          variavelSelections.delete(layerKey);
        }
        refreshNivelAndResumo();
      });

      selectCell.appendChild(select);
      row.append(layerCell, selectCell);
      variavelBody.appendChild(row);
    });
  }

  variavelSection.hidden = false;
}

function formatNumberPtBR(value, digits = 2) {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function renderNivelTable(breakdown, sortedKeys) {
  nivelBody.innerHTML = '';

  for (const key of sortedKeys) {
    const entry = breakdown.get(key);
    const layerNames = Array.from(entry.byLayer.keys()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const talhaoLabel = `Talhão ${entry.talhao.talhao}`;
    const areaProd = entry.talhao.areaProd;

    layerNames.forEach((layerName, i) => {
      const row = document.createElement('tr');
      if (i === 0) {
        const talhaoCell = document.createElement('td');
        talhaoCell.textContent = talhaoLabel;
        talhaoCell.rowSpan = layerNames.length;
        row.append(talhaoCell);
      }

      const layerEntry = entry.byLayer.get(layerName);
      const metros = layerEntry.total;

      let horas = 0;
      let temVariavelValida = false;
      let temSemTaxa = false;
      const variavelIdsUsados = new Set();
      for (const [lineName, lineMeters] of layerEntry.lines) {
        const id = resolveVariavelId(key, layerName, lineName);
        const variavelLinha = VARIAVEIS.find((v) => v.id === id);
        if (!variavelLinha) continue;
        variavelIdsUsados.add(variavelLinha.id);
        if (variavelLinha.taxaMH == null) {
          temSemTaxa = true;
          continue;
        }
        horas += lineMeters / variavelLinha.taxaMH;
        temVariavelValida = true;
      }

      const layerCell = document.createElement('td');
      layerCell.textContent = layerName;

      const variavelCell = document.createElement('td');
      if (variavelIdsUsados.size === 0) {
        variavelCell.textContent = '—';
      } else if (variavelIdsUsados.size === 1) {
        const v = VARIAVEIS.find((x) => x.id === [...variavelIdsUsados][0]);
        variavelCell.textContent = v ? v.nome : '—';
      } else {
        variavelCell.textContent = 'Múltiplas variáveis';
      }

      const metrosCell = document.createElement('td');
      metrosCell.className = 'num';
      metrosCell.textContent = formatMeters(metros);

      const horasCell = document.createElement('td');
      const hectareCell = document.createElement('td');
      const nivelCell = document.createElement('td');
      const custoHaCell = document.createElement('td');
      const custoTotalCell = document.createElement('td');
      [horasCell, hectareCell, nivelCell, custoHaCell, custoTotalCell].forEach((c) => (c.className = 'num'));

      if (!temVariavelValida) {
        horasCell.textContent = '—';
        hectareCell.textContent = '—';
        nivelCell.textContent = '—';
        custoHaCell.textContent = temSemTaxa ? 'taxa não definida' : '—';
        custoTotalCell.textContent = '—';
      } else {
        const horaHectare = horas / areaProd;
        const nivel = lookupNivel(horaHectare);
        const custoTotal = nivel.custo * areaProd;

        horasCell.textContent = formatNumberPtBR(horas);
        hectareCell.textContent = formatNumberPtBR(horaHectare);
        nivelCell.textContent = nivel.nivel;
        custoHaCell.textContent = formatNumberPtBR(nivel.custo);
        custoTotalCell.textContent = formatNumberPtBR(custoTotal);
      }

      row.append(layerCell, variavelCell, metrosCell, horasCell, hectareCell, nivelCell, custoHaCell, custoTotalCell);
      nivelBody.appendChild(row);
    });
  }

  nivelSection.hidden = false;
}

function computeNivelPorTalhao(breakdown, sortedKeys) {
  const rows = [];

  for (const key of sortedKeys) {
    const entry = breakdown.get(key);
    const areaProd = entry.talhao.areaProd;
    let horasTotal = 0;
    let temVariavelValida = false;

    for (const [layerName, layerEntry] of entry.byLayer) {
      for (const [lineName, lineMeters] of layerEntry.lines) {
        const id = resolveVariavelId(key, layerName, lineName);
        const variavel = VARIAVEIS.find((v) => v.id === id);
        if (!variavel || variavel.taxaMH == null) continue;
        horasTotal += lineMeters / variavel.taxaMH;
        temVariavelValida = true;
      }
    }

    if (!temVariavelValida) {
      rows.push({ talhao: entry.talhao, areaProd, valido: false });
      continue;
    }

    const horaHectare = horasTotal / areaProd;
    const nivel = lookupNivel(horaHectare);
    const custoPorNivel = nivel.custo * areaProd;
    const custoSemNivel = CUSTO_SEM_NIVEL_HA * areaProd;

    rows.push({
      talhao: entry.talhao,
      areaProd,
      valido: true,
      nivel: nivel.nivel,
      valorHa: nivel.custo,
      custoPorNivel,
      custoSemNivel,
      economia: custoSemNivel - custoPorNivel,
    });
  }

  return rows;
}

function formatReais(value) {
  return `R$ ${formatNumberPtBR(value)}`;
}

function renderResumoFazenda(breakdown, sortedKeys) {
  const rows = computeNivelPorTalhao(breakdown, sortedKeys);
  const validRows = rows.filter((r) => r.valido);

  resumoBody.innerHTML = '';
  for (const r of rows) {
    const row = document.createElement('tr');
    const talhaoCell = document.createElement('td');
    talhaoCell.textContent = `Talhão ${r.talhao.talhao}`;
    const areaCell = document.createElement('td');
    areaCell.className = 'num';
    areaCell.textContent = formatNumberPtBR(r.areaProd);

    if (!r.valido) {
      const pendCell = document.createElement('td');
      pendCell.colSpan = 5;
      pendCell.textContent = 'selecione a variável acima para calcular';
      row.append(talhaoCell, areaCell, pendCell);
    } else {
      const nivelCell = document.createElement('td');
      nivelCell.className = 'num';
      nivelCell.textContent = r.nivel;
      const valorHaCell = document.createElement('td');
      valorHaCell.className = 'num';
      valorHaCell.textContent = formatNumberPtBR(r.valorHa);
      const custoPorCell = document.createElement('td');
      custoPorCell.className = 'num';
      custoPorCell.textContent = formatReais(r.custoPorNivel);
      const custoSemCell = document.createElement('td');
      custoSemCell.className = 'num';
      custoSemCell.textContent = formatReais(r.custoSemNivel);
      const economiaCell = document.createElement('td');
      economiaCell.className = 'num';
      economiaCell.textContent = formatReais(r.economia);
      row.append(talhaoCell, areaCell, nivelCell, valorHaCell, custoPorCell, custoSemCell, economiaCell);
    }
    resumoBody.appendChild(row);
  }

  resumoFoot.innerHTML = '';
  if (validRows.length === 0) {
    resumoAproximado.hidden = true;
  } else {
    const areaTotal = validRows.reduce((s, r) => s + r.areaProd, 0);
    const custoPorNivelTotal = validRows.reduce((s, r) => s + r.custoPorNivel, 0);
    const custoSemNivelTotal = validRows.reduce((s, r) => s + r.custoSemNivel, 0);
    const nivelPonderado = validRows.reduce((s, r) => s + r.nivel * r.areaProd, 0) / areaTotal;
    const valorHaPonderado = custoPorNivelTotal / areaTotal;
    const economiaTotal = custoSemNivelTotal - custoPorNivelTotal;

    const totalRow = document.createElement('tr');
    const c1 = document.createElement('td');
    c1.textContent = 'TOTAL / MÉDIA PONDERADA';
    const c2 = document.createElement('td');
    c2.className = 'num';
    c2.textContent = formatNumberPtBR(areaTotal);
    const c3 = document.createElement('td');
    c3.className = 'num';
    c3.textContent = formatNumberPtBR(nivelPonderado);
    const c4 = document.createElement('td');
    c4.className = 'num';
    c4.textContent = formatNumberPtBR(valorHaPonderado);
    const c5 = document.createElement('td');
    c5.className = 'num';
    c5.textContent = formatReais(custoPorNivelTotal);
    const c6 = document.createElement('td');
    c6.className = 'num';
    c6.textContent = formatReais(custoSemNivelTotal);
    const c7 = document.createElement('td');
    c7.className = 'num';
    c7.textContent = formatReais(economiaTotal);
    totalRow.append(c1, c2, c3, c4, c5, c6, c7);
    resumoFoot.appendChild(totalRow);

    const nivelAproximado = roundNivelPonderado(nivelPonderado);
    const custoHaAprox = NIVEL_CUSTOS[nivelAproximado];
    const custoPorNivelAprox = custoHaAprox * areaTotal;
    const economiaAprox = custoSemNivelTotal - custoPorNivelAprox;

    resumoNivelPonderadoHint.textContent = `média ponderada: ${formatNumberPtBR(nivelPonderado)}`;
    resumoNivelAprox.textContent = nivelAproximado;
    resumoValorHaAprox.textContent = formatReais(custoHaAprox);
    resumoCustoTotalAprox.textContent = formatReais(custoPorNivelAprox);
    resumoEconomiaAprox.textContent = formatReais(economiaAprox);
    resumoAproximado.hidden = false;
  }

  resumoSection.hidden = false;
}
