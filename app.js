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
  if (typeof v !== "string") return NaN;

  let s = v.trim();
  if (!s) return NaN;

  // Remove espaços e caracteres estranhos, mantendo só números e separadores
  s = s.replace(/\s+/g, "");
  s = s.replace(/[^0-9,.\-]/g, "");

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  // Se tiver vírgula e ponto, decide qual é o separador decimal pelo ÚLTIMO que aparecer
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      // Formato tipo: 1.234,56 (pt-BR)
      s = s.replace(/\./g, "");
      s = s.replace(/,/g, ".");
    } else {
      // Formato tipo: 1,234.56 (en-US)
      s = s.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    // Só vírgula: 1234,56
    s = s.replace(/\./g, "");
    s = s.replace(/,/g, ".");
  } else {
    // Só ponto (ou nada): 1234.56 (ou 1234)
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
  const out = {};
  dadosPorAno[ano].lancamentos.forEach(l => {
    if (l.tipo !== "gasto") return;
    const cat = l.categoria || "Sem categoria";
    const v = Number(l.valor) || 0;
    out[cat] = (out[cat] || 0) + v;
  });
  return out;
}

// ===== UI: categorias =====
function atualizarCategoriasForm() {
  if (!categoriaLancamento || !tipoLancamento) return;

  const tipo = tipoLancamento.value;
  const cats = tipo === "ganho" ? categoriasGanhos : categoriasGastos;

  categoriaLancamento.innerHTML = "";
  cats.forEach(c => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    categoriaLancamento.appendChild(o);
  });
}

function atualizarOpcoesFiltroCategoria() {
  if (!filtroCategoria || !filtroTipo) return;

  const tipo = filtroTipo.value;
  let cats = [];

  if (tipo === "ganho") cats = categoriasGanhos;
  else if (tipo === "gasto") cats = categoriasGastos;
  else cats = [...new Set([...categoriasGanhos, ...categoriasGastos])];

  filtroCategoria.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "todos";
  optAll.textContent = "Todas";
  filtroCategoria.appendChild(optAll);

  cats.forEach(c => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    filtroCategoria.appendChild(o);
  });
}

// ===== UI: resumo =====
function preencherResumo(ano) {
  const { ganhos, gastos } = calcularTotaisMes(ano);

  const totalGanhosAno = ganhos.reduce((a, b) => a + b, 0);
  const totalGastosAno = gastos.reduce((a, b) => a + b, 0);
  const totalSaldoAno = totalGanhosAno - totalGastosAno;

  const mediaGanhosMes = totalGanhosAno / 12;
  const mediaGastosMes = totalGastosAno / 12;
  const mediaSaldoMes = totalSaldoAno / 12;

  const elGanhosAno = document.getElementById("resumoGanhosAno");
  const elGastosAno = document.getElementById("resumoGastosAno");
  const elSaldoAno = document.getElementById("resumoSaldoAno");

  const elGanhosMes = document.getElementById("resumoGanhosMes");
  const elGastosMes = document.getElementById("resumoGastosMes");
  const elSaldoMes = document.getElementById("resumoSaldoMes");

  if (elGanhosAno) elGanhosAno.textContent = formatarMoeda(totalGanhosAno);
  if (elGastosAno) elGastosAno.textContent = formatarMoeda(totalGastosAno);
  if (elSaldoAno) {
    elSaldoAno.textContent = formatarMoeda(totalSaldoAno);
    elSaldoAno.classList.remove("positivo", "negativo");
    if (totalSaldoAno > 0) elSaldoAno.classList.add("positivo");
    if (totalSaldoAno < 0) elSaldoAno.classList.add("negativo");
  }

  if (elGanhosMes) elGanhosMes.textContent = `Média mensal: ${formatarMoeda(mediaGanhosMes)}`;
  if (elGastosMes) elGastosMes.textContent = `Média mensal: ${formatarMoeda(mediaGastosMes)}`;
  if (elSaldoMes) elSaldoMes.textContent = `Média mensal: ${formatarMoeda(mediaSaldoMes)}`;

  if (tabelaResumo) {
    tabelaResumo.innerHTML = "";

    const trGanhos = document.createElement("tr");
    trGanhos.innerHTML = `<td class="badge badge-ganho">Ganhos</td>` + ganhos.map(v => `<td>${formatarMoeda(v)}</td>`).join("");
    tabelaResumo.appendChild(trGanhos);

    const trGastos = document.createElement("tr");
    trGastos.innerHTML = `<td class="badge badge-gasto">Gastos</td>` + gastos.map(v => `<td>${formatarMoeda(v)}</td>`).join("");
    tabelaResumo.appendChild(trGastos);

    const trSaldo = document.createElement("tr");
    trSaldo.innerHTML = `<td class="badge">Saldo</td>` + ganhos.map((v, i) => {
      const s = v - gastos[i];
      const cls = s > 0 ? "saldo-positivo" : (s < 0 ? "saldo-negativo" : "");
      return `<td class="${cls}">${formatarMoeda(s)}</td>`;
    }).join("");
    tabelaResumo.appendChild(trSaldo);
  }
}

// ===== UI: tabela lançamentos =====
function renderTabelaLancamentos(ano) {
  if (!tabelaLancamentos) return;
  garantirAno(ano);

  const tipo = filtroTipo?.value || "todos";
  const mes = filtroMes?.value || "todos";
  const cat = filtroCategoria?.value || "todos";

  let lista = [...dadosPorAno[ano].lancamentos];

  if (tipo !== "todos") lista = lista.filter(l => l.tipo === tipo);
  if (mes !== "todos") lista = lista.filter(l => String(l.mes) === String(mes));
  if (cat !== "todos") lista = lista.filter(l => l.categoria === cat);

  // Ordena por mês e tipo
  lista.sort((a, b) => {
    const ma = typeof a.mes === "number" ? a.mes : 0;
    const mb = typeof b.mes === "number" ? b.mes : 0;
    if (ma !== mb) return ma - mb;
    return (a.tipo || "").localeCompare(b.tipo || "");
  });

  tabelaLancamentos.innerHTML = "";

  if (lista.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6">Nenhum lançamento encontrado.</td>`;
    tabelaLancamentos.appendChild(tr);
    return;
  }

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
    const descricao = (descricaoLancamento?.value || "").trim();

    if (!categoria) {
      alert("Selecione uma categoria.");
      return;
    }
    if (Number.isNaN(valor) || valor < 0) {
      alert("Digite um valor válido (ex.: 83,30).");
      return;
    }

    adicionarLancamento(ano, tipo, mes, categoria, valor, descricao);
    atualizarAnoAtual();

    // limpa
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

if (filtroTipo) filtroTipo.addEventListener("change", () => {
  atualizarOpcoesFiltroCategoria();
  atualizarAnoAtual();
});
if (filtroMes) filtroMes.addEventListener("change", () => atualizarAnoAtual());
if (filtroCategoria) filtroCategoria.addEventListener("change", () => atualizarAnoAtual());

if (btnLimparFiltros) {
  btnLimparFiltros.addEventListener("click", () => {
    if (filtroTipo) filtroTipo.value = "todos";
    if (filtroMes) filtroMes.value = "todos";
    if (filtroCategoria) filtroCategoria.value = "todos";
    atualizarOpcoesFiltroCategoria();
    atualizarAnoAtual();
  });
}

// ===== Auth/Boot =====
if (authFirebase) {
  authFirebase.onAuthStateChanged(async (user) => {
    if (user) {
      currentUserUid = user.uid;
      await carregarDadosDoFirebase();
    }
  });
}

// Boot UI
atualizarCategoriasForm();
atualizarOpcoesFiltroCategoria();
popularSelectAnos();
atualizarAnoAtual();
