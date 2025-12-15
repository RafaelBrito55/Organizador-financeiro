// app.js — Meu Dinheiro na Conta
// Objetivo: cada lançamento é uma linha (não sobrescreve). Você pode ter vários itens
// na mesma categoria e no mesmo mês, com descrições diferentes.

const mesesLabels = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez"
];

// ===== DOM =====
const yearSelect = document.getElementById("yearSelect");
const btnAddYear = document.getElementById("btnAddYear");
const btnDeleteYear = document.getElementById("btnDeleteYear");

const formLancamento = document.getElementById("formLancamento");
const tipoLancamento = document.getElementById("tipoLancamento");
const mesLancamento = document.getElementById("mesLancamento");
const categoriaLancamento = document.getElementById("categoriaLancamento");
const listaCategorias = document.getElementById("listaCategorias");
const valorLancamento = document.getElementById("valorLancamento");
const descricaoLancamento = document.getElementById("descricaoLancamento");

const tabelaResumo = document.getElementById("tabelaResumo");

const filtroTipo = document.getElementById("filtroTipo");
const filtroMes = document.getElementById("filtroMes");
const filtroCategoria = document.getElementById("filtroCategoria");
const btnLimparFiltros = document.getElementById("btnLimparFiltros");
const tabelaLancamentos = document.getElementById("tabelaLancamentos");

const anoLegenda1 = document.getElementById("anoLegenda1");

const canvasBar = document.getElementById("barGastosCategorias");
const canvasLine = document.getElementById("lineGanhosGastos");

// ===== Estado =====
// ano -> { lancamentos: [ {id,tipo,mes,categoria,valor,descricao} ] }
const dadosPorAno = {};
let nextId = 1;

// ===== Firebase =====
let authFirebase = null;
let db = null;
let currentUserUid = null;
let saveTimeoutId = null;
let firebaseCarregado = false;

if (typeof firebase !== "undefined" && firebase?.apps?.length) {
  authFirebase = firebase.auth();
  db = firebase.firestore();
}

// ===== Persistência =====
function salvarFirebase() {
  if (!db || !currentUserUid) return;
  clearTimeout(saveTimeoutId);

  saveTimeoutId = setTimeout(async () => {
    try {
      // ⚠️ Sem merge aqui de propósito: assim, quando você EXCLUI um ano,
      // ele some de verdade do Firestore (merge:true não remove campos antigos)
      await db.collection("usuarios").doc(currentUserUid).set({ dadosPorAno, nextId });
    } catch (err) {
      console.error("Erro ao salvar no Firebase:", err);
    }
  }, 450);
}

function recalcularNextId() {
  let maxId = 0;
  Object.values(dadosPorAno).forEach(anoData => {
    (anoData?.lancamentos || []).forEach(l => {
      if (typeof l?.id === "number" && l.id > maxId) maxId = l.id;
    });
  });
  nextId = Math.max(1, maxId + 1);
}

// Migração defensiva: se existir uma estrutura antiga (ganhos/gastos por mês/categoria),
// converte tudo para o formato "lancamentos: []".
function migrarEstruturaAntigaSePrecisar(ano) {
  const anoData = dadosPorAno[ano];
  if (!anoData || Array.isArray(anoData.lancamentos)) {
    if (anoData && !Array.isArray(anoData.lancamentos)) anoData.lancamentos = [];
    return;
  }

  const lancamentos = [];
  let idTemp = 1;

  const pushItem = (tipo, mes, categoria, item) => {
    if (item == null) return;

    if (Array.isArray(item)) {
      item.forEach(it => pushItem(tipo, mes, categoria, it));
      return;
    }

    let valor = null;
    let descricao = "";

    if (typeof item === "number") {
      valor = item;
    } else if (typeof item === "string") {
      const v = parseFloat(item.replace(",", "."));
      if (!Number.isNaN(v)) valor = v;
    } else if (typeof item === "object") {
      const vRaw = item.valor ?? item.value ?? item.amount ?? item.v;
      if (typeof vRaw === "number") valor = vRaw;
      else if (typeof vRaw === "string") {
        const v = parseFloat(vRaw.replace(",", "."));
        if (!Number.isNaN(v)) valor = v;
      }

      descricao = (item.descricao ?? item.desc ?? item.nome ?? item.label ?? "").toString().trim();
    }

    if (typeof mes !== "number" || mes < 0 || mes > 11) return;
    if (!categoria || typeof categoria !== "string") return;
    if (typeof valor !== "number" || Number.isNaN(valor)) return;

    lancamentos.push({
      id: idTemp++,
      tipo,
      mes,
      categoria,
      valor,
      descricao
    });
  };

  const isMonthKey = (k) => /^\d+$/.test(k) && +k >= 0 && +k <= 11;

  const extrairDeRaiz = (tipo, raiz) => {
    if (!raiz || typeof raiz !== "object") return;

    const keys = Object.keys(raiz);
    if (keys.length === 0) return;

    if (keys.every(isMonthKey)) {
      keys.forEach(mk => {
        const mes = parseInt(mk, 10);
        const porCat = raiz[mk];
        if (porCat && typeof porCat === "object") {
          Object.keys(porCat).forEach(cat => {
            pushItem(tipo, mes, cat, porCat[cat]);
          });
        }
      });
      return;
    }

    keys.forEach(cat => {
      const porMes = raiz[cat];
      if (porMes && typeof porMes === "object") {
        Object.keys(porMes).forEach(mk => {
          if (!isMonthKey(mk)) return;
          const mes = parseInt(mk, 10);
          pushItem(tipo, mes, cat, porMes[mk]);
        });
      }
    });
  };

  const ganhosAntigos = anoData.ganhos || anoData.ganho || anoData.receitas || null;
  const gastosAntigos = anoData.gastos || anoData.gasto || anoData.despesas || null;

  extrairDeRaiz("ganho", ganhosAntigos);
  extrairDeRaiz("gasto", gastosAntigos);

  anoData.lancamentos = lancamentos;

  delete anoData.ganhos;
  delete anoData.ganho;
  delete anoData.receitas;
  delete anoData.gastos;
  delete anoData.gasto;
  delete anoData.despesas;
}

async function carregarDadosDoFirebase() {
  if (!db || !currentUserUid) return;

  try {
    const snap = await db.collection("usuarios").doc(currentUserUid).get();
    if (snap.exists) {
      const data = snap.data() || {};
      Object.assign(dadosPorAno, data.dadosPorAno || {});
      if (typeof data.nextId === "number") nextId = data.nextId;
    }

    Object.keys(dadosPorAno).forEach(ano => migrarEstruturaAntigaSePrecisar(ano));
    recalcularNextId();

    firebaseCarregado = true;

    popularSelectAnos();
    atualizarAnoAtual();
  } catch (err) {
    console.error("Erro ao carregar dados do Firebase:", err);
    firebaseCarregado = true;
    popularSelectAnos();
    atualizarAnoAtual();
  }
}

// ===== Utils =====
function garantirAno(ano) {
  if (!dadosPorAno[ano]) dadosPorAno[ano] = { lancamentos: [] };
  if (!Array.isArray(dadosPorAno[ano].lancamentos)) dadosPorAno[ano].lancamentos = [];
}

function formatarMoeda(v) {
  return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function normalizarValorNumero(v) {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;

  let s = v.trim();
  if (!s) return NaN;

  s = s.replace(/\s+/g, "");
  s = s.replace(/[^0-9,.\-]/g, "");

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "");
      s = s.replace(/,/g, ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    s = s.replace(/\./g, "");
    s = s.replace(/,/g, ".");
  } else {
    s = s.replace(/,/g, "");
  }

  const n = parseFloat(s);
  return Number.isNaN(n) ? NaN : n;
}

// ===== Lançamentos =====
function adicionarLancamento(ano, tipo, mes, categoria, valor, descricao) {
  garantirAno(ano);

  dadosPorAno[ano].lancamentos.push({
    id: nextId++,
    tipo,
    mes,
    categoria,
    valor,
    descricao
  });

  salvarFirebase();
}

function editarLancamento(ano, id, novosDados) {
  garantirAno(ano);
  const idx = dadosPorAno[ano].lancamentos.findIndex(l => l.id === id);
  if (idx === -1) return;

  dadosPorAno[ano].lancamentos[idx] = {
    ...dadosPorAno[ano].lancamentos[idx],
    ...novosDados
  };

  salvarFirebase();
}

function excluirLancamento(ano, id) {
  garantirAno(ano);
  dadosPorAno[ano].lancamentos = dadosPorAno[ano].lancamentos.filter(l => l.id !== id);
  salvarFirebase();
}

// ===== Cálculos =====
function calcularTotaisMes(ano) {
  garantirAno(ano);
  const ganhos = Array(12).fill(0);
  const gastos = Array(12).fill(0);

  dadosPorAno[ano].lancamentos.forEach(l => {
    if (typeof l.mes !== "number") return;
    const v = Number(l.valor) || 0;
    if (l.tipo === "ganho") ganhos[l.mes] += v;
    if (l.tipo === "gasto") gastos[l.mes] += v;
  });

  return { ganhos, gastos };
}

function calcularGastosPorCategoria(ano) {
  garantirAno(ano);
  const mapa = {};

  dadosPorAno[ano].lancamentos.forEach(l => {
    if (l.tipo !== "gasto") return;
    const cat = (l.categoria || "Sem categoria").toString().trim() || "Sem categoria";
    const v = Number(l.valor) || 0;
    mapa[cat] = (mapa[cat] || 0) + v;
  });

  return mapa;
}

// Helper: pega os N maiores itens de um mapa {chave: valor}
function setMaiores(mapa, n = 7) {
  return Object.entries(mapa || {})
    .map(([k, v]) => [k, Number(v) || 0])
    .sort((a, b) => (b[1] - a[1]))
    .slice(0, n);
}

// ===== Categorias (sugestões) =====
function obterCategoriasExistentes({ tipo = null, ano = null } = {}) {
  const set = new Set();

  const coletar = (l) => {
    if (!l || !l.categoria) return;
    if (tipo && l.tipo !== tipo) return;
    const c = l.categoria.toString().trim();
    if (c) set.add(c);
  };

  if (ano) {
    garantirAno(ano);
    (dadosPorAno[ano].lancamentos || []).forEach(coletar);
  } else {
    Object.values(dadosPorAno).forEach(anoData => {
      (anoData?.lancamentos || []).forEach(coletar);
    });
  }

  return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
}

function atualizarDatalistCategorias() {
  if (!listaCategorias || !tipoLancamento) return;

  const tipo = tipoLancamento.value;
  const cats = obterCategoriasExistentes({ tipo });

  listaCategorias.innerHTML = "";
  cats.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    listaCategorias.appendChild(opt);
  });
}

// ===== UI: Resumo =====
function preencherResumo(ano) {
  const { ganhos, gastos } = calcularTotaisMes(ano);
  if (!tabelaResumo) return;

  tabelaResumo.innerHTML = "";

  const linhaG = document.createElement("tr");
  const linhaGt = document.createElement("tr");
  const linhaS = document.createElement("tr");

  linhaG.innerHTML = "<td><strong>Ganhos</strong></td>";
  linhaGt.innerHTML = "<td><strong>Gastos</strong></td>";
  linhaS.innerHTML = "<td><strong>Saldo</strong></td>";

  ganhos.forEach((g, i) => {
    linhaG.innerHTML += `<td class="positivo">${formatarMoeda(g)}</td>`;
    linhaGt.innerHTML += `<td class="negativo">${formatarMoeda(gastos[i])}</td>`;
    linhaS.innerHTML += `<td>${formatarMoeda(g - gastos[i])}</td>`;
  });

  tabelaResumo.appendChild(linhaG);
  tabelaResumo.appendChild(linhaGt);
  tabelaResumo.appendChild(linhaS);

  const totalG = ganhos.reduce((a, b) => a + b, 0);
  const totalGt = gastos.reduce((a, b) => a + b, 0);

  const resumoGanhosAno = document.getElementById("resumoGanhosAno");
  const resumoGastosAno = document.getElementById("resumoGastosAno");
  const resumoSaldoAno = document.getElementById("resumoSaldoAno");

  if (resumoGanhosAno) resumoGanhosAno.textContent = formatarMoeda(totalG);
  if (resumoGastosAno) resumoGastosAno.textContent = formatarMoeda(totalGt);
  if (resumoSaldoAno) resumoSaldoAno.textContent = formatarMoeda(totalG - totalGt);
}

// ===== UI: Filtros =====
function atualizarOpcoesFiltroCategoria(anoAtual) {
  if (!filtroCategoria) return;

  const tipo = filtroTipo?.value || "todos";
  const cats = obterCategoriasExistentes({
    tipo: tipo === "todos" ? null : tipo,
    ano: anoAtual || (yearSelect?.value || null)
  });

  const atual = filtroCategoria.value;

  filtroCategoria.innerHTML = "";
  const optTodos = document.createElement("option");
  optTodos.value = "todos";
  optTodos.textContent = "Todas";
  filtroCategoria.appendChild(optTodos);

  cats.forEach(c => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    filtroCategoria.appendChild(o);
  });

  if (atual && Array.from(filtroCategoria.options).some(o => o.value === atual)) {
    filtroCategoria.value = atual;
  } else {
    filtroCategoria.value = "todos";
  }
}

function obterLancamentosFiltrados(ano) {
  garantirAno(ano);
  const tipo = filtroTipo?.value || "todos";
  const mes = filtroMes?.value || "todos";
  const cat = filtroCategoria?.value || "todos";

  return dadosPorAno[ano].lancamentos.filter(l => {
    if (tipo !== "todos" && l.tipo !== tipo) return false;
    if (mes !== "todos" && String(l.mes) !== String(mes)) return false;
    if (cat !== "todos" && l.categoria !== cat) return false;
    return true;
  });
}

// ===== UI: Tabela de lançamentos =====
function renderTabelaLancamentos(ano) {
  if (!tabelaLancamentos) return;

  const lista = obterLancamentosFiltrados(ano)
    .slice()
    .sort((a, b) =>
      (a.mes - b.mes) ||
      a.tipo.localeCompare(b.tipo) ||
      (a.categoria || "").localeCompare(b.categoria || "") ||
      (a.id - b.id)
    );

  if (lista.length === 0) {
    tabelaLancamentos.innerHTML = '<tr><td colspan="6">Nenhum lançamento encontrado.</td></tr>';
    return;
  }

  tabelaLancamentos.innerHTML = "";

  lista.forEach(l => {
    const tr = document.createElement("tr");

    const tdTipo = document.createElement("td");
    tdTipo.textContent = l.tipo === "ganho" ? "Ganho" : "Gasto";

    const tdMes = document.createElement("td");
    tdMes.textContent = mesesLabels[l.mes] ?? "-";

    const tdCat = document.createElement("td");
    tdCat.textContent = l.categoria || "";

    const tdValor = document.createElement("td");
    tdValor.textContent = formatarMoeda(Number(l.valor) || 0);

    const tdDesc = document.createElement("td");
    tdDesc.textContent = l.descricao || "";

    const tdAcoes = document.createElement("td");

    const btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.className = "btn-small";
    btnEditar.textContent = "Editar";
    btnEditar.addEventListener("click", () => {
      const novoValorStr = prompt("Novo valor (ex.: 83,30):", String(l.valor).replace(".", ","));
      if (novoValorStr === null) return;
      const novoValor = normalizarValorNumero(novoValorStr);
      if (Number.isNaN(novoValor)) {
        alert("Valor inválido.");
        return;
      }

      const novaCategoria = prompt("Categoria:", l.categoria || "");
      if (novaCategoria === null) return;
      const categoriaTrim = (novaCategoria || "").replace(/\s+/g, " ").trim();
      if (!categoriaTrim) {
        alert("Categoria inválida.");
        return;
      }

      const novaDesc = prompt("Descrição (opcional):", l.descricao || "");
      if (novaDesc === null) return;

      editarLancamento(ano, l.id, {
        valor: novoValor,
        categoria: categoriaTrim,
        descricao: (novaDesc || "").trim()
      });

      atualizarAnoAtual();
    });

    const btnExcluir = document.createElement("button");
    btnExcluir.type = "button";
    btnExcluir.className = "btn-small btn-outline";
    btnExcluir.textContent = "Excluir";
    btnExcluir.addEventListener("click", () => {
      const ok = confirm("Excluir este lançamento?");
      if (!ok) return;
      excluirLancamento(ano, l.id);
      atualizarAnoAtual();
    });

    tdAcoes.append(btnEditar, btnExcluir);

    tr.append(tdTipo, tdMes, tdCat, tdValor, tdDesc, tdAcoes);
    tabelaLancamentos.appendChild(tr);
  });
}

// ===== Charts =====
let chartBar = null;
let chartLine = null;

function atualizarGraficos(ano) {
  if (!canvasBar || !canvasLine || typeof Chart === "undefined") return;

  // Bar: gastos por categoria (TOP 7)
  const gastosPorCat = calcularGastosPorCategoria(ano);
  const top7 = setMaiores(gastosPorCat, 7);
  const labelsBar = top7.map(([cat]) => cat);
  const dataBar = top7.map(([, valor]) => valor);

  if (chartBar) chartBar.destroy();
  chartBar = new Chart(canvasBar, {
    type: "bar",
    data: {
      labels: labelsBar,
      datasets: [{ label: "Gastos (R$)", data: dataBar }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          ticks: {
            callback: (value) => {
              try { return formatarMoeda(Number(value)); } catch { return value; }
            }
          }
        },
        x: {
          ticks: {
            autoSkip: false,
            maxRotation: 40,
            minRotation: 0
          }
        }
      }
    }
  });

  // Linha: ganhos x gastos por mês
  const { ganhos, gastos } = calcularTotaisMes(ano);
  if (chartLine) chartLine.destroy();
  chartLine = new Chart(canvasLine, {
    type: "line",
    data: {
      labels: mesesLabels,
      datasets: [
        { label: "Ganhos", data: ganhos, tension: 0.25 },
        { label: "Gastos", data: gastos, tension: 0.25 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: {
        y: {
          ticks: {
            callback: (value) => {
              try { return formatarMoeda(Number(value)); } catch { return value; }
            }
          }
        }
      }
    }
  });

  if (anoLegenda1) anoLegenda1.textContent = ano;
}

// ===== Anos =====
function popularSelectAnos() {
  if (!yearSelect) return;

  const anos = Object.keys(dadosPorAno).sort((a, b) => Number(a) - Number(b));
  yearSelect.innerHTML = "";

  anos.forEach(a => {
    const o = document.createElement("option");
    o.value = a;
    o.textContent = a;
    yearSelect.appendChild(o);
  });

  if (!yearSelect.value) {
    const anoAtual = new Date().getFullYear().toString();
    yearSelect.value = anos.includes(anoAtual) ? anoAtual : (anos[0] || anoAtual);
  }
}

function atualizarAnoAtual() {
  if (!yearSelect) return;
  const ano = yearSelect.value;
  garantirAno(ano);

  preencherResumo(ano);
  atualizarOpcoesFiltroCategoria(ano);
  atualizarDatalistCategorias();
  renderTabelaLancamentos(ano);
  atualizarGraficos(ano);
}

// ===== Eventos =====
if (tipoLancamento) {
  tipoLancamento.addEventListener("change", () => {
    atualizarDatalistCategorias();
  });
}

if (formLancamento) {
  formLancamento.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (currentUserUid && !firebaseCarregado) {
      await carregarDadosDoFirebase();
    }

    const ano = yearSelect?.value || new Date().getFullYear().toString();
    const tipo = tipoLancamento?.value || "ganho";
    const mes = parseInt(mesLancamento?.value ?? "0", 10);
    const categoria = (categoriaLancamento?.value || "").replace(/\s+/g, " ").trim();
    const valor = normalizarValorNumero(valorLancamento?.value ?? "");
    const desc = (descricaoLancamento?.value || "").trim();

    if (!categoria) return alert("Digite uma categoria.");
    if (Number.isNaN(valor)) return alert("Valor inválido.");

    adicionarLancamento(ano, tipo, mes, categoria, valor, desc);
    atualizarAnoAtual();

    if (valorLancamento) valorLancamento.value = "";
    if (descricaoLancamento) descricaoLancamento.value = "";
  });
}

if (yearSelect) {
  yearSelect.addEventListener("change", () => atualizarAnoAtual());
}

if (btnAddYear) {
  btnAddYear.addEventListener("click", () => {
    const ano = prompt("Qual ano quer adicionar? Ex.: 2026");
    if (!ano) return;
    const a = ano.trim();
    if (!/^\d{4}$/.test(a)) {
      alert("Digite um ano válido (4 dígitos).");
      return;
    }
    garantirAno(a);
    popularSelectAnos();
    yearSelect.value = a;
    atualizarAnoAtual();
    salvarFirebase();
  });
}

if (btnDeleteYear) {
  btnDeleteYear.addEventListener("click", () => {
    if (!yearSelect) return;
    const ano = yearSelect.value;
    if (!ano) return;

    const ok = confirm(
      `Excluir o ano ${ano}?\n\nIsso vai apagar TODOS os lançamentos desse ano.\nEssa ação não pode ser desfeita.`
    );
    if (!ok) return;

    delete dadosPorAno[ano];

    let anosRestantes = Object.keys(dadosPorAno).sort((a, b) => Number(a) - Number(b));
    if (anosRestantes.length === 0) {
      const anoAtual = new Date().getFullYear().toString();
      garantirAno(anoAtual);
      anosRestantes = [anoAtual];
    }

    recalcularNextId();
    popularSelectAnos();
    yearSelect.value = anosRestantes[anosRestantes.length - 1]; // vai para o ano mais recente
    atualizarAnoAtual();

    salvarFirebase();
  });
}

if (filtroTipo) {
  filtroTipo.addEventListener("change", () => atualizarAnoAtual());
}
if (filtroMes) filtroMes.addEventListener("change", () => atualizarAnoAtual());
if (filtroCategoria) filtroCategoria.addEventListener("change", () => atualizarAnoAtual());

if (btnLimparFiltros) {
  btnLimparFiltros.addEventListener("click", () => {
    if (filtroTipo) filtroTipo.value = "todos";
    if (filtroMes) filtroMes.value = "todos";
    if (filtroCategoria) filtroCategoria.value = "todos";
    atualizarAnoAtual();
  });
}

// ===== Init =====
document.addEventListener("DOMContentLoaded", () => {
  const anoAtual = new Date().getFullYear().toString();
  garantirAno(anoAtual);

  popularSelectAnos();
  atualizarAnoAtual();

  if (authFirebase) {
    authFirebase.onAuthStateChanged(user => {
      if (user) {
        currentUserUid = user.uid;
        carregarDadosDoFirebase();
      }
    });
  } else {
    firebaseCarregado = true;
  }
});
