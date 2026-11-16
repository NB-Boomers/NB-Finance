// ============================================================================
// KONFIGURASI DEFAULT & STATE APLIKASI
// ============================================================================
const DEFAULT_CATEGORIES = {
  pemasukan: ["Gaji", "Bonus / THR", "Freelance", "Investasi", "Lainnya"],
  pengeluaran: [
    "Makanan & Minuman",
    "Transportasi",
    "Tagihan & Utilitas",
    "Belanja",
    "Cicilan",
    "Tabungan",
    "Hiburan",
    "Kesehatan",
    "Lainnya"
  ]
};

const DEFAULT_ACCOUNTS = ["BCA", "Mandiri", "Tunai", "QRIS"];

const STORAGE_KEYS = {
  CONFIG: "NBFinance_config_v2",
  TRANSACTIONS: "NBFinance_tx_cache_v2",
  CUSTOM_CATS: "NBFinance_custom_cats_v2",
  CUSTOM_ACCS: "NBFinance_custom_accs_v2"
};

let state = {
  config: { apiUrl: "", pin: "" },
  transactions: [],
  customCategories: { pemasukan: [], pengeluaran: [] },
  customAccounts: [],
  period: "month", // today | week | month | all | custom
  selectedAccount: "all", // filter rekening aktif di Dashboard & Grafik
  customStart: "",
  customEnd: "",
  activeTab: "dashboard",
  deleteTarget: null,
  charts: { account: null, category: null, trend: null, compare: null }
};

// ============================================================================
// INISIALISASI SAAT HALAMAN DIMUAT
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  lucide.createIcons();
  loadLocalState();
  bindEvents();
  registerServiceWorker();

  if (!state.config.apiUrl || !state.config.pin) {
    document.getElementById("setupScreen").classList.remove("hidden");
  } else {
    document.getElementById("appContainer").classList.remove("hidden");
    document.getElementById("setUrl").value = state.config.apiUrl;
    document.getElementById("setPin").value = state.config.pin;
    renderAll();
    syncFromSheets(true);
  }
});

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function loadLocalState() {
  try {
    const cfg = JSON.parse(localStorage.getItem(STORAGE_KEYS.CONFIG));
    if (cfg) state.config = cfg;

    const cachedTx = JSON.parse(localStorage.getItem(STORAGE_KEYS.TRANSACTIONS));
    if (Array.isArray(cachedTx)) state.transactions = cachedTx;

    const customCats = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_CATS));
    if (customCats) {
      state.customCategories = {
        pemasukan: customCats.pemasukan || [],
        pengeluaran: customCats.pengeluaran || []
      };
    }

    const customAccs = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_ACCS));
    if (Array.isArray(customAccs)) state.customAccounts = customAccs;
  } catch (e) {
    console.warn("Cache lokal kosong:", e);
  }
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(state.config));
  localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(state.transactions));
  localStorage.setItem(STORAGE_KEYS.CUSTOM_CATS, JSON.stringify(state.customCategories));
  localStorage.setItem(STORAGE_KEYS.CUSTOM_ACCS, JSON.stringify(state.customAccounts));
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================
function bindEvents() {
  document.getElementById("btnSaveSetup").addEventListener("click", handleInitialSetup);
  document.getElementById("btnSync").addEventListener("click", () => syncFromSheets(false));

  // Filter Periode
  document.querySelectorAll(".period-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-period");
      state.period = p;
      updatePeriodPills();

      const customBox = document.getElementById("customDateBox");
      if (p === "custom") {
        customBox.classList.remove("hidden");
        if (!document.getElementById("startDate").value) {
          const today = getTodayISO();
          document.getElementById("startDate").value = today.slice(0, 8) + "01";
          document.getElementById("endDate").value = today;
        }
      } else {
        customBox.classList.add("hidden");
        renderAll();
      }
    });
  });

  document.getElementById("btnClearAccountFilter").addEventListener("click", () => {
    state.selectedAccount = "all";
    renderAll();
  });

  document.getElementById("btnApplyCustom").addEventListener("click", () => {
    const s = document.getElementById("startDate").value;
    const e = document.getElementById("endDate").value;
    if (!s || !e) return showToast("Pilih tanggal mulai dan tanggal akhir.", "error");
    if (s > e) return showToast("Tanggal mulai tidak boleh melewati tanggal akhir.", "error");
    state.customStart = s;
    state.customEnd = e;
    renderAll();
  });

  // Auto-format Ribuan Rupiah saat mengetik nominal
  document.getElementById("txNominal").addEventListener("input", (e) => {
    const digits = e.target.value.replace(/[^\d]/g, "");
    e.target.value = digits ? Number(digits).toLocaleString("id-ID") : "";
  });

  // Search & Filter di Tab Riwayat
  document.getElementById("searchInput").addEventListener("input", renderHistory);
  document.getElementById("filterType").addEventListener("change", () => {
    populateHistoryFilters();
    renderHistory();
  });
  document.getElementById("filterAccount").addEventListener("change", renderHistory);
  document.getElementById("filterCategory").addEventListener("change", renderHistory);

  // Pengaturan Rekening, Kategori & Koneksi
  document.getElementById("btnAddAccSettings").addEventListener("click", () => {
    const val = document.getElementById("newAccInput").value.trim();
    if (!val) return showToast("Nama rekening tidak boleh kosong.", "error");
    addCustomAccount(val);
    document.getElementById("newAccInput").value = "";
  });

  document.getElementById("btnAddCatSettings").addEventListener("click", () => {
    const type = document.getElementById("catTypeSelect").value;
    const val = document.getElementById("newCatInput").value.trim();
    if (!val) return showToast("Nama kategori tidak boleh kosong.", "error");
    addCustomCategory(type, val);
    document.getElementById("newCatInput").value = "";
  });

  document.getElementById("btnUpdateSettings").addEventListener("click", () => {
    const url = document.getElementById("setUrl").value.trim();
    const pin = document.getElementById("setPin").value.trim();
    if (!url || !pin) return showToast("URL dan PIN wajib diisi.", "error");
    state.config = { apiUrl: url, pin: pin };
    saveLocalState();
    syncFromSheets(false);
  });

  document.getElementById("btnLogout").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEYS.CONFIG);
    location.reload();
  });
}

// ============================================================================
// KONEKSI & SINKRONISASI GOOGLE SHEETS
// ============================================================================
async function handleInitialSetup() {
  const url = document.getElementById("setupUrl").value.trim();
  const pin = document.getElementById("setupPin").value.trim();
  const errEl = document.getElementById("setupError");
  const btn = document.getElementById("btnSaveSetup");

  errEl.classList.add("hidden");
  if (!url.startsWith("https://script.google.com/")) {
    errEl.textContent = "URL harus diawali https://script.google.com/...";
    errEl.classList.remove("hidden");
    return;
  }
  if (!pin) {
    errEl.textContent = "PIN rahasia wajib diisi.";
    errEl.classList.remove("hidden");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span>Menghubungkan...</span>`;

  try {
    const res = await fetch(`${url}?action=ping&token=${encodeURIComponent(pin)}`);
    const json = await res.json();
    if (json.status !== "success") {
      throw new Error(json.message || "PIN tidak valid.");
    }

    state.config = { apiUrl: url, pin: pin };
    saveLocalState();

    document.getElementById("setupScreen").classList.add("hidden");
    document.getElementById("appContainer").classList.remove("hidden");
    document.getElementById("setUrl").value = url;
    document.getElementById("setPin").value = pin;
    await syncFromSheets(false);
  } catch (err) {
    errEl.textContent = "Gagal terhubung: " + err.message;
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>Hubungkan & Mulai</span>`;
  }
}

async function syncFromSheets(silent = false) {
  const icon = document.getElementById("syncIcon");
  icon.classList.add("animate-spin");

  try {
    const url = `${state.config.apiUrl}?action=getAll&token=${encodeURIComponent(state.config.pin)}`;
    const res = await fetch(url);
    const json = await res.json();

    if (json.status !== "success") {
      throw new Error(json.message || "Gagal mengambil data.");
    }

    state.transactions = (json.data || []).sort((a, b) => b.tanggal.localeCompare(a.tanggal));

    if (json.customCategories) {
      ["pemasukan", "pengeluaran"].forEach((jenis) => {
        const merged = new Set([...(state.customCategories[jenis] || []), ...(json.customCategories[jenis] || [])]);
        state.customCategories[jenis] = Array.from(merged);
      });
    }

    if (Array.isArray(json.customAccounts)) {
      const mergedAcc = new Set([...state.customAccounts, ...json.customAccounts]);
      state.customAccounts = Array.from(mergedAcc);
    }

    saveLocalState();
    renderAll();

    const now = new Date();
    const jam = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    document.getElementById("lastSyncText").textContent = `Tersinkron • ${jam}`;
    if (!silent) showToast("Data & saldo rekening tersinkron!", "success");
  } catch (err) {
    document.getElementById("lastSyncText").textContent = "Mode offline / gagal sync";
    if (!silent) showToast("Gagal sync: " + err.message, "error");
  } finally {
    icon.classList.remove("animate-spin");
  }
}

async function postToSheets(bodyObj) {
  const payload = { ...bodyObj, token: state.config.pin };
  const res = await fetch(state.config.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (json.status !== "success") {
    throw new Error(json.message || "Gagal menyimpan ke spreadsheet.");
  }
  return json;
}

// ============================================================================
// MASTER DATA: REKENING & KATEGORI DINAMIS
// ============================================================================
function getAllAccounts() {
  const fromTx = state.transactions.map((t) => t.rekening).filter(Boolean);
  return Array.from(new Set([...DEFAULT_ACCOUNTS, ...state.customAccounts, ...fromTx]));
}

function getCategoriesForType(jenis) {
  const base = DEFAULT_CATEGORIES[jenis] || [];
  const custom = state.customCategories[jenis] || [];
  const fromHistory = state.transactions
    .filter((t) => t.jenis === jenis)
    .map((t) => t.kategori);
  return Array.from(new Set([...base, ...custom, ...fromHistory]));
}

async function addCustomAccount(name) {
  const existing = getAllAccounts().map((a) => a.toLowerCase());
  if (existing.includes(name.toLowerCase())) {
    showToast("Rekening sudah tersedia.", "error");
    return name;
  }

  state.customAccounts.push(name);
  saveLocalState();
  renderAll();
  showToast(`Rekening "${name}" ditambahkan!`, "success");

  postToSheets({ action: "saveMeta", accounts: state.customAccounts }).catch(() => {});
  return name;
}

async function addCustomCategory(jenis, name) {
  const existing = getCategoriesForType(jenis).map((c) => c.toLowerCase());
  if (existing.includes(name.toLowerCase())) {
    showToast("Kategori sudah ada.", "error");
    return name;
  }

  state.customCategories[jenis].push(name);
  saveLocalState();
  renderCustomTags();
  populateHistoryFilters();
  showToast(`Kategori "${name}" ditambahkan!`, "success");

  postToSheets({ action: "saveMeta", categories: state.customCategories }).catch(() => {});
  return name;
}

function renderCustomTags() {
  const accContainer = document.getElementById("customAccList");
  const allAccs = getAllAccounts();
  accContainer.innerHTML = allAccs
    .map(
      (acc) => `
      <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
        ${escapeHtml(acc)}
      </span>`
    )
    .join("");

  const catContainer = document.getElementById("customCatList");
  const allCustom = [
    ...state.customCategories.pengeluaran.map((c) => ({ jenis: "pengeluaran", name: c })),
    ...state.customCategories.pemasukan.map((c) => ({ jenis: "pemasukan", name: c }))
  ];

  catContainer.innerHTML =
    allCustom.length === 0
      ? `<p class="text-[11px] text-slate-400">Belum ada kategori tambahan.</p>`
      : allCustom
          .map(
            (item) => `
          <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
            item.jenis === "pemasukan" ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"
          }">
            ${escapeHtml(item.name)}
          </span>`
          )
          .join("");
}

// ============================================================================
// KALKULASI SALDO AKUN & FILTER PERIODE
// ============================================================================
function computeAccountBalances() {
  const accounts = getAllAccounts();
  const map = {};
  accounts.forEach((acc) => {
    map[acc] = { name: acc, balance: 0, allIn: 0, allOut: 0, txCount: 0 };
  });

  // Saldo masing-masing rekening dihitung dari SELURUH transaksi historis
  state.transactions.forEach((tx) => {
    const acc = tx.rekening || "Tunai";
    if (!map[acc]) {
      map[acc] = { name: acc, balance: 0, allIn: 0, allOut: 0, txCount: 0 };
    }
    map[acc].txCount += 1;
    if (tx.jenis === "pemasukan") {
      map[acc].allIn += tx.nominal;
      map[acc].balance += tx.nominal;
    } else {
      map[acc].allOut += tx.nominal;
      map[acc].balance -= tx.nominal;
    }
  });

  return Object.values(map);
}

function getAccountBadgeStyle(accName) {
  const key = String(accName).toLowerCase();
  if (key.includes("bca")) return { icon: "landmark", bg: "bg-blue-50 text-blue-600", border: "border-blue-200" };
  if (key.includes("mandiri")) return { icon: "building-2", bg: "bg-amber-50 text-amber-600", border: "border-amber-200" };
  if (key.includes("tunai") || key.includes("cash")) return { icon: "banknote", bg: "bg-emerald-50 text-emerald-600", border: "border-emerald-200" };
  if (key.includes("qris")) return { icon: "qr-code", bg: "bg-purple-50 text-purple-600", border: "border-purple-200" };
  return { icon: "credit-card", bg: "bg-teal-50 text-teal-600", border: "border-teal-200" };
}

function toggleAccountFilter(accName) {
  state.selectedAccount = state.selectedAccount === accName ? "all" : accName;
  renderAll();
}

function getDateRange(period) {
  const todayStr = getTodayISO();
  const [y, m, d] = todayStr.split("-").map(Number);
  const todayDate = new Date(y, m - 1, d);

  if (period === "today") {
    return { start: todayStr, end: todayStr, label: "Hari Ini", days: 1 };
  }
  if (period === "week") {
    const dayOfWeek = todayDate.getDay() === 0 ? 7 : todayDate.getDay();
    const monday = new Date(y, m - 1, d - (dayOfWeek - 1));
    return { start: dateToISO(monday), end: todayStr, label: "Minggu Ini", days: dayOfWeek };
  }
  if (period === "month") {
    const firstDay = `${y}-${String(m).padStart(2, "0")}-01`;
    return { start: firstDay, end: todayStr, label: "Bulan Ini", days: d };
  }
  if (period === "custom" && state.customStart && state.customEnd) {
    const diffDays = Math.max(1, Math.round((new Date(state.customEnd) - new Date(state.customStart)) / 86400000) + 1);
    return { start: state.customStart, end: state.customEnd, label: "Periode Custom", days: diffDays };
  }
  return { start: "1970-01-01", end: "2999-12-31", label: "Semua Waktu", days: 30 };
}

function getPreviousPeriodRange(period) {
  const todayStr = getTodayISO();
  const [y, m, d] = todayStr.split("-").map(Number);

  if (period === "today") {
    const yest = dateToISO(new Date(y, m - 1, d - 1));
    return { start: yest, end: yest, label: "kemarin" };
  }
  if (period === "week") {
    const dow = new Date(y, m - 1, d).getDay();
    const dayOfWeek = dow === 0 ? 7 : dow;
    const prevMon = dateToISO(new Date(y, m - 1, d - (dayOfWeek - 1) - 7));
    const prevSun = dateToISO(new Date(y, m - 1, d - dayOfWeek));
    return { start: prevMon, end: prevSun, label: "minggu lalu" };
  }
  if (period === "month") {
    const prevStart = dateToISO(new Date(y, m - 2, 1));
    const prevEnd = dateToISO(new Date(y, m - 1, 0));
    return { start: prevStart, end: prevEnd, label: "bulan lalu" };
  }
  return null;
}

function getFilteredTransactions() {
  const range = getDateRange(state.period);
  return state.transactions.filter((t) => {
    const inDate = t.tanggal >= range.start && t.tanggal <= range.end;
    const inAcc = state.selectedAccount === "all" || (t.rekening || "Tunai") === state.selectedAccount;
    return inDate && inAcc;
  });
}

// ============================================================================
// RENDER DASHBOARD, KARTU SALDO REKENING, INSIGHT, RIWAYAT & GRAFIK
// ============================================================================
function renderAll() {
  updatePeriodPills();
  renderAccountCards();
  renderDashboard();
  renderCharts();
  populateHistoryFilters();
  renderHistory();
  renderCustomTags();
}

function updatePeriodPills() {
  document.querySelectorAll(".period-pill").forEach((btn) => {
    const active = btn.getAttribute("data-period") === state.period;
    btn.className = active
      ? "period-pill px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition accent-gradient text-white shadow-sm"
      : "period-pill px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition bg-white text-slate-600 border border-slate-200";
  });

  const banner = document.getElementById("accountFilterBanner");
  if (state.selectedAccount !== "all") {
    banner.classList.remove("hidden");
    document.getElementById("activeAccountFilterName").textContent = state.selectedAccount;
  } else {
    banner.classList.add("hidden");
  }
}

function renderAccountCards() {
  const accStats = computeAccountBalances();
  const totalAllAccounts = accStats.reduce((sum, a) => sum + a.balance, 0);
  document.getElementById("totalAllAccountsText").textContent = `Total Aset: ${formatRupiah(totalAllAccounts)}`;

  const row = document.getElementById("accountCardsRow");
  row.innerHTML = accStats
    .map((acc) => {
      const style = getAccountBadgeStyle(acc.name);
      const isSelected = state.selectedAccount === acc.name;
      const ringClass = isSelected ? "ring-2 ring-indigo-600 bg-indigo-50/40" : "";
      const balColor = acc.balance < 0 ? "text-rose-600" : "text-slate-900";

      return `
        <button type="button" onclick="toggleAccountFilter('${escapeHtml(acc.name)}')"
          class="glass-card ${ringClass} rounded-2xl p-3.5 min-w-[148px] text-left shrink-0 active:scale-95 transition">
          <div class="flex items-center justify-between mb-2">
            <div class="w-8 h-8 rounded-xl ${style.bg} flex items-center justify-center">
              <i data-lucide="${style.icon}" class="w-4 h-4"></i>
            </div>
            ${
              isSelected
                ? `<span class="text-[10px] font-extrabold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">Aktif</span>`
                : `<span class="text-[10px] font-medium text-slate-400">${acc.txCount} trx</span>`
            }
          </div>
          <p class="text-xs font-bold text-slate-500 truncate">${escapeHtml(acc.name)}</p>
          <p class="text-sm font-extrabold ${balColor} mt-0.5 truncate">${formatRupiah(acc.balance)}</p>
        </button>
      `;
    })
    .join("");
}

function renderDashboard() {
  const range = getDateRange(state.period);
  const filtered = getFilteredTransactions();

  let totalIncome = 0;
  let totalExpense = 0;
  const expenseByCategory = {};

  filtered.forEach((tx) => {
    if (tx.jenis === "pemasukan") {
      totalIncome += tx.nominal;
    } else {
      totalExpense += tx.nominal;
      // Jangan masukkan transfer antar rekening sebagai kategori belanja konsumtif di insight
      if (tx.kategori !== "Transfer Antar Rekening") {
        expenseByCategory[tx.kategori] = (expenseByCategory[tx.kategori] || 0) + tx.nominal;
      }
    }
  });

  const balance = totalIncome - totalExpense;
  document.getElementById("heroBalanceLabel").textContent =
    state.selectedAccount === "all" ? "Arus Kas Bersih" : `Arus Kas • ${state.selectedAccount}`;
  document.getElementById("periodLabel").textContent = range.label;
  document.getElementById("sumBalance").textContent = formatRupiah(balance);
  document.getElementById("sumIncome").textContent = formatRupiah(totalIncome);
  document.getElementById("sumExpense").textContent = formatRupiah(totalExpense);

  // 1. Insight Kategori Pengeluaran Terbesar
  const sortedCats = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1]);
  const nonTransferExp = sortedCats.reduce((sum, x) => sum + x[1], 0);
  if (sortedCats.length > 0 && nonTransferExp > 0) {
    const [topName, topVal] = sortedCats[0];
    const pct = Math.round((topVal / nonTransferExp) * 100);
    document.getElementById("insightTopCatName").textContent = topName;
    document.getElementById("insightTopCatVal").textContent = `${formatRupiah(topVal)} (${pct}%)`;
  } else {
    document.getElementById("insightTopCatName").textContent = "Belum ada";
    document.getElementById("insightTopCatVal").textContent = "Rp 0 (0%)";
  }

  // 2. Insight Rata-rata Pengeluaran Harian
  const avgDaily = nonTransferExp / Math.max(1, range.days);
  document.getElementById("insightDailyAvg").textContent = formatRupiah(avgDaily);

  // 3. Insight Perbandingan vs Periode Sebelumnya
  const prevRange = getPreviousPeriodRange(state.period);
  const badge = document.getElementById("insightCompareBadge");
  const desc = document.getElementById("insightCompareText");

  if (!prevRange) {
    desc.textContent = "Pilih Hari/Minggu/Bulan Ini untuk perbandingan";
    badge.textContent = "-";
    badge.className = "text-xs font-extrabold px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 shrink-0";
  } else {
    const prevExpense = state.transactions
      .filter((t) => {
        const matchAcc = state.selectedAccount === "all" || (t.rekening || "Tunai") === state.selectedAccount;
        return t.jenis === "pengeluaran" && t.kategori !== "Transfer Antar Rekening" && matchAcc && t.tanggal >= prevRange.start && t.tanggal <= prevRange.end;
      })
      .reduce((acc, t) => acc + t.nominal, 0);

    if (prevExpense === 0) {
      desc.textContent = `Belum ada pengeluaran di ${prevRange.label}`;
      badge.textContent = "Baru";
      badge.className = "text-xs font-extrabold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 shrink-0";
    } else {
      const diffPct = Math.round(((nonTransferExp - prevExpense) / prevExpense) * 100);
      if (diffPct > 0) {
        desc.textContent = `Naik ${formatRupiah(nonTransferExp - prevExpense)} vs ${prevRange.label}`;
        badge.textContent = `+${diffPct}%`;
        badge.className = "text-xs font-extrabold px-2.5 py-1 rounded-full bg-rose-50 text-rose-600 shrink-0";
      } else if (diffPct < 0) {
        desc.textContent = `Hemat ${formatRupiah(prevExpense - nonTransferExp)} vs ${prevRange.label}`;
        badge.textContent = `${diffPct}%`;
        badge.className = "text-xs font-extrabold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 shrink-0";
      } else {
        desc.textContent = `Sama persis dengan ${prevRange.label}`;
        badge.textContent = "0%";
        badge.className = "text-xs font-extrabold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 shrink-0";
      }
    }
  }

  // Render 5 Transaksi Terbaru
  const recentContainer = document.getElementById("recentList");
  const recentItems = filtered.slice(0, 5);
  recentContainer.innerHTML =
    recentItems.length === 0
      ? renderEmptyState("Belum ada transaksi pada filter ini. Tekan tombol + di bawah untuk mencatat.")
      : recentItems.map((tx) => renderTransactionCard(tx)).join("");
  lucide.createIcons();
}

function renderHistory() {
  const query = document.getElementById("searchInput").value.trim().toLowerCase();
  const typeFilter = document.getElementById("filterType").value;
  const accFilter = document.getElementById("filterAccount").value;
  const catFilter = document.getElementById("filterCategory").value;

  const list = state.transactions.filter((tx) => {
    if (typeFilter !== "all" && tx.jenis !== typeFilter) return false;
    if (accFilter !== "all" && (tx.rekening || "Tunai") !== accFilter) return false;
    if (catFilter !== "all" && tx.kategori !== catFilter) return false;
    if (query) {
      const hay = `${tx.kategori} ${tx.rekening} ${tx.catatan} ${tx.tanggal}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  document.getElementById("historyCount").textContent = `${list.length} transaksi`;
  const container = document.getElementById("historyList");
  container.innerHTML =
    list.length === 0
      ? renderEmptyState("Tidak ada transaksi yang cocok dengan pencarian atau filter.")
      : list.map((tx) => renderTransactionCard(tx)).join("");
  lucide.createIcons();
}

function renderTransactionCard(tx) {
  const isIncome = tx.jenis === "pemasukan";
  const badgeColor = isIncome ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600";
  const amountColor = isIncome ? "text-emerald-600" : "text-slate-900";
  const sign = isIncome ? "+" : "-";
  const iconName = tx.kategori === "Transfer Antar Rekening" ? "arrow-left-right" : isIncome ? "arrow-down-left" : "shopping-bag";
  const accName = tx.rekening || "Tunai";

  return `
    <div class="glass-card rounded-2xl p-3.5 flex items-center justify-between gap-3 active:scale-[0.99] transition">
      <div onclick="openEditTx('${tx.id}')" class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
        <div class="w-10 h-10 rounded-xl ${badgeColor} flex items-center justify-center shrink-0">
          <i data-lucide="${iconName}" class="w-4 h-4"></i>
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-1.5">
            <p class="text-xs font-extrabold text-slate-800 truncate">${escapeHtml(tx.kategori)}</p>
            <span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold shrink-0">
              ${escapeHtml(accName)}
            </span>
          </div>
          <p class="text-[11px] text-slate-400 truncate mt-0.5">
            ${formatDateIndo(tx.tanggal)}${tx.catatan ? " • " + escapeHtml(tx.catatan) : ""}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <span onclick="openEditTx('${tx.id}')" class="text-xs font-extrabold ${amountColor} cursor-pointer">
          ${sign}${formatRupiah(tx.nominal)}
        </span>
        <button type="button" onclick="openDeleteModal('${tx.id}')" title="Hapus"
          class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-400 hover:text-rose-600 flex items-center justify-center transition">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    </div>
  `;
}

function renderEmptyState(message) {
  return `
    <div class="glass-card rounded-3xl p-8 text-center">
      <div class="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-500 flex items-center justify-center mx-auto mb-3">
        <i data-lucide="inbox" class="w-6 h-6"></i>
      </div>
      <p class="text-xs font-semibold text-slate-500 leading-relaxed">${message}</p>
    </div>
  `;
}

function populateHistoryFilters() {
  // Filter Rekening
  const accSelect = document.getElementById("filterAccount");
  const curAcc = accSelect.value;
  const allAccs = getAllAccounts();
  accSelect.innerHTML =
    `<option value="all">Semua Akun</option>` +
    allAccs.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
  if (allAccs.includes(curAcc)) accSelect.value = curAcc;

  // Filter Kategori
  const typeVal = document.getElementById("filterType").value;
  const catSelect = document.getElementById("filterCategory");
  const curCat = catSelect.value;

  let cats = [];
  if (typeVal === "pemasukan") cats = getCategoriesForType("pemasukan");
  else if (typeVal === "pengeluaran") cats = getCategoriesForType("pengeluaran");
  else cats = Array.from(new Set([...getCategoriesForType("pengeluaran"), ...getCategoriesForType("pemasukan")]));

  catSelect.innerHTML =
    `<option value="all">Semua Kategori</option>` +
    cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  if (cats.includes(curCat)) catSelect.value = curCat;
}

// ============================================================================
// VISUALISASI GRAFIK (CHART.JS)
// ============================================================================
function renderCharts() {
  const filtered = getFilteredTransactions();
  const palette = ["#4F46E5", "#0D9488", "#2563EB", "#F59E0B", "#EC4899", "#8B5CF6", "#10B981", "#F43F5E", "#64748B"];

  const accExpMap = {};
  const catExpMap = {};
  let totalExp = 0;
  let totalInc = 0;

  filtered.forEach((t) => {
    if (t.jenis === "pengeluaran") {
      totalExp += t.nominal;
      const acc = t.rekening || "Tunai";
      accExpMap[acc] = (accExpMap[acc] || 0) + t.nominal;
      if (t.kategori !== "Transfer Antar Rekening") {
        catExpMap[t.kategori] = (catExpMap[t.kategori] || 0) + t.nominal;
      }
    } else {
      totalInc += t.nominal;
    }
  });

  // 1. Doughnut Pengeluaran per Rekening
  const sortedAcc = Object.entries(accExpMap).sort((a, b) => b[1] - a[1]);
  if (state.charts.account) state.charts.account.destroy();

  state.charts.account = new Chart(document.getElementById("chartAccount"), {
    type: "doughnut",
    data: {
      labels: sortedAcc.length ? sortedAcc.map((x) => x[0]) : ["Belum ada data"],
      datasets: [
        {
          data: sortedAcc.length ? sortedAcc.map((x) => x[1]) : [1],
          backgroundColor: sortedAcc.length ? ["#2563EB", "#F59E0B", "#10B981", "#8B5CF6", "#0D9488"] : ["#E2E8F0"],
          borderWidth: 0
        }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: "66%", plugins: { legend: { display: false } } }
  });

  const accColors = ["#2563EB", "#F59E0B", "#10B981", "#8B5CF6", "#0D9488"];
  document.getElementById("accountChartLegend").innerHTML = sortedAcc.length
    ? sortedAcc
        .map(([acc, val], i) => {
          const pct = totalExp > 0 ? Math.round((val / totalExp) * 100) : 0;
          return `
            <div class="flex items-center justify-between text-xs">
              <div class="flex items-center gap-2 min-w-0">
                <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${accColors[i % accColors.length]}"></span>
                <span class="font-semibold text-slate-700 truncate">${escapeHtml(acc)}</span>
              </div>
              <span class="font-bold text-slate-900 shrink-0">${formatRupiah(val)} (${pct}%)</span>
            </div>`;
        })
        .join("")
    : `<p class="text-xs text-slate-400 text-center">Belum ada transaksi keluar pada periode ini.</p>`;

  // 2. Doughnut Pengeluaran per Kategori
  const sortedCat = Object.entries(catExpMap).sort((a, b) => b[1] - a[1]);
  const nonTransferTotal = sortedCat.reduce((sum, x) => sum + x[1], 0);
  if (state.charts.category) state.charts.category.destroy();

  state.charts.category = new Chart(document.getElementById("chartCategory"), {
    type: "doughnut",
    data: {
      labels: sortedCat.length ? sortedCat.map((x) => x[0]) : ["Belum ada data"],
      datasets: [
        {
          data: sortedCat.length ? sortedCat.map((x) => x[1]) : [1],
          backgroundColor: sortedCat.length ? palette : ["#E2E8F0"],
          borderWidth: 0
        }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { display: false } } }
  });

  document.getElementById("categoryLegend").innerHTML = sortedCat.length
    ? sortedCat
        .map(([cat, val], i) => {
          const pct = nonTransferTotal > 0 ? Math.round((val / nonTransferTotal) * 100) : 0;
          return `
            <div class="flex items-center justify-between text-xs">
              <div class="flex items-center gap-2 min-w-0">
                <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${palette[i % palette.length]}"></span>
                <span class="font-semibold text-slate-700 truncate">${escapeHtml(cat)}</span>
              </div>
              <span class="font-bold text-slate-900 shrink-0">${formatRupiah(val)} (${pct}%)</span>
            </div>`;
        })
        .join("")
    : `<p class="text-xs text-slate-400 text-center">Belum ada pengeluaran pada periode ini.</p>`;

  // 3. Tren Harian / Bulanan
  const useMonthly = state.period === "all";
  const trendMap = {};
  filtered.forEach((t) => {
    const key = useMonthly ? t.tanggal.slice(0, 7) : t.tanggal;
    if (!trendMap[key]) trendMap[key] = { inc: 0, exp: 0 };
    if (t.jenis === "pemasukan") trendMap[key].inc += t.nominal;
    else trendMap[key].exp += t.nominal;
  });

  const trendKeys = Object.keys(trendMap).sort();
  if (state.charts.trend) state.charts.trend.destroy();

  state.charts.trend = new Chart(document.getElementById("chartTrend"), {
    type: "line",
    data: {
      labels: trendKeys.map((k) => (useMonthly ? k : k.slice(8, 10) + "/" + k.slice(5, 7))),
      datasets: [
        {
          label: "Pengeluaran",
          data: trendKeys.map((k) => trendMap[k].exp),
          borderColor: "#F43F5E",
          backgroundColor: "rgba(244, 63, 94, 0.1)",
          tension: 0.35,
          fill: true
        },
        {
          label: "Pemasukan",
          data: trendKeys.map((k) => trendMap[k].inc),
          borderColor: "#0D9488",
          backgroundColor: "rgba(13, 148, 136, 0.1)",
          tension: 0.35,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: {
        y: { ticks: { font: { size: 10 }, callback: (v) => (v >= 1000 ? v / 1000 + "rb" : v) } },
        x: { ticks: { font: { size: 10 } } }
      }
    }
  });

  // 4. Perbandingan Pemasukan vs Pengeluaran
  if (state.charts.compare) state.charts.compare.destroy();
  state.charts.compare = new Chart(document.getElementById("chartCompare"), {
    type: "bar",
    data: {
      labels: ["Pemasukan", "Pengeluaran"],
      datasets: [
        {
          data: [totalInc, totalExp],
          backgroundColor: ["#0D9488", "#4F46E5"],
          borderRadius: 12,
          barThickness: 44
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { font: { size: 10 }, callback: (v) => (v >= 1000 ? v / 1000 + "rb" : v) } } }
    }
  });
}

// ============================================================================
// MODAL INPUT, EDIT, TRANSFER & HAPUS TRANSAKSI
// ============================================================================
function switchTab(tabName) {
  state.activeTab = tabName;
  ["dashboard", "charts", "history", "settings"].forEach((t) => {
    document.getElementById(`view-${t}`).classList.toggle("hidden", t !== tabName);
    const nav = document.getElementById(`nav-${t}`);
    nav.className =
      t === tabName
        ? "nav-btn flex flex-col items-center justify-center py-1 px-3 text-indigo-600"
        : "nav-btn flex flex-col items-center justify-center py-1 px-3 text-slate-400";
  });

  document.getElementById("globalFilterBar").classList.toggle("hidden", tabName === "history" || tabName === "settings");
  if (tabName === "charts") renderCharts();
}

function renderAccountSelectorPills(selectedAcc) {
  const accounts = getAllAccounts();
  const target = accounts.includes(selectedAcc) ? selectedAcc : accounts[0] || "BCA";
  document.getElementById("txRekening").value = target;

  document.getElementById("txAccountPills").innerHTML = accounts
    .map((acc) => {
      const active = acc === target;
      return `
        <button type="button" onclick="selectTxAccount('${escapeHtml(acc)}')"
          class="px-3.5 py-2.5 rounded-xl text-xs font-extrabold whitespace-nowrap transition ${
            active
              ? "accent-gradient text-white shadow-sm"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }">
          ${escapeHtml(acc)}
        </button>`;
    })
    .join("");
}

function selectTxAccount(accName) {
  renderAccountSelectorPills(accName);
}

function populateTransferSelects() {
  const accounts = getAllAccounts();
  const optionsHtml = accounts.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
  document.getElementById("txFromAccount").innerHTML = optionsHtml;
  document.getElementById("txToAccount").innerHTML = optionsHtml;
  if (accounts.length > 1) {
    document.getElementById("txToAccount").value = accounts[1];
  }
}

function openTxModal() {
  document.getElementById("txModalTitle").textContent = "Catat Transaksi";
  document.getElementById("btnSubmitText").textContent = "Simpan Transaksi";
  document.getElementById("txId").value = "";
  document.getElementById("txOldJenis").value = "";
  document.getElementById("txNominal").value = "";
  document.getElementById("txCatatan").value = "";
  document.getElementById("txTanggal").value = getTodayISO();
  document.getElementById("quickCatBox").classList.add("hidden");
  document.getElementById("quickAccBox").classList.add("hidden");

  // Aktifkan kembali tab Transfer untuk transaksi baru
  document.getElementById("btnTypeTransfer").classList.remove("hidden");
  document.getElementById("typeSwitcherBox").className = "grid grid-cols-3 gap-1.5 p-1.5 bg-slate-100 rounded-2xl mb-4";

  const defaultAcc = state.selectedAccount !== "all" ? state.selectedAccount : "BCA";
  renderAccountSelectorPills(defaultAcc);
  populateTransferSelects();
  setTxType("pengeluaran");

  document.getElementById("txModal").classList.remove("hidden");
  setTimeout(() => document.getElementById("txNominal").focus(), 120);
}

function openEditTx(id) {
  const tx = state.transactions.find((t) => t.id === id);
  if (!tx) return;

  document.getElementById("txModalTitle").textContent = "Edit Transaksi";
  document.getElementById("btnSubmitText").textContent = "Perbarui Transaksi";
  document.getElementById("txId").value = tx.id;
  document.getElementById("txOldJenis").value = tx.jenis;
  document.getElementById("txNominal").value = Number(tx.nominal).toLocaleString("id-ID");
  document.getElementById("txTanggal").value = tx.tanggal;
  document.getElementById("txCatatan").value = tx.catatan || "";
  document.getElementById("quickCatBox").classList.add("hidden");
  document.getElementById("quickAccBox").classList.add("hidden");

  // Sembunyikan tab Transfer saat mengedit 1 baris transaksi
  document.getElementById("btnTypeTransfer").classList.add("hidden");
  document.getElementById("typeSwitcherBox").className = "grid grid-cols-2 gap-1.5 p-1.5 bg-slate-100 rounded-2xl mb-4";

  renderAccountSelectorPills(tx.rekening || "Tunai");
  setTxType(tx.jenis);
  document.getElementById("txKategori").value = tx.kategori;
  document.getElementById("txModal").classList.remove("hidden");
}

function closeTxModal() {
  document.getElementById("txModal").classList.add("hidden");
}

function setTxType(jenis) {
  document.getElementById("txJenis").value = jenis;
  const btnExp = document.getElementById("btnTypeExpense");
  const btnInc = document.getElementById("btnTypeIncome");
  const btnTrf = document.getElementById("btnTypeTransfer");

  btnExp.className = "py-2.5 rounded-xl text-xs font-extrabold text-slate-500 transition";
  btnInc.className = "py-2.5 rounded-xl text-xs font-extrabold text-slate-500 transition";
  btnTrf.className = "py-2.5 rounded-xl text-xs font-extrabold text-slate-500 transition";

  const isTransfer = jenis === "transfer";
  document.getElementById("singleAccountSection").classList.toggle("hidden", isTransfer);
  document.getElementById("categorySection").classList.toggle("hidden", isTransfer);
  document.getElementById("transferAccountSection").classList.toggle("hidden", !isTransfer);

  if (jenis === "pengeluaran") {
    btnExp.className = "py-2.5 rounded-xl text-xs font-extrabold bg-white text-rose-600 shadow-xs transition";
  } else if (jenis === "pemasukan") {
    btnInc.className = "py-2.5 rounded-xl text-xs font-extrabold bg-white text-emerald-600 shadow-xs transition";
  } else {
    btnTrf.className = "py-2.5 rounded-xl text-xs font-extrabold bg-white text-indigo-600 shadow-xs transition";
    populateTransferSelects();
    return;
  }

  const cats = getCategoriesForType(jenis);
  document.getElementById("txKategori").innerHTML = cats
    .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
    .join("");
}

function addQuickNominal(amount) {
  const input = document.getElementById("txNominal");
  const current = Number(input.value.replace(/[^\d]/g, "")) || 0;
  input.value = (current + amount).toLocaleString("id-ID");
}

function clearNominal() {
  document.getElementById("txNominal").value = "";
}

function toggleQuickCat() {
  document.getElementById("quickCatBox").classList.toggle("hidden");
}

function toggleQuickAcc() {
  document.getElementById("quickAccBox").classList.toggle("hidden");
}

async function saveQuickAcc() {
  const input = document.getElementById("quickAccInput");
  const name = input.value.trim();
  if (!name) return showToast("Ketik nama rekening baru dulu.", "error");

  await addCustomAccount(name);
  renderAccountSelectorPills(name);
  input.value = "";
  document.getElementById("quickAccBox").classList.add("hidden");
}

async function saveQuickCat() {
  const input = document.getElementById("quickCatInput");
  const name = input.value.trim();
  const jenis = document.getElementById("txJenis").value;
  if (!name) return showToast("Ketik nama kategori baru dulu.", "error");

  await addCustomCategory(jenis, name);
  setTxType(jenis);
  document.getElementById("txKategori").value = name;
  input.value = "";
  document.getElementById("quickCatBox").classList.add("hidden");
}

async function submitTransaction() {
  const id = document.getElementById("txId").value.trim();
  const oldJenis = document.getElementById("txOldJenis").value.trim();
  const jenis = document.getElementById("txJenis").value;
  const nominal = Number(document.getElementById("txNominal").value.replace(/[^\d]/g, "")) || 0;
  const rekening = document.getElementById("txRekening").value || "Tunai";
  const kategori = document.getElementById("txKategori").value;
  const tanggal = document.getElementById("txTanggal").value;
  const catatan = document.getElementById("txCatatan").value.trim();

  if (nominal <= 0) return showToast("Nominal harus lebih besar dari Rp 0.", "error");
  if (!tanggal) return showToast("Tanggal wajib diisi.", "error");

  const btn = document.getElementById("btnSubmitTx");
  const btnText = document.getElementById("btnSubmitText");
  btn.disabled = true;
  btnText.textContent = "Menyimpan ke Sheets...";

  try {
    if (jenis === "transfer") {
      const fromAccount = document.getElementById("txFromAccount").value;
      const toAccount = document.getElementById("txToAccount").value;
      if (fromAccount === toAccount) {
        throw new Error("Rekening asal dan tujuan tidak boleh sama.");
      }

      const res = await postToSheets({
        action: "transfer",
        transfer: { fromAccount, toAccount, nominal, tanggal, catatan }
      });

      state.transactions.unshift(res.inTx, res.outTx);
      showToast(`Transfer ${fromAccount} ke ${toAccount} tercatat!`, "success");
    } else {
      if (!kategori) throw new Error("Pilih kategori terlebih dahulu.");
      const txPayload = { id, jenis, nominal, rekening, kategori, tanggal, catatan };

      if (id) {
        await postToSheets({ action: "update", oldJenis, transaction: txPayload });
        const idx = state.transactions.findIndex((t) => t.id === id);
        if (idx !== -1) state.transactions[idx] = txPayload;
        showToast("Transaksi berhasil diperbarui!", "success");
      } else {
        const res = await postToSheets({ action: "add", transaction: txPayload });
        txPayload.id = res.id;
        state.transactions.unshift(txPayload);
        showToast(`Tersimpan di akun ${rekening}!`, "success");
      }
    }

    state.transactions.sort((a, b) => b.tanggal.localeCompare(a.tanggal));
    saveLocalState();
    renderAll();
    closeTxModal();
  } catch (err) {
    showToast("Gagal menyimpan: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btnText.textContent = id ? "Perbarui Transaksi" : "Simpan Transaksi";
  }
}

function openDeleteModal(id) {
  const tx = state.transactions.find((t) => t.id === id);
  if (!tx) return;
  state.deleteTarget = tx;
  document.getElementById("deleteTxDesc").textContent =
    `${tx.kategori} [${tx.rekening || "Tunai"}] (${formatRupiah(tx.nominal)}) pada ${formatDateIndo(tx.tanggal)} akan dihapus permanen dari Google Sheets.`;
  document.getElementById("deleteModal").classList.remove("hidden");
}

function closeDeleteModal() {
  state.deleteTarget = null;
  document.getElementById("deleteModal").classList.add("hidden");
}

async function confirmDelete() {
  if (!state.deleteTarget) return;
  const target = state.deleteTarget;
  const btn = document.getElementById("btnConfirmDelete");
  btn.disabled = true;
  btn.textContent = "Menghapus...";

  try {
    await postToSheets({ action: "delete", id: target.id, jenis: target.jenis });
    state.transactions = state.transactions.filter((t) => t.id !== target.id);
    saveLocalState();
    renderAll();
    closeDeleteModal();
    showToast("Transaksi berhasil dihapus.", "success");
  } catch (err) {
    showToast("Gagal menghapus: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Ya, Hapus";
  }
}

// ============================================================================
// UTILITAS FORMAT RUPIAH, TANGGAL & TOAST
// ============================================================================
function formatRupiah(num) {
  const val = Math.round(Number(num) || 0);
  const absFormatted = Math.abs(val).toLocaleString("id-ID");
  return val < 0 ? `-Rp ${absFormatted}` : `Rp ${absFormatted}`;
}

function getTodayISO() {
  return dateToISO(new Date());
}

function dateToISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateIndo(isoStr) {
  const parts = String(isoStr).split("-");
  if (parts.length !== 3) return isoStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let toastTimer = null;
function showToast(msg, type = "success") {
  const toast = document.getElementById("toast");
  const icon = document.getElementById("toastIcon");
  const text = document.getElementById("toastMsg");

  icon.textContent = type === "error" ? "⚠️" : "✅";
  text.textContent = msg;
  toast.classList.remove("hidden");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3200);
}
