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

const categoriasFixasGanhos = ["Salário", "13º salário", "Férias"];
const categoriasFixasGastos = [
  "Aluguel",
  "Despesas fixas",
  "Cartões de crédito",
  "Saúde",
  "Educação",
  "Impostos"
];

const mesesLabels = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez"
];

// ano -> { lancamentos: [ {id,tipo,mes,categoria,valor,descricao} ] }
const dadosPorAno = {};
let nextId = 1;

// controle: ano -> { "tipo|categoria": true } já perguntado
const perguntasFixasPorAno = {};

// ===== Firebase (Auth + Firestore) =====
let authFirebase = null;
let db = null;
let currentUserUid = null;
let saveTimeoutId = null;

try {
  if (typeof firebase !== "undefined" && firebase.apps && firebase.apps.length > 0) {
    authFirebase = firebase.auth();
    db = firebase.firestore();
  } else {
    console.warn("Firebase não inicializado em app.js.");
  }
} catch (e) {
  console.error("Erro ao acessar Firebase em app.js:", e);
}

// Salva os dados do usuário logado no Firestore (debounce)
function dispararSaveFirebase() {
  if (!db || !currentUserUid) return;

  if (saveTimeoutId) clearTimeout(saveTimeoutId);

  saveTimeoutId = setTimeout(async () => {
    try {
      await db
        .collection("usuarios")
        .doc(currentUserUid)
        .set(
          {
            dadosPorAno,
            perguntasFixasPorAno,
            nextId
          },
          { merge: true }
        );
      console.log("Dados salvos no Firebase.");
    } catch (e) {
      console.error("Erro ao salvar dados no Firebase:", e);
    }
  }, 800);
}

// Carrega dados do Firestore para o usuário logado
async function carregarDadosDoFirebase() {
  if (!db || !currentUserUid) return;

  try {
    const docRef = db.collection("usuarios").doc(currentUserUid);
    const snap = await docRef.get();

    if (snap.exists) {
      const data = snap.data() || {};

      // Limpa objetos atuais
      Object.keys(dadosPorAno).forEach((k) => delete dadosPorAno[k]);
      Object.keys(perguntasFixasPorAno).forEach((k) => delete perguntasFixasPorAno[k]);

      if (data.dadosPorAno && typeof data.dadosPorAno === "object") {
        Object.assign(dadosPorAno, data.dadosPorAno);
      }

      if (data.perguntasFixasPorAno && typeof data.perguntasFixasPorAno === "object") {
        Object.assign(perguntasFixasPorAno, data.perguntasFixasPorAno);
      }

      if (typeof data.nextId === "number") {
        nextId = data.nextId;
      }

      console.log("Dados carregados do Firebase.");
    } else {
      console.log("Nenhum dado salvo ainda para este usuário.");
    }
  } catch (e) {
    console.error("Erro ao carregar dados do Firebase:", e);
  }

  // Atualiza UI com o que estiver em dadosPorAno
  const anos = Object.keys(dadosPorAno);
  if (!anos.length) {
    const anoAtual = new Date().getFullYear();
    garantirAno(anoAtual);
    popularSelectAnos(String(anoAtual));
  } else {
    const ordenados = anos.map((n) => parseInt(n, 10)).sort((a, b) => a - b);
    const ultimo = String(ordenados[ordenados.length - 1]);
    popularSelectAnos(ultimo);
  }

  atualizarAnoAtual();
}

// ===== Utilitários =====
function formatarMoeda(valor) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function garantirAno(ano) {
  const chave = String(ano);
  if (!dadosPorAno[chave]) {
    dadosPorAno[chave] = { lancamentos: [] };
  }
  if (!perguntasFixasPorAno[chave]) {
    perguntasFixasPorAno[chave] = {};
  }
}

// cria/atualiza um lançamento único (tipo+mes+categoria)
function upsertLancamento(ano, tipo, mes, categoria, valor, descricao) {
  garantirAno(ano);
  const lista = dadosPorAno[ano].lancamentos;
  const existente = lista.find(
    (l) => l.tipo === tipo && l.mes === mes && l.categoria === categoria
  );
  if (existente) {
    existente.valor = valor;
    existente.descricao = descricao;
  } else {
    lista.push({
      id: nextId++,
      tipo,
      mes,
      categoria,
      valor,
      descricao
    });
  }

  dispararSaveFirebase();
}

// ===== Modal de confirmação "Sim" / "Não" =====
function showYesNoDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";

    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-title">Aplicar para o ano todo?</div>
        <div class="confirm-message">${message}</div>
        <div class="confirm-buttons">
          <button class="btn-confirm-nao">Não</button>
          <button class="btn-confirm-sim">Sim</button>
        </div>
      </div>
    `;

    const btnNao = overlay.querySelector(".btn-confirm-nao");
    const btnSim = overlay.querySelector(".btn-confirm-sim");

    btnNao.addEventListener("click", () => {
      document.body.removeChild(overlay);
      resolve(false);
    });

    btnSim.addEventListener("click", () => {
      document.body.removeChild(overlay);
      resolve(true);
    });

    document.body.appendChild(overlay);
  });
}

function jaPerguntouFixo(ano, tipo, categoria) {
  garantirAno(ano);
  const chave = `${tipo}|${categoria}`;
  return !!perguntasFixasPorAno[ano][chave];
}

function marcarPerguntadoFixo(ano, tipo, categoria) {
  garantirAno(ano);
  const chave = `${tipo}|${categoria}`;
  perguntasFixasPorAno[ano][chave] = true;
}

// ===== Cálculos =====
function calcularTotaisMes(ano) {
  garantirAno(ano);
  const lancamentos = dadosPorAno[ano].lancamentos || [];
  const ganhosMensais = Array(12).fill(0);
  const gastosMensais = Array(12).fill(0);

  lancamentos.forEach((l) => {
    if (l.tipo === "ganho") ganhosMensais[l.mes] += l.valor;
    else gastosMensais[l.mes] += l.valor;
  });

  return { ganhosMensais, gastosMensais };
}

function calcularTotaisGastosPorCategoria(ano) {
  garantirAno(ano);
  const lancamentos = dadosPorAno[ano].lancamentos || [];
  const mapa = {};
  lancamentos.forEach((l) => {
    if (l.tipo !== "gasto") return;
    mapa[l.categoria] = (mapa[l.categoria] || 0) + l.valor;
  });
  return mapa;
}

// ===== Resumo mensal =====
function preencherTabelaResumo(ano) {
  const { ganhosMensais, gastosMensais } = calcularTotaisMes(ano);
  const tbody = document.getElementById("tabelaResumo");
  tbody.innerHTML = "";

  const linhaGanhos = document.createElement("tr");
  const linhaGastos = document.createElement("tr");
  const linhaSaldo = document.createElement("tr");

  linhaGanhos.innerHTML = '<td><strong>Ganhos</strong></td>';
  linhaGastos.innerHTML = '<td><strong>Gastos</strong></td>';
  linhaSaldo.innerHTML = '<td><strong>Saldo</strong></td>';

  ganhosMensais.forEach((ganho, idx) => {
    const gasto = gastosMensais[idx];
    const saldo = ganho - gasto;

    const tdG = document.createElement("td");
    tdG.textContent = formatarMoeda(ganho);
    linhaGanhos.appendChild(tdG);

    const tdGt = document.createElement("td");
    tdGt.textContent = formatarMoeda(gasto);
    linhaGastos.appendChild(tdGt);

    const tdS = document.createElement("td");
    tdS.textContent = formatarMoeda(saldo);
    tdS.classList.add(saldo >= 0 ? "saldo-positivo" : "saldo-negativo");
    linhaSaldo.appendChild(tdS);
  });

  tbody.appendChild(linhaGanhos);
  tbody.appendChild(linhaGastos);
  tbody.appendChild(linhaSaldo);

  const totalGanhosAno = ganhosMensais.reduce((a, b) => a + b, 0);
  const totalGastosAno = gastosMensais.reduce((a, b) => a + b, 0);
  const totalSaldoAno = totalGanhosAno - totalGastosAno;

  document.getElementById("resumoGanhosAno").textContent =
    formatarMoeda(totalGanhosAno);
  document.getElementById("resumoGastosAno").textContent =
    formatarMoeda(totalGastosAno);
  document.getElementById("resumoSaldoAno").textContent =
    formatarMoeda(totalSaldoAno);

  document.getElementById("resumoGanhosMes").textContent =
    `Média mensal: ${formatarMoeda(totalGanhosAno / 12)}`;
  document.getElementById("resumoGastosMes").textContent =
    `Média mensal: ${formatarMoeda(totalGastosAno / 12)}`;
  document.getElementById("resumoSaldoMes").textContent =
    `Média mensal: ${formatarMoeda(totalSaldoAno / 12)}`;
}

// ===== Tabela de lançamentos (com filtros) =====
function preencherTabelaLancamentos(ano) {
  garantirAno(ano);
  const tbody = document.getElementById("tabelaLancamentos");
  tbody.innerHTML = "";

  const lista = dadosPorAno[ano].lancamentos || [];

  const filtroTipoEl = document.getElementById("filtroTipo");
  const filtroMesEl = document.getElementById("filtroMes");
  const filtroCatEl = document.getElementById("filtroCategoria");

  const tipoFiltro = filtroTipoEl ? filtroTipoEl.value : "todos";
  const mesFiltro = filtroMesEl ? filtroMesEl.value : "todos";
  const catFiltro = filtroCatEl ? filtroCatEl.value : "todas";

  const filtrados = lista.filter((l) => {
    const okTipo = tipoFiltro === "todos" || l.tipo === tipoFiltro;
    const okMes =
      mesFiltro === "todos" || l.mes === parseInt(mesFiltro, 10);
    const okCat =
      catFiltro === "todas" || l.categoria === catFiltro;
    return okTipo && okMes && okCat;
  });

  if (!filtrados.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "Nenhum lançamento com os filtros atuais.";
    td.style.textAlign = "center";
    td.style.color = "#9ca3af";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  filtrados
    .slice()
    .sort((a, b) => a.mes - b.mes || a.id - b.id)
    .forEach((l) => {
      const tr = document.createElement("tr");

      const tdTipo = document.createElement("td");
      const spanTipo = document.createElement("span");
      spanTipo.className =
        "badge " + (l.tipo === "ganho" ? "badge-ganho" : "badge-gasto");
      spanTipo.textContent = l.tipo === "ganho" ? "Ganho" : "Gasto";
      tdTipo.appendChild(spanTipo);
      tr.appendChild(tdTipo);

      const tdMes = document.createElement("td");
      tdMes.textContent = mesesLabels[l.mes];
      tr.appendChild(tdMes);

      const tdCat = document.createElement("td");
      tdCat.textContent = l.categoria;
      tr.appendChild(tdCat);

      const tdValor = document.createElement("td");
      tdValor.textContent = formatarMoeda(l.valor);
      tr.appendChild(tdValor);

      const tdDesc = document.createElement("td");
      tdDesc.textContent = l.descricao || "";
      tr.appendChild(tdDesc);

      const tdAcoes = document.createElement("td");
      const btnEditar = document.createElement("button");
      btnEditar.textContent = "Editar";
      btnEditar.className = "btn-small";
      btnEditar.dataset.action = "editar";
      btnEditar.dataset.id = String(l.id);

      const btnExcluir = document.createElement("button");
      btnExcluir.textContent = "Excluir";
      btnExcluir.className = "btn-small";
      btnExcluir.style.marginLeft = "0.35rem";
      btnExcluir.dataset.action = "excluir";
      btnExcluir.dataset.id = String(l.id);

      tdAcoes.appendChild(btnEditar);
      tdAcoes.appendChild(btnExcluir);
      tr.appendChild(tdAcoes);

      tbody.appendChild(tr);
    });
}

// ===== Gráficos =====
let barChartInstance = null;
let lineChartInstance = null;

function atualizarGraficos(ano) {
  const { ganhosMensais, gastosMensais } = calcularTotaisMes(ano);
  const mapaGastosCat = calcularTotaisGastosPorCategoria(ano);

  const barCtx = document
    .getElementById("barGastosCategorias")
    .getContext("2d");
  if (barChartInstance) barChartInstance.destroy();
  barChartInstance = new Chart(barCtx, {
    type: "bar",
    data: {
      labels: Object.keys(mapaGastosCat),
      datasets: [
        { label: "Gastos (R$ / ano)", data: Object.values(mapaGastosCat) }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: "#4b5563", font: { size: 11 } }
        }
      },
      scales: {
        x: {
          ticks: { color: "#6b7280", font: { size: 10 } },
          grid: { display: false }
        },
        y: {
          ticks: {
            color: "#6b7280",
            font: { size: 10 },
            callback: (val) =>
              val.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
                maximumFractionDigits: 0
              })
          },
          grid: { color: "#e5e7eb" }
        }
      }
    }
  });

  const lineCtx = document
    .getElementById("lineGanhosGastos")
    .getContext("2d");
  if (lineChartInstance) lineChartInstance.destroy();
  lineChartInstance = new Chart(lineCtx, {
    type: "line",
    data: {
      labels: mesesLabels,
      datasets: [
        { label: "Ganhos", data: ganhosMensais, tension: 0.3 },
        { label: "Gastos", data: gastosMensais, tension: 0.3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: "#4b5563", font: { size: 11 } }
        }
      },
      scales: {
        x: {
          ticks: { color: "#6b7280", font: { size: 10 } },
          grid: { display: false }
        },
        y: {
          ticks: {
            color: "#6b7280",
            font: { size: 10 },
            callback: (val) =>
              val.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
                maximumFractionDigits: 0
              })
          },
          grid: { color: "#e5e7eb" }
        }
      }
    }
  });

  document.getElementById("anoLegenda1").textContent = ano;
}

// ===== Formulário de lançamentos =====
function atualizarOpcoesCategoria() {
  const tipo = document.getElementById("tipoLancamento").value;
  const selectCat = document.getElementById("categoriaLancamento");
  selectCat.innerHTML = "";

  const lista = tipo === "ganho" ? categoriasGanhos : categoriasGastos;
  lista.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    selectCat.appendChild(opt);
  });
}

function configurarFormLancamento() {
  const form = document.getElementById("formLancamento");
  const yearSelect = document.getElementById("yearSelect");

  document
    .getElementById("tipoLancamento")
    .addEventListener("change", atualizarOpcoesCategoria);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ano = yearSelect.value;
    if (!ano) return;

    const tipo = document.getElementById("tipoLancamento").value;
    const mes = parseInt(
      document.getElementById("mesLancamento").value,
      10
    );
    const categoria =
      document.getElementById("categoriaLancamento").value;
    const valorStr =
      document.getElementById("valorLancamento").value;
    const desc =
      document.getElementById("descricaoLancamento").value.trim();

    let valor = parseFloat(valorStr.replace(",", "."));
    if (isNaN(valor) || valor < 0) {
      alert("Valor inválido.");
      return;
    }

    const ehFixa =
      (tipo === "ganho" &&
        categoriasFixasGanhos.includes(categoria)) ||
      (tipo === "gasto" &&
        categoriasFixasGastos.includes(categoria));

    // Só pergunta uma vez por ano para cada tipo+categoria fixa
    if (ehFixa && !jaPerguntouFixo(ano, tipo, categoria)) {
      const aplicarTodos = await showYesNoDialog(
        `Você quer aplicar este valor de "${categoria}" para todos os meses do ano ${ano}?`
      );
      marcarPerguntadoFixo(ano, tipo, categoria);

      if (aplicarTodos) {
        for (let m = 0; m < 12; m++) {
          upsertLancamento(ano, tipo, m, categoria, valor, desc);
        }
      } else {
        upsertLancamento(ano, tipo, mes, categoria, valor, desc);
      }
    } else {
      upsertLancamento(ano, tipo, mes, categoria, valor, desc);
    }

    form.reset();
    document.getElementById("tipoLancamento").value = "ganho";
    atualizarOpcoesCategoria();
    atualizarAnoAtual();
  });
}

// ===== Filtros de lançamentos =====
function preencherFiltroCategoria() {
  const filtroCatEl = document.getElementById("filtroCategoria");
  if (!filtroCatEl) return;

  filtroCatEl.innerHTML = "";
  const optTodas = document.createElement("option");
  optTodas.value = "todas";
  optTodas.textContent = "Todas";
  filtroCatEl.appendChild(optTodas);

  const todasCategorias = [...categoriasGanhos, ...categoriasGastos];
  todasCategorias.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    filtroCatEl.appendChild(opt);
  });
}

function configurarFiltrosLancamentos() {
  const filtroTipoEl = document.getElementById("filtroTipo");
  const filtroMesEl = document.getElementById("filtroMes");
  const filtroCatEl = document.getElementById("filtroCategoria");
  const btnLimpar = document.getElementById("btnLimparFiltros");
  const yearSelect = document.getElementById("yearSelect");

  const atualizar = () => {
    const ano = yearSelect.value;
    if (!ano) return;
    preencherTabelaLancamentos(ano);
  };

  filtroTipoEl.addEventListener("change", atualizar);
  filtroMesEl.addEventListener("change", atualizar);
  filtroCatEl.addEventListener("change", atualizar);

  btnLimpar.addEventListener("click", () => {
    filtroTipoEl.value = "todos";
    filtroMesEl.value = "todos";
    filtroCatEl.value = "todas";
    atualizar();
  });
}

// ===== Eventos da tabela de lançamentos (editar/excluir) =====
function configurarTabelaLancamentosEventos() {
  const tbody = document.getElementById("tabelaLancamentos");
  const yearSelect = document.getElementById("yearSelect");

  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const action = btn.dataset.action;
    const id = parseInt(btn.dataset.id, 10);
    const ano = yearSelect.value;
    if (!ano) return;
    garantirAno(ano);

    const lista = dadosPorAno[ano].lancamentos;
    const idx = lista.findIndex((l) => l.id === id);
    if (idx === -1) return;

    if (action === "editar") {
      const atual = lista[idx];
      const novoValorStr = prompt(
        `Novo valor para ${atual.categoria} / ${mesesLabels[atual.mes]}:`,
        atual.valor.toString().replace(".", ",")
      );
      if (novoValorStr === null) return;
      let novoValor = parseFloat(novoValorStr.replace(",", "."));
      if (isNaN(novoValor) || novoValor < 0) {
        alert("Valor inválido.");
        return;
      }
      lista[idx].valor = novoValor;
      dispararSaveFirebase();
      atualizarAnoAtual();
    }

    if (action === "excluir") {
      const ok = confirm("Deseja realmente excluir este lançamento?");
      if (!ok) return;
      lista.splice(idx, 1);
      dispararSaveFirebase();
      atualizarAnoAtual();
    }
  });
}

// ===== Anos =====
function atualizarAnoAtual() {
  const ano = document.getElementById("yearSelect").value;
  if (!ano) return;
  garantirAno(ano);
  preencherTabelaResumo(ano);
  preencherTabelaLancamentos(ano);
  atualizarGraficos(ano);
}

function popularSelectAnos(selectedAno = null) {
  const yearSelect = document.getElementById("yearSelect");
  yearSelect.innerHTML = "";

  const anos = Object.keys(dadosPorAno)
    .map((n) => parseInt(n, 10))
    .sort((a, b) => a - b);

  anos.forEach((ano) => {
    const opt = document.createElement("option");
    opt.value = String(ano);
    opt.textContent = String(ano);
    yearSelect.appendChild(opt);
  });

  if (!anos.length) return;

  const anoSelecionado = selectedAno || String(anos[anos.length - 1]);
  yearSelect.value = anoSelecionado;
}

function configurarBotaoAddAno() {
  const btnAddYear = document.getElementById("btnAddYear");
  const yearSelect = document.getElementById("yearSelect");

  btnAddYear.addEventListener("click", () => {
    const entrada = prompt("Digite o ano que deseja criar (ex.: 2026):");
    if (!entrada) return;
    const novoAno = parseInt(entrada, 10);
    if (isNaN(novoAno) || novoAno < 1900 || novoAno > 9999) {
      alert("Ano inválido.");
      return;
    }
    garantirAno(novoAno);
    popularSelectAnos(String(novoAno));
    dispararSaveFirebase();
    atualizarAnoAtual();
  });

  yearSelect.addEventListener("change", atualizarAnoAtual);
}

// ===== Init =====
document.addEventListener("DOMContentLoaded", () => {
  const anoAtual = new Date().getFullYear();
  garantirAno(anoAtual);
  popularSelectAnos(String(anoAtual));

  configurarFormLancamento();
  configurarTabelaLancamentosEventos();
  configurarBotaoAddAno();
  atualizarOpcoesCategoria();
  preencherFiltroCategoria();
  configurarFiltrosLancamentos();
  atualizarAnoAtual();

  // Integração com Firebase Auth para carregar dados do usuário
  if (authFirebase && db) {
    authFirebase.onAuthStateChanged((user) => {
      if (user) {
        currentUserUid = user.uid;
        carregarDadosDoFirebase();
      } else {
        currentUserUid = null;
        // app-auth.js já cuida do redirecionamento
      }
    });
  }
});
