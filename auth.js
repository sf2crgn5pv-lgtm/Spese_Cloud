(() => {
  const API = "/api";
  const FLAG = "paolo-spese-authenticated";
  const DEVICE = "paolo-spese-device-id";
  const $ = id => document.getElementById(id);

  function deviceId() {
    let id = localStorage.getItem(DEVICE);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE, id);
    }
    return id;
  }

  async function api(path, options = {}) {
    const response = await fetch(API + path, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Errore di accesso");
    return data;
  }

  function gate(message) {
    if ($("cloudAuthGate")) {
      $("cloudAuthGate").hidden = false;
      $("cloudAuthMessage").textContent = message;
      return;
    }

    const el = document.createElement("section");
    el.id = "cloudAuthGate";
    el.innerHTML = `
      <div class="cloud-auth-card">
        <div class="eyebrow">GESTIONE PERSONALE</div>
        <h1>Paolo Spese</h1>
        <p id="cloudAuthMessage"></p>
        <form id="cloudLoginForm">
          <label>Email<input id="cloudEmail" type="email" required></label>
          <label>Password<input id="cloudPassword" type="password"
            minlength="12" required></label>
          <button type="submit">Accedi</button>
        </form>
        <details class="cloud-register">
          <summary>Prima configurazione: crea il mio account</summary>
          <form id="cloudRegisterForm">
            <label>Codice di configurazione
              <input id="cloudSetupKey" type="password" required>
            </label>
            <label>Email
              <input id="cloudRegisterEmail" type="email" required>
            </label>
            <label>Password (almeno 12 caratteri)
              <input id="cloudRegisterPassword" type="password"
                minlength="12" required>
            </label>
            <button type="submit">Crea account personale</button>
          </form>
        </details>
      </div>`;
    document.body.appendChild(el);
    $("cloudAuthMessage").textContent = message;

    $("cloudLoginForm").addEventListener("submit", async e => {
      e.preventDefault();
      try {
        await api("/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: $("cloudEmail").value.trim(),
            password: $("cloudPassword").value,
            device_id: deviceId(),
            device_name: navigator.platform || "Dispositivo"
          })
        });
        localStorage.setItem(FLAG, "1");
        location.reload();
      } catch (err) {
        $("cloudAuthMessage").textContent = err.message;
      }
    });

    $("cloudRegisterForm").addEventListener("submit", async e => {
      e.preventDefault();
      try {
        await api("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            setup_key: $("cloudSetupKey").value,
            email: $("cloudRegisterEmail").value.trim(),
            password: $("cloudRegisterPassword").value
          })
        });
        $("cloudAuthMessage").textContent =
          "Account creato. Ora accedi.";
        $("cloudEmail").value = $("cloudRegisterEmail").value.trim();
        $("cloudPassword").value = $("cloudRegisterPassword").value;
        $("cloudRegisterForm").reset();
      } catch (err) {
        $("cloudAuthMessage").textContent = err.message;
      }
    });
  }

  async function verify() {
    try {
      await api("/auth/me");
      localStorage.setItem(FLAG, "1");
      return true;
    } catch (err) {
      if (!navigator.onLine && localStorage.getItem(FLAG) === "1")
        return true;
      if (err.message !== "Failed to fetch")
        localStorage.removeItem(FLAG);
      return false;
    }
  }

  window.PAOLO_AUTH_READY = (async () => {
    if (!(await verify())) {
      gate(navigator.onLine
        ? "Accedi per continuare."
        : "Collegati a Internet per il primo accesso.");
      return false;
    }
    return true;
  })();

  window.PAOLO_LOGOUT = async () => {
    try { await api("/auth/logout", {method:"POST",body:"{}"}); }
    catch (_) {}
    localStorage.removeItem(FLAG);
    location.reload();
  };

  document.addEventListener("DOMContentLoaded", () => {
    const btn = $("cloudLogoutBtn");
    if (btn) btn.addEventListener("click", window.PAOLO_LOGOUT);
  });
})();
