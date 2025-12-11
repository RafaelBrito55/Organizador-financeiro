// auth.js

// ===== Referências de elementos =====
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const forgotForm = document.getElementById("forgotForm");

const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");

const signupEmail = document.getElementById("signupEmail");
const signupPassword = document.getElementById("signupPassword");

const forgotEmail = document.getElementById("forgotEmail");

const loginError = document.getElementById("loginError");
const signupError = document.getElementById("signupError");
const forgotError = document.getElementById("forgotError");
const forgotSuccess = document.getElementById("forgotSuccess");

const btnLoginTab = document.getElementById("btnLoginTab");
const btnSignupTab = document.getElementById("btnSignupTab");

const btnForgotPassword = document.getElementById("btnForgotPassword");
const btnBackToLogin = document.getElementById("btnBackToLogin");

// ===== Instância do Firebase Auth =====
let auth = null;
try {
  if (typeof firebase !== "undefined" && firebase.apps && firebase.apps.length > 0) {
    auth = firebase.auth();
  } else {
    console.error("Firebase não foi inicializado corretamente antes de auth.js");
  }
} catch (e) {
  console.error("Erro ao obter instância do Firebase Auth:", e);
}

// ===== Funções auxiliares =====
function limparMensagens() {
  if (loginError) loginError.textContent = "";
  if (signupError) signupError.textContent = "";
  if (forgotError) forgotError.textContent = "";
  if (forgotSuccess) forgotSuccess.textContent = "";

  if (loginError) loginError.classList.remove("msg-success");
  if (signupError) signupError.classList.remove("msg-success");
  if (forgotSuccess) forgotSuccess.classList.remove("msg-error");
}

function traduzErroFirebase(err) {
  if (!err || !err.code) return "Erro desconhecido.";
  switch (err.code) {
    case "auth/user-not-found":
      return "Usuário não encontrado.";
    case "auth/wrong-password":
      return "Senha incorreta.";
    case "auth/invalid-email":
      return "Email inválido.";
    case "auth/email-already-in-use":
      return "Este email já está em uso.";
    case "auth/weak-password":
      return "Senha muito fraca. Use pelo menos 6 caracteres.";
    default:
      return err.message || err.code;
  }
}

// ===== Controle das abas (Entrar / Criar conta) =====
function mostrarLogin() {
  if (!loginForm || !signupForm || !forgotForm) return;

  limparMensagens();

  loginForm.classList.add("active");
  signupForm.classList.remove("active");
  forgotForm.classList.remove("active");

  if (btnLoginTab) btnLoginTab.classList.add("active");
  if (btnSignupTab) btnSignupTab.classList.remove("active");
}

function mostrarSignup() {
  if (!loginForm || !signupForm || !forgotForm) return;

  limparMensagens();

  loginForm.classList.remove("active");
  signupForm.classList.add("active");
  forgotForm.classList.remove("active");

  if (btnLoginTab) btnLoginTab.classList.remove("active");
  if (btnSignupTab) btnSignupTab.classList.add("active");
}

function mostrarForgot() {
  if (!loginForm || !signupForm || !forgotForm) return;

  limparMensagens();

  loginForm.classList.remove("active");
  signupForm.classList.remove("active");
  forgotForm.classList.add("active");

  if (btnLoginTab) btnLoginTab.classList.remove("active");
  if (btnSignupTab) btnSignupTab.classList.remove("active");
}

// Tabs
if (btnLoginTab) {
  btnLoginTab.addEventListener("click", (e) => {
    e.preventDefault();
    mostrarLogin();
  });
}

if (btnSignupTab) {
  btnSignupTab.addEventListener("click", (e) => {
    e.preventDefault();
    mostrarSignup();
  });
}

// Esqueci minha senha
if (btnForgotPassword) {
  btnForgotPassword.addEventListener("click", (e) => {
    e.preventDefault();
    mostrarForgot();
  });
}

// Voltar para login
if (btnBackToLogin) {
  btnBackToLogin.addEventListener("click", (e) => {
    e.preventDefault();
    mostrarLogin();
  });
}

// ===== SUBMIT: Login =====
if (loginForm && auth) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    limparMensagens();

    const email = loginEmail.value.trim();
    const senha = loginPassword.value;

    if (!email || !senha) {
      loginError.textContent = "Preencha email e senha.";
      return;
    }

    try {
      await auth.signInWithEmailAndPassword(email, senha);
      // Redireciona para o painel
      window.location.href = "index.html";
    } catch (err) {
      loginError.textContent = traduzErroFirebase(err);
    }
  });
}

// ===== SUBMIT: Criar conta =====
if (signupForm && auth) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    limparMensagens();

    const email = signupEmail.value.trim();
    const senha = signupPassword.value;

    if (!email || !senha) {
      signupError.textContent = "Preencha email e senha.";
      return;
    }

    try {
      await auth.createUserWithEmailAndPassword(email, senha);
      // Usuário criado e logado, manda pro painel
      window.location.href = "index.html";
    } catch (err) {
      signupError.textContent = traduzErroFirebase(err);
    }
  });
}

// ===== SUBMIT: Esqueci minha senha =====
if (forgotForm && auth) {
  forgotForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    limparMensagens();

    const email = forgotEmail.value.trim();
    if (!email) {
      forgotError.textContent = "Digite o email cadastrado.";
      return;
    }

    try {
      await auth.sendPasswordResetEmail(email);
      forgotSuccess.textContent = "Enviamos um link de redefinição para o seu email.";
    } catch (err) {
      forgotError.textContent = traduzErroFirebase(err);
    }
  });
}

// ===== Observa se o usuário está logado (opcional) =====
if (auth) {
  auth.onAuthStateChanged((user) => {
    // Se estiver na tela de login e já logado, manda para o painel
    if (user && window.location.pathname.includes("acesso.html")) {
      window.location.href = "index.html";
    }
  });
}
