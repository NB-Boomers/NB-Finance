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

const STORAGE_KEYS = {
  CONFIG: "dompetku_config_v1",
  TRANSACTIONS: "dompetku_tx_cache_v1",
  CUSTOM_CATS: "dompetku_custom_cats_v1"
};

let state = {
  config: { apiUrl: "", pin: "" },
  transactions: [],
  customCategories: { pemasukan: [], pengeluaran: [] },
  period: "month", // today | week | month | all | custom
  customStart: "",
  customEnd: "",
  activeTab: "dashboard",
  deleteTarget: null,
  charts: { category: null, trend: null, compare: null }
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
  } catch (e) {
    console.warn("Cache lokal kosong:", e);
  }
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(state.config));
  localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(state.transactions));
  localStorage.setItem(STORAGE_KEYS.CUSTOM_CATS, JSON.stringify(state.customCategories));
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================
function bindEvents() {
  // Setup Awal
  document.getElementById("btnSaveSetup").addEventListener("click", handleInitialSetup);

  // Sync Manual
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

  document.getElementById("btnApplyCustom").addEventListener("click", () => {
    const s = document.getElementById("startDate").value;
    const e = document.getElementById("endDate").value;
    if (!s || !e) {
      showToast("Pilih tanggal mulai dan tanggal akhir.", "error");
      return;
    }
    if (s > e) {
      showToast("Tanggal mulai tidak boleh melewati tanggal akhir.", "error");
      return;
    }
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
    populateHistoryCategoryFilter();
    renderHistory();
  });
  document.getElementById("filterCategory").addEventListener("change", renderHistory);

  // Pengaturan Kategori & Koneksi
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

    // Urutkan transaksi dari tanggal terbaru
    state.transactions = (json.data || []).sort((a, b) => b.tanggal.localeCompare(a.tanggal));

    // Gabungkan kategori kustom dari server
    if (json.customCategories) {
      mergeCategories(json.customCategories);
    }

    saveLocalState();
    renderAll();

    const now = new Date();
    const jam = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    document.getElementById("lastSyncText").textContent = `Tersinkron • ${jam}`;
    if (!silent) showToast("Data spreadsheet berhasil disinkronkan!", "success");
  } catch (err) {
    document.getElementById("lastSyncText").textContent = "Mode offline / gagal sync";
    if (!silent) showToast("Gagal sync: " + err.message, "error");
  } finally {
    icon.classList.remove("animate-spin");
  }
}

async function postToSheets(bodyObj) {
  const payload = { ...bodyObj, token: state.config.pin };
  // Gunakan text/plain agar terhindar dari blokir CORS preflight Google Apps Script
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
// LOGIKA KATEGORI DINAMIS (BAKU + KUSTOM + DATA LAMA)
// ============================================================================
function getCategoriesForType(jenis) {
  const base = DEFAULT_CATEGORIES[jenis] || [];
  const custom = state.customCategories[jenis] || [];
  const fromHistory = state.transactions
    .filter((t) => t.jenis === jenis)
    .map((t) => t.kategori);

  return Array.from(new Set([...base, ...custom, ...fromHistory]));
}

function mergeCategories(serverCats) {
  ["pemasukan", "pengeluaran"].forEach((jenis) => {
    const merged = new Set([...(state.customCategories[jenis] || []), ...(serverCats[jenis] || [])]);
    state.customCategories[jenis] = Array.from(merged);
  });
}

async function addCustomCategory(jenis, name) {
  const existing = getCategoriesForType(jenis).map((c) => c.toLowerCase());
  if (existing.includes(name.toLowerCase())) {
    showToast("Kategori sudah ada.", "error");
    return name;
  }

  state.customCategories[jenis].push(name);
  saveLocalState();
  renderCustomCategoryTags();
  populateHistoryCategoryFilter();
  showToast(`Kategori "${name}" ditambahkan!`, "success");

  // Simpan juga ke PropertiesService di Google Apps Script agar sinkron antar perangkat
  postToSheets({ action: "saveCategories", categories: state.customCategories }).catch(() => {});
  return name;
}

function renderCustomCategoryTags() {
  const container = document.getElementById("customCatList");
  const allCustom = [
    ...state.customCategories.pengeluaran.map((c) => ({ jenis: "pengeluaran", name: c })),
    ...state.customCategories.pemasukan.map((c) => ({ jenis: "pemasukan", name: c }))
  ];

  if (allCustom.length === 0) {
    container.innerHTML = `<p class="text-[11px] text-slate-400">Belum ada kategori tambahan.</p>`;
    return;
  }

  container.innerHTML = allCustom
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
// FILTER PERIODE & KALKULASI INSIGHT
// ============================================================================
function getDateRange(period) {
  const todayStr = getTodayISO();
  const [y, m, d] = todayStr.split("-").map(Number);
  const todayDate = new Date(y, m - 1, d);

  if (period === "today") {
    return { start: todayStr, end: todayStr, label: "Hari Ini", days: 1 };
  }
  if (period === "week") {
    const dayOfWeek = todayDate.getDay() === 0 ? 7 : todayDate.getDay(); // Senin = 1
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
    const dayOfWeek = todayDateDay(y, m, d);
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

function todayDateDay(y, m, d) {
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 ? 7 : dow;
}

function getFilteredTransactions() {
  const range = getDateRange(state.period);
  return state.transactions.filter((t) => t.tanggal >= range.start && t.tanggal <= range.end);
}

// ============================================================================
// RENDER DASHBOARD, INSIGHT, RIWAYAT & GRAFIK
// ============================================================================
function renderAll() {
  updatePeriodPills();
  renderDashboard();
  renderCharts();
  populateHistoryCategoryFilter();
  renderHistory();
  renderCustomCategoryTags();
}

function updatePeriodPills() {
  document.querySelectorAll(".period-pill").forEach((btn) => {
    const active = btn.getAttribute("data-period") === state.period;
    btn.className = active
      ? "period-pill px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition accent-gradient text-white shadow-sm"
      : "period-pill px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition bg-white text-slate-600 border border-slate-200";
  });
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
      expenseByCategory[tx.kategori] = (expenseByCategory[tx.kategori] || 0) + tx.nominal;
    }
  });

  const balance = totalIncome - totalExpense;
  document.getElementById("periodLabel").textContent = range.label;
  document.getElementById("sumBalance").textContent = formatRupiah(balance);
  document.getElementById("sumIncome").textContent = formatRupiah(totalIncome);
  document.getElementById("sumExpense").textContent = formatRupiah(totalExpense);

  // 1. Insight Kategori Pengeluaran Terbesar
  const sortedCats = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1]);
  if (sortedCats.length > 0 && totalExpense > 0) {
    const [topName, topVal] = sortedCats[0];
    const pct = Math.round((topVal / totalExpense) * 100);
    document.getElementById("insightTopCatName").textContent = topName;
    document.getElementById("insightTopCatVal").textContent = `${formatRupiah(topVal)} (${pct}%)`;
  } else {
    document.getElementById("insightTopCatName").textContent = "Belum ada";
    document.getElementById("insightTopCatVal").textContent = "Rp 0 (0%)";
  }

  // 2. Insight Rata-rata Pengeluaran Harian
  const avgDaily = totalExpense / Math.max(1, range.days);
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
      .filter((t) => t.jenis === "pengeluaran" && t.tanggal >= prevRange.start && t.tanggal <= prevRange.end)
      .reduce((acc, t) => acc + t.nominal, 0);

    if (prevExpense === 0) {
      desc.textContent = `Belum ada pengeluaran di ${prevRange.label}`;
      badge.textContent = "Baru";
      badge.className = "text-xs font-extrabold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 shrink-0";
    } else {
      const diffPct = Math.round(((totalExpense - prevExpense) / prevExpense) * 100);
      if (diffPct > 0) {
        desc.textContent = `Naik ${formatRupiah(totalExpense - prevExpense)} vs ${prevRange.label}`;
        badge.textContent = `+${diffPct}%`;
        badge.className = "text-xs font-extrabold px-2.5 py-1 rounded-full bg-rose-50 text-rose-600 shrink-0";
      } else if (diffPct < 0) {
        desc.textContent = `Hemat ${formatRupiah(prevExpense - totalExpense)} vs ${prevRange.label}`;
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
      ? renderEmptyState("Belum ada transaksi di periode ini. Tekan tombol + di bawah untuk mencatat.")
      : recentItems.map((tx) => renderTransactionCard(tx)).join("");
  lucide.createIcons();
}

function renderHistory() {
  const query = document.getElementById("searchInput").value.trim().toLowerCase();
  const typeFilter = document.getElementById("filterType").value;
  const catFilter = document.getElementById("filterCategory").value;

  const list = state.transactions.filter((tx) => {
    if (typeFilter !== "all" && tx.jenis !== typeFilter) return false;
    if (catFilter !== "all" && tx.kategori !== catFilter) return false;
    if (query) {
      const hay = `${tx.kategori} ${tx.catatan} ${tx.tanggal}`.toLowerCase();
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
  const iconName = isIncome ? "arrow-down-left" : "shopping-bag";

  return `
    <div class="glass-card rounded-2xl p-3.5 flex items-center justify-between gap-3 active:scale-[0.99] transition">
      <div onclick="openEditTx('${tx.id}')" class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
        <div class="w-10 h-10 rounded-xl ${badgeColor} flex items-center justify-center shrink-0">
          <i data-lucide="${iconName}" class="w-4 h-4"></i>
        </div>
        <div class="min-w-0">
          <p class="text-xs font-extrabold text-slate-800 truncate">${escapeHtml(tx.kategori)}</p>
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

function populateHistoryCategoryFilter() {
  const typeVal = document.getElementById("filterType").value;
  const select = document.getElementById("filterCategory");
  const current = select.value;

  let cats = [];
  if (typeVal === "pemasukan") cats = getCategoriesForType("pemasukan");
  else if (typeVal === "pengeluaran") cats = getCategoriesForType("pengeluaran");
  else cats = Array.from(new Set([...getCategoriesForType("pengeluaran"), ...getCategoriesForType("pemasukan")]));

  select.innerHTML =
    `<option value="all">Semua Kategori</option>` +
    cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

  if (cats.includes(current)) select.value = current;
}

// ============================================================================
// VISUALISASI GRAFIK (CHART.JS)
// ============================================================================
function renderCharts() {
  const filtered = getFilteredTransactions();
  const palette = ["#4F46E5", "#0D9488", "#2563EB", "#F59E0B", "#EC4899", "#8B5CF6", "#10B981", "#F43F5E", "#64748B"];

  // 1. Doughnut Pengeluaran per Kategori
  const expMap = {};
  let totalExp = 0;
  let totalInc = 0;

  filtered.forEach((t) => {
    if (t.jenis === "pengeluaran") {
      expMap[t.kategori] = (expMap[t.kategori] || 0) + t.nominal;
      totalExp += t.nominal;
    } else {
      totalInc += t.nominal;
    }
  });

  const sortedExp = Object.entries(expMap).sort((a, b) => b[1] - a[1]);
  if (state.charts.category) state.charts.category.destroy();

  state.charts.category = new Chart(document.getElementById("chartCategory"), {
    type: "doughnut",
    data: {
      labels: sortedExp.length ? sortedExp.map((x) => x[0]) : ["Belum ada data"],
      datasets: [
        {
          data: sortedExp.length ? sortedExp.map((x) => x[1]) : [1],
          backgroundColor: sortedExp.length ? palette : ["#E2E8F0"],
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: { legend: { display: false } }
    }
  });

  const legendBox = document.getElementById("categoryLegend");
  legendBox.innerHTML = sortedExp.length
    ? sortedExp
        .map(([cat, val], i) => {
          const pct = totalExp > 0 ? Math.round((val / totalExp) * 100) : 0;
          const color = palette[i % palette.length];
          return `
            <div class="flex items-center justify-between text-xs">
              <div class="flex items-center gap-2 min-w-0">
                <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${color}"></span>
                <span class="font-semibold text-slate-700 truncate">${escapeHtml(cat)}</span>
              </div>
              <span class="font-bold text-slate-900 shrink-0">${formatRupiah(val)} (${pct}%)</span>
            </div>`;
        })
        .join("")
    : `<p class="text-xs text-slate-400 text-center">Belum ada pengeluaran pada periode ini.</p>`;

  // 2. Tren Harian / Bulanan
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

  // 3. Perbandingan Pemasukan vs Pengeluaran
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
      scales: {
        y: { ticks: { font: { size: 10 }, callback: (v) => (v >= 1000 ? v / 1000 + "rb" : v) } }
      }
    }
  });
}

// ============================================================================
// MODAL INPUT, EDIT & HAPUS TRANSAKSI
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

  // Filter periode global tampil di Beranda & Grafik
  document.getElementById("globalFilterBar").classList.toggle("hidden", tabName === "history" || tabName === "settings");
  if (tabName === "charts") renderCharts();
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

  if (jenis === "pengeluaran") {
    btnExp.className = "py-3 rounded-xl text-xs font-extrabold bg-white text-rose-600 shadow-xs transition";
    btnInc.className = "py-3 rounded-xl text-xs font-extrabold text-slate-500 transition";
  } else {
    btnInc.className = "py-3 rounded-xl text-xs font-extrabold bg-white text-emerald-600 shadow-xs transition";
    btnExp.className = "py-3 rounded-xl text-xs font-extrabold text-slate-500 transition";
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
  const kategori = document.getElementById("txKategori").value;
  const tanggal = document.getElementById("txTanggal").value;
  const catatan = document.getElementById("txCatatan").value.trim();

  // Validasi Input
  if (nominal <= 0) {
    showToast("Nominal harus lebih besar dari Rp 0.", "error");
    return;
  }
  if (!kategori) {
    showToast("Pilih kategori terlebih dahulu.", "error");
    return;
  }
  if (!tanggal) {
    showToast("Tanggal wajib diisi.", "error");
    return;
  }

  const btn = document.getElementById("btnSubmitTx");
  const btnText = document.getElementById("btnSubmitText");
  btn.disabled = true;
  btnText.textContent = "Menyimpan ke Sheets...";

  try {
    const txPayload = { id, jenis, nominal, kategori, tanggal, catatan };
    if (id) {
      await postToSheets({ action: "update", oldJenis, transaction: txPayload });
      const idx = state.transactions.findIndex((t) => t.id === id);
      if (idx !== -1) state.transactions[idx] = txPayload;
      showToast("Transaksi berhasil diperbarui!", "success");
    } else {
      const res = await postToSheets({ action: "add", transaction: txPayload });
      txPayload.id = res.id;
      state.transactions.unshift(txPayload);
      showToast("Tersimpan ke Google Sheets!", "success");
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
    `${tx.kategori} (${formatRupiah(tx.nominal)}) pada ${formatDateIndo(tx.tanggal)} akan dihapus permanen dari Google Sheets.`;
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
  const now = new Date();
  return dateToISO(now);
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
