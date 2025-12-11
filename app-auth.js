// app-auth.js
// Protege o painel (index.html) e faz logout

let auth = null;

try {
  if (typeof firebase !== "undefined" && firebase.apps && firebase.apps.length > 0) {
    auth = firebase.auth();
  } else {
    console.warn("Firebase não inicializado em app-auth.js");
  }
} catch (e) {
  console.error("Erro ao acessar firebase.auth() em app-auth.js:", e);
}

// Elementos de UI
const userEmailSpan = document.getElementById("userEmail");
const btnLogout = document.getElementById("btnLogout");

// Se não houver auth, já redireciona para a tela de acesso
if (!auth) {
  console.error("Firebase Auth indisponível. Redirecionando para acesso.html");
  window.location.href = "acesso.html";
} else {
  // Observa o estado de autenticação
  auth.onAuthStateChanged((user) => {
    if (user) {
      // Usuário logado → mostra o email
      if (userEmailSpan) {
        userEmailSpan.textContent = user.email || "";
      }
    } else {
      // Não tem usuário logado → mandar para login
      window.location.href = "acesso.html";
    }
  });
}

// Logout
if (btnLogout) {
  btnLogout.addEventListener("click", async () => {
    if (!auth) {
      window.location.href = "acesso.html";
      return;
    }

    try {
      await auth.signOut();
      window.location.href = "acesso.html";
    } catch (err) {
      console.error("Erro ao sair:", err);
      alert("Não foi possível sair. Tente de novo.");
    }
  });
}
