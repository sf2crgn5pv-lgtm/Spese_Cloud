
/* ==========================================
   PAOLO SPESE - GESTIONE CONTI
   Versione 0.3
   ========================================== */

const ACCOUNTS_STORAGE_KEY = "paolo-spese-accounts";

const DEFAULT_ACCOUNTS = [
    {
        id: "conto-principale",
        name: "Conto corrente principale",
        type: "bank",
        balance: 0
    },
    {
        id: "conto-secondario",
        name: "Conto corrente secondario",
        type: "bank",
        balance: 0
    },
    {
        id: "carta-prepagata",
        name: "Carta prepagata",
        type: "card",
        balance: 0
    },
    {
        id: "contanti",
        name: "Contanti",
        type: "cash",
        balance: 0
    }
];

function loadAccounts() {
    const saved = localStorage.getItem(ACCOUNTS_STORAGE_KEY);

    if (saved) {
        return JSON.parse(saved);
    }

    localStorage.setItem(
        ACCOUNTS_STORAGE_KEY,
        JSON.stringify(DEFAULT_ACCOUNTS)
    );

    return [...DEFAULT_ACCOUNTS];
}

function saveAccounts(accounts) {
    localStorage.setItem(
        ACCOUNTS_STORAGE_KEY,
        JSON.stringify(accounts)
    );
}

function addAccount(name, type, initialBalance = 0) {
    const accounts = loadAccounts();

    const account = {
        id: "account-" + Date.now(),
        name: name,
        type: type,
        balance: Number(initialBalance)
    };

    accounts.push(account);
    saveAccounts(accounts);

    return account;
}

function deleteAccount(id) {
    let accounts = loadAccounts();

    accounts = accounts.filter(
        account => account.id !== id
    );

    saveAccounts(accounts);
}

function updateAccountBalance(id, amount) {
    const accounts = loadAccounts();

    const account = accounts.find(
        item => item.id === id
    );

    if (!account) return;

    account.balance += Number(amount);

    saveAccounts(accounts);
}


/* ==========================================
   VISUALIZZAZIONE E GESTIONE CONTI
   ========================================== */

async function renderAccounts() {
    const container = document.getElementById("accounts-list");
    if (!container) return;

    const accounts = loadAccounts();
    container.innerHTML = "";

    const euro = new Intl.NumberFormat("it-IT", {
        style: "currency",
        currency: "EUR"
    });

    let movements = [];
    try {
        if (typeof allMovements === "function" && typeof db !== "undefined" && db) {
            movements = await allMovements();
        }
    } catch (error) {
        console.warn("Impossibile calcolare i saldi dai movimenti:", error);
    }

    const types = {
        bank: "Conto corrente",
        card: "Carta",
        cash: "Contanti"
    };

    accounts.forEach((account, index) => {
        const card = document.createElement("article");
        card.className = "account-card";

        const heading = document.createElement("div");
        heading.className = "account-card-heading";

        const identity = document.createElement("div");
        identity.className = "account-card-identity";

        const name = document.createElement("h3");
        name.textContent = account.name;

        const type = document.createElement("span");
        type.className = "account-type";
        type.textContent = types[account.type] || "Altro";

        identity.append(name, type);

        const orderControls = document.createElement("div");
        orderControls.className = "account-order-controls";

        const up = document.createElement("button");
        up.type = "button";
        up.className = "account-order-button";
        up.textContent = "↑";
        up.title = "Sposta conto in alto";
        up.setAttribute("aria-label", "Sposta " + account.name + " in alto");
        up.disabled = index === 0;
        up.addEventListener("click", () => moveAccount(account.id, -1));

        const down = document.createElement("button");
        down.type = "button";
        down.className = "account-order-button";
        down.textContent = "↓";
        down.title = "Sposta conto in basso";
        down.setAttribute("aria-label", "Sposta " + account.name + " in basso");
        down.disabled = index === accounts.length - 1;
        down.addEventListener("click", () => moveAccount(account.id, 1));

        orderControls.append(up, down);
        heading.append(identity, orderControls);

        const balanceDate = account.balanceDate || "";
        const openingBalance = Number(account.balance || 0);
        const accountMovements = movements.filter(item =>
            item.accountId === account.id &&
            movementIsAccounted(item) &&
            (!balanceDate || String(item.date || "") > balanceDate)
        );
        const net = accountMovements.reduce((sum, item) =>
            sum + (item.type === "income" ? Number(item.amount || 0) : -Number(item.amount || 0)), 0
        );
        const currentBalance = openingBalance + net;

        const balanceLabel = document.createElement("p");
        balanceLabel.className = "account-balance-label";
        balanceLabel.textContent = balanceDate ? "Saldo aggiornato" : "Saldo provvisorio";

        const balance = document.createElement("strong");
        balance.className = "account-current-balance";
        balance.textContent = euro.format(currentBalance);

        const label = document.createElement("label");
        label.className = "account-balance-input-label";
        label.textContent = "Imposta saldo reale attuale (€)";

        const input = document.createElement("input");
        input.type = "number";
        input.step = "0.01";
        input.inputMode = "decimal";
        input.value = openingBalance.toFixed(2);
        input.className = "account-balance-input";
        label.appendChild(input);

        const actions = document.createElement("div");
        actions.className = "account-card-actions";

        const save = document.createElement("button");
        save.type = "button";
        save.className = "account-save-button";
        save.textContent = "Salva saldo reale";
        save.addEventListener("click", () => {
            const value = Number(String(input.value).replace(",", "."));
            if (!Number.isFinite(value)) {
                alert("Inserisci un saldo valido.");
                return;
            }

            const latest = loadAccounts();
            const target = latest.find(item => item.id === account.id);
            if (!target) return;

            target.balance = value;
            target.balanceDate = new Date().toISOString().slice(0, 10);
            saveAccounts(latest);
            renderAccounts();
            alert("Saldo reale salvato. Da domani verranno conteggiati i movimenti successivi contabilizzati.");
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "account-delete-button";
        remove.textContent = "Elimina conto";
        remove.addEventListener("click", () => {
            if (confirm("Vuoi eliminare il conto " + account.name + "?")) {
                deleteAccount(account.id);
                renderAccounts();
            }
        });

        actions.append(save, remove);

        const hint = document.createElement("small");
        hint.className = "account-card-hint";
        hint.textContent = balanceDate
            ? "Movimenti contabilizzati successivi alla data di aggiornamento inclusi: " + accountMovements.length
            : "Inserisci il saldo che leggi oggi dalla banca o dall'app. I movimenti storici non saranno sommati dopo la conferma.";

        card.append(heading, balanceLabel, balance, label, actions, hint);
        container.appendChild(card);
    });
}

function moveAccount(accountId, direction) {
    const accounts = loadAccounts();
    const currentIndex = accounts.findIndex(account => account.id === accountId);
    const targetIndex = currentIndex + direction;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= accounts.length) return;

    [accounts[currentIndex], accounts[targetIndex]] =
        [accounts[targetIndex], accounts[currentIndex]];

    saveAccounts(accounts);
    renderAccounts();
}

/* ==========================================
   INSERIMENTO NUOVO CONTO
   ========================================== */

function initializeAccounts() {

    const form = document.getElementById("account-form");

    if (!form) return;

    form.addEventListener("submit", function(event) {

        event.preventDefault();

        const name = document.getElementById("account-name").value.trim();

        const type = document.getElementById("account-type").value;

        const balance = Number(
            document.getElementById("account-balance").value
        );

        if (!name) {
            alert("Inserisci il nome del conto.");
            return;
        }

        if (!Number.isFinite(balance)) {
            alert("Inserisci un saldo iniziale valido.");
            return;
        }

        addAccount(name, type, balance);

        form.reset();

        document.getElementById("account-balance").value = 0;

        renderAccounts();

        alert("Conto aggiunto correttamente.");

    });

    renderAccounts();

}


/* ==========================================
   AVVIO GESTIONE CONTI
   ========================================== */

document.addEventListener(
    "DOMContentLoaded",
    initializeAccounts
);


/* ==========================================
   NAVIGAZIONE PAOLO SPESE
   ========================================== */


function showPage(page) {

    const pages = ["dashboard", "accounts", "movements", "statistics", "account-analysis", "budget", "settings"];
    if (!pages.includes(page)) return;

    // Nasconde tutte le sezioni e mostra solo quelle della pagina scelta.
    document.querySelectorAll("main > section, #page-accounts, #page-budget").forEach(section => {
        section.style.display = "none";
    });

    const idsByPage = {
        dashboard: ["page-dashboard"],
        accounts: ["page-accounts"],
        movements: ["page-movements-form", "page-movements-list"],
        statistics: ["page-statistics"],
        "account-analysis": ["page-account-analysis"],
        budget: ["page-budget"],
        settings: ["page-settings"]
    };

    idsByPage[page].forEach(id => {
        const section = document.getElementById(id);
        if (section) section.style.display = "";
    });

    document.querySelectorAll("#main-navigation button").forEach(button => {
        button.classList.remove("active");
        if (button.getAttribute("onclick") === "showPage('" + page + "')") {
            button.classList.add("active");
        }
    });
    if (page === "account-analysis" && typeof renderAccountAnalysis === "function" && typeof db !== "undefined" && db) {
        renderAccountAnalysis();
    }
    if (page === "budget") {
        renderBudget();
    }
}



/* Apertura iniziale sulla dashboard */

document.addEventListener("DOMContentLoaded", function() {
    showPage("dashboard");
});
