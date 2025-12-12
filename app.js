// app.js — Meu Dinheiro na Conta
// Objetivo: cada lançamento é uma linha (não sobrescreve). Você pode ter vários itens
// na mesma categoria e no mesmo mês, com descrições diferentes.

// ===== Categorias =====
const categoriasGanhos = [
  "Salário",
  "Renda extra",
  "13º salário",
  "Férias",
  "Outros ganhos"
];

const categoriasGastos = [
  "Aluguel",
  "Supermercado",
  "Combustível",
  "Despesas fixas",
  "Cartões de crédito",
  "Saúde",
  "Educação",
  "Lazer",
  "Impostos",
  "Outros gastos"
];

const mesesLabels = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez"
];

// ===== DOM =====
const yearSelect = document.getElementById("yearSelect");
const btnAddYear = document.getElementById("btnAddYear");

const formLancamento = document.getElementById("formLancamento");
const tipoLancamento = document.getElementById("tipoLancamento");
const mesLancamento = document.getElementById("mesLancamento");
const categoriaLancamento = document.getElementById("categoriaLancamento");
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
      await db.collection("usuarios").doc(currentUserUid).set(
        { dadosPorAno, nextId },
        { merge: true }
      );
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

    // Se for array, adiciona todos (isso cobre "Outros gastos" antigo, por ex.)
    if (Array.isArray(item)) {
      item.forEach(it => pushItem(tipo, mes, categoria, it));
      return;
    }

    // Aceita tanto {valor, descricao} quanto número puro
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

    // Caso 1: raiz[mes][categoria] = item
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

    // Caso 2: raiz[categoria][mes] = item
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

  // Tenta achar possíveis chaves antigas
  const ganhosAntigos = anoData.ganhos || anoData.ganho || anoData.receitas || null;
  const gastosAntigos = anoData.gastos || anoData.gasto || anoData.despesas || null;

  extrairDeRaiz("ganho", ganhosAntigos);
  extrairDeRaiz("gasto", gastosAntigos);

  anoData.lancamentos = lancamentos;

  // Limpa chaves antigas (evita bagunça)
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

    // Migra anos antigos, se houver
    Object.keys(dadosPorAno).forEach(ano => migrarEstruturaAntigaSePrecisar(ano));

    // Garante nextId consistente (evita colisões depois do reload)
    recalcularNextId();

    firebaseCarregado = true;

    popularSelectAnos();
    atualizarAnoAtual();
  } catch (err) {
    console.error("Erro ao carregar dados do Firebase:", err);
    firebaseCarregado = true; // libera uso mesmo assim
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
  if (typeof v === "string") {
    const n = parseFloat(v.replace(".", "").replace(",", "."));
    return Number.isNaN(n) ? NaN : n;
  }
  return NaN;
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
    if (l.tipo === "ganho") ganhos[l.mes] += l.valor;
    else gastos[l.mes] += l.valor;
  });

  return { ganhos, gastos };
}

function calcularGastosPorCategoria(ano) {
  garantirAno(ano);
  const mapa = {};
  categoriasGastos.forEach(c => { mapa[c] = 0; });

  dadosPorAno[ano].lancamentos.forEach(l => {
    if (l.tipo !== "gasto") return;
    if (!mapa.hasOwnProperty(l.categoria)) mapa[l.categoria] = 0;
    mapa[l.categoria] += l.valor;
  });

  return mapa;
}

// ===== UI: Categorias no form =====
function atualizarCategoriasForm() {
  if (!tipoLancamento || !categoriaLancamento) return;

  const tipo = tipoLancamento.value;
  categoriaLancamento.innerHTML = "";

  const lista = tipo === "ganho" ? categoriasGanhos : categoriasGastos;
  lista.forEach(c => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    categoriaLancamento.appendChild(o);
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
    const gt = gastos[i];
    const s = g - gt;

    linhaG.innerHTML += `<td>${formatarMoeda(g)}</td>`;
    linhaGt.innerHTML += `<td>${formatarMoeda(gt)}</td>`;
    linhaS.innerHTML += `<td class="${s >= 0 ? "saldo-positivo" : "saldo-negativo"}">${formatarMoeda(s)}</td>`;
  });

  tabelaResumo.append(linhaG, linhaGt, linhaS);

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
function atualizarOpcoesFiltroCategoria() {
  if (!filtroCategoria || !filtroTipo) return;

  const tipo = filtroTipo.value;
  const lista =
    tipo === "ganho" ? categoriasGanhos :
    tipo === "gasto" ? categoriasGastos :
    [...categoriasGanhos, ...categoriasGastos];

  const atual = filtroCategoria.value;

  filtroCategoria.innerHTML = "";
  const optTodos = document.createElement("option");
  optTodos.value = "todos";
  optTodos.textContent = "Todas";
  filtroCategoria.appendChild(optTodos);

  lista.forEach(c => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    filtroCategoria.appendChild(o);
  });

  // tenta manter seleção atual
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
  const categoria = filtroCategoria?.value || "todos";

  return dadosPorAno[ano].lancamentos.filter(l => {
    if (tipo !== "todos" && l.tipo !== tipo) return false;
    if (mes !== "todos" && l.mes !== parseInt(mes, 10)) return false;
    if (categoria !== "todos" && l.categoria !== categoria) return false;
    return true;
  });
}

// ===== UI: Tabela de lançamentos =====
function renderTabelaLancamentos(ano) {
  if (!tabelaLancamentos) return;

  const lista = obterLancamentosFiltrados(ano)
    .slice()
    .sort((a, b) => (a.mes - b.mes) || a.tipo.localeCompare(b.tipo) || a.categoria.localeCompare(b.categoria) || (a.id - b.id));

  if (lista.length === 0) {
    tabelaLancamentos.innerHTML = '<tr><td colspan="6">Nenhum lançamento encontrado.</td></tr>';
    return;
  }

  tabelaLancamentos.innerHTML = "";

  lista.forEach(l => {
    const tr = document.createElement("tr");

    const tdTipo = document.createElement("td");
    tdTipo.innerHTML = `<span class="badge ${l.tipo === "ganho" ? "badge-ganho" : "badge-gasto"}">${l.tipo === "ganho" ? "Ganho" : "Gasto"}</span>`;

    const tdMes = document.createElement("td");
    tdMes.textContent = mesesLabels[l.mes] || "";

    const tdCat = document.createElement("td");
    tdCat.textContent = l.categoria || "";

    const tdValor = document.createElement("td");
    tdValor.textContent = formatarMoeda(l.valor);

    const tdDesc = document.createElement("td");
    tdDesc.textContent = l.descricao || "";

    const tdAcoes = document.createElement("td");

    const btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.className = "btn-small";
    btnEditar.textContent = "Editar";
    btnEditar.addEventListener("click", () => {
      const novoValorStr = prompt("Novo valor (R$):", String(l.valor).replace(".", ","));
      if (novoValorStr === null) return;
      const novoValor = normalizarValorNumero(novoValorStr);
      if (Number.isNaN(novoValor)) {
        alert("Valor inválido.");
        return;
      }

      const novaDesc = prompt("Descrição (opcional):", l.descricao || "");
      if (novaDesc === null) return;

      editarLancamento(ano, l.id, { valor: novoValor, descricao: (novaDesc || "").trim() });
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

  // Bar: gastos por categoria
  const gastosPorCat = calcularGastosPorCategoria(ano);
  const labelsBar = Object.keys(gastosPorCat);
  const dataBar = labelsBar.map(k => gastosPorCat[k] || 0);

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
  atualizarOpcoesFiltroCategoria();
  renderTabelaLancamentos(ano);
  atualizarGraficos(ano);
}

// ===== Eventos =====
if (tipoLancamento) {
  tipoLancamento.addEventListener("change", () => {
    atualizarCategoriasForm();
  });
}

if (formLancamento) {
  formLancamento.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Se estiver logado mas ainda não carregou do Firebase, tenta carregar antes
    if (currentUserUid && !firebaseCarregado) {
      await carregarDadosDoFirebase();
    }

    const ano = yearSelect?.value || new Date().getFullYear().toString();
    const tipo = tipoLancamento?.value || "ganho";
    const mes = parseInt(mesLancamento?.value ?? "0", 10);
    const categoria = categoriaLancamento?.value || "";
    const valor = normalizarValorNumero(valorLancamento?.value ?? "");
    const desc = (descricaoLancamento?.value || "").trim();

    if (!categoria) return alert("Selecione uma categoria.");
    if (Number.isNaN(valor)) return alert("Valor inválido.");

    adicionarLancamento(ano, tipo, mes, categoria, valor, desc);

    // Limpa somente campos do form
    formLancamento.reset();
    if (tipoLancamento) tipoLancamento.value = "ganho";
    atualizarCategoriasForm();

    atualizarAnoAtual();
  });
}

if (yearSelect) {
  yearSelect.addEventListener("change", () => {
    atualizarAnoAtual();
  });
}

if (btnAddYear) {
  btnAddYear.addEventListener("click", () => {
    const novoAno = prompt("Digite o ano (ex.: 2026):", (new Date().getFullYear()).toString());
    if (!novoAno) return;

    const anoLimpo = novoAno.trim();
    if (!/^\d{4}$/.test(anoLimpo)) {
      alert("Ano inválido. Use 4 dígitos (ex.: 2026).");
      return;
    }

    garantirAno(anoLimpo);
    popularSelectAnos();
    yearSelect.value = anoLimpo;
    salvarFirebase();
    atualizarAnoAtual();
  });
}

if (filtroTipo) {
  filtroTipo.addEventListener("change", () => {
    atualizarOpcoesFiltroCategoria();
    atualizarAnoAtual();
  });
}
if (filtroMes) filtroMes.addEventListener("change", () => atualizarAnoAtual());
if (filtroCategoria) filtroCategoria.addEventListener("change", () => atualizarAnoAtual());

if (btnLimparFiltros) {
  btnLimparFiltros.addEventListener("click", () => {
    if (filtroTipo) filtroTipo.value = "todos";
    if (filtroMes) filtroMes.value = "todos";
    atualizarOpcoesFiltroCategoria();
    atualizarAnoAtual();
  });
}

// ===== Init =====
document.addEventListener("DOMContentLoaded", () => {
  const anoAtual = new Date().getFullYear().toString();
  garantirAno(anoAtual);

  popularSelectAnos();
  atualizarCategoriasForm();
  atualizarOpcoesFiltroCategoria();
  atualizarAnoAtual();

  if (authFirebase) {
    authFirebase.onAuthStateChanged(user => {
      if (user) {
        currentUserUid = user.uid;
        carregarDadosDoFirebase();
      }
    });
  } else {
    // Sem Firebase (modo local): já funciona, só não salva na nuvem
    firebaseCarregado = true;
  }
});
