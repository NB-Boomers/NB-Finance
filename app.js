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
  CONFIG: "dompetku_config_v3",
  TRANSACTIONS: "dompetku_tx_cache_v3",
  CUSTOM_CATS: "dompetku_custom_cats_v3",
  CUSTOM_ACCS: "dompetku_custom_accs_v3",
  BUDGETS: "dompetku_budgets_v3",
  HAS_AI_KEY: "dompetku_has_ai_key_v5"
};

let state = {
  config: { apiUrl: "", pin: "" },
  transactions: [],
  customCategories: { pemasukan: [], pengeluaran: [] },
  customAccounts: [],
  budgets: {},
  hasGeminiKey: false,
  period: "month",
  selectedAccount: "all",
  customStart: "",
  customEnd: "",
  activeTab: "dashboard",
  deleteTarget: null,
  charts: { budget: null, account: null, category: null, trend: null, compare: null }
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

    const savedBudgets = JSON.parse(localStorage.getItem(STORAGE_KEYS.BUDGETS));
    if (savedBudgets && typeof savedBudgets === "object") state.budgets = savedBudgets;

    state.hasGeminiKey = localStorage.getItem(STORAGE_KEYS.HAS_AI_KEY) === "true";
  } catch (e) {
    console.warn("Cache lokal kosong:", e);
  }
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(state.config));
  localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(state.transactions));
  localStorage.setItem(STORAGE_KEYS.CUSTOM_CATS, JSON.stringify(state.customCategories));
  localStorage.setItem(STORAGE_KEYS.CUSTOM_ACCS, JSON.stringify(state.customAccounts));
  localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(state.budgets));
  localStorage.setItem(STORAGE_KEYS.HAS_AI_KEY, String(state.hasGeminiKey));
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================
function bindEvents() {
  document.getElementById("btnSaveSetup").addEventListener("click", handleInitialSetup);
  document.getElementById("btnSync").addEventListener("click", () => syncFromSheets(false));

  // File Pickers untuk AI Receipt Scanner
  document.getElementById("receiptCameraInput").addEventListener("change", handleReceiptFileSelected);
  document.getElementById("receiptGalleryInput").addEventListener("change", handleReceiptFileSelected);

  // Simpan Gemini API Key di Pengaturan
  document.getElementById("btnSaveGeminiKey").addEventListener("click", handleSaveGeminiKey);

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

  // Auto-format Ribuan Rupiah + Live Budget Preview
  document.getElementById("txNominal").addEventListener("input", (e) => {
    const digits = e.target.value.replace(/[^\d]/g, "");
    e.target.value = digits ? Number(digits).toLocaleString("id-ID") : "";
    updateModalBudgetPreview();
  });

  document.getElementById("txKategori").addEventListener("change", updateModalBudgetPreview);
  document.getElementById("txTanggal").addEventListener("change", updateModalBudgetPreview);

  document.getElementById("budgetLimitInput").addEventListener("input", (e) => {
    const digits = e.target.value.replace(/[^\d]/g, "");
    e.target.value = digits ? Number(digits).toLocaleString("id-ID") : "";
  });

  document.getElementById("budgetCatSelect").addEventListener("change", (e) => {
    const existingLimit = state.budgets[e.target.value] || 0;
    document.getElementById("budgetLimitInput").value = existingLimit > 0 ? existingLimit.toLocaleString("id-ID") : "";
  });

  document.getElementById("btnSaveBudget").addEventListener("click", handleSaveBudget);

  // Filter Laporan Bulanan
  document.getElementById("reportMonthInput").addEventListener("change", renderReportPreview);
  document.getElementById("reportAccountSelect").addEventListener("change", renderReportPreview);

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
  if (!url.startsWith("[https://script.google.com/](https://script.google.com/)")) {
    errEl.textContent = "URL harus diawali [https://script.google.com/](https://script.google.com/)...";
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

    if (json.budgets && typeof json.budgets === "object") {
      state.budgets = { ...state.budgets, ...json.budgets };
    }

    if (typeof json.hasGeminiKey === "boolean") {
      state.hasGeminiKey = json.hasGeminiKey;
    }

    saveLocalState();
    renderAll();

    const now = new Date();
    const jam = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    document.getElementById("lastSyncText").textContent = `Tersinkron • ${jam}`;
    if (!silent) showToast("Data, rekening & anggaran tersinkron!", "success");
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
// AI RECEIPT & SCREENSHOT SCANNER (KOMPRESI GAMBAR + GEMINI VISION)
// ============================================================================
function renderAiKeyStatus() {
  const badge = document.getElementById("aiKeyStatusBadge");
  if (!badge) return;
  if (state.hasGeminiKey) {
    badge.className = "px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-emerald-50 text-emerald-700 shrink-0";
    badge.textContent = "Aktif di Server";
  } else {
    badge.className = "px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-700 shrink-0";
    badge.textContent = "Belum Diatur";
  }
}

async function handleSaveGeminiKey() {
  const input = document.getElementById("geminiApiKeyInput");
  const key = input.value.trim();
  const btn = document.getElementById("btnSaveGeminiKey");

  if (!key) {
    return showToast("Masukkan Gemini API Key terlebih dahulu.", "error");
  }

  btn.disabled = true;
  btn.textContent = "Menyimpan...";

  try {
    await postToSheets({ action: "saveMeta", geminiApiKey: key });
    state.hasGeminiKey = true;
    saveLocalState();
    renderAiKeyStatus();
    input.value = "";
    showToast("Gemini API Key tersimpan aman di server!", "success");
  } catch (err) {
    showToast("Gagal menyimpan API Key: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Simpan Key";
  }
}

function openTxModalWithScan() {
  openTxModal();
  setTimeout(() => {
    triggerReceiptPicker("gallery");
  }, 180);
}

function triggerReceiptPicker(source) {
  if (!state.hasGeminiKey) {
    closeTxModal();
    switchTab("settings");
    setTimeout(() => {
      document.getElementById("aiSettingsCard").scrollIntoView({ behavior: "smooth" });
      document.getElementById("geminiApiKeyInput").focus();
    }, 100);
    showToast("Isi Gemini API Key dulu di tab Atur untuk mengaktifkan Scan AI.", "error");
    return;
  }

  const inputId = source === "camera" ? "receiptCameraInput" : "receiptGalleryInput";
  const inputEl = document.getElementById(inputId);
  inputEl.value = "";
  inputEl.click();
}

function compressImageFile(file, maxDimension = 1024, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const base64 = dataUrl.split(",")[1];
        resolve({ dataUrl, base64, mimeType: "image/jpeg" });
      };
      img.onerror = () => reject(new Error("Gagal memproses file gambar."));
      img.src = event.target.result;
    };
    reader.onerror = () => reject(new Error("Gagal membaca file dari perangkat."));
    reader.readAsDataURL(file);
  });
}

async function handleReceiptFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const previewBox = document.getElementById("aiScanPreviewBox");
  const thumbImg = document.getElementById("aiScanThumb");
  const statusText = document.getElementById("aiScanStatusText");
  const subText = document.getElementById("aiScanSubText");
  const spinner = document.getElementById("aiScanSpinner");
  const submitBtn = document.getElementById("btnSubmitTx");

  previewBox.classList.remove("hidden");
  spinner.classList.remove("hidden");
  statusText.className = "text-xs font-extrabold text-indigo-900 truncate";
  statusText.textContent = "Mengompresi & membaca struk...";
  subText.textContent = "AI mengekstrak nominal, kategori & tanggal";
  submitBtn.disabled = true;

  try {
    const compressed = await compressImageFile(file, 1024, 0.78);
    thumbImg.src = compressed.dataUrl;

    const payload = {
      action: "scanReceipt",
      imageBase64: compressed.base64,
      mimeType: compressed.mimeType,
      categories: {
        pemasukan: getCategoriesForType("pemasukan"),
        pengeluaran: getCategoriesForType("pengeluaran")
      },
      accounts: getAllAccounts()
    };

    const res = await postToSheets(payload);
    const ext = res.extracted;

    // Terapkan hasil pembacaan AI ke form transaksi
    setTxType(ext.jenis || "pengeluaran");

    if (ext.nominal > 0) {
      document.getElementById("txNominal").value = Number(ext.nominal).toLocaleString("id-ID");
    }
    if (ext.kategori) {
      document.getElementById("txKategori").value = ext.kategori;
    }
    if (ext.rekening) {
      renderAccountSelectorPills(ext.rekening);
    }
    if (ext.tanggal) {
      document.getElementById("txTanggal").value = ext.tanggal;
    }
    if (ext.catatan) {
      document.getElementById("txCatatan").value = ext.catatan;
    }

    updateModalBudgetPreview();

    spinner.classList.add("hidden");
    statusText.className = "text-xs font-extrabold text-emerald-700 truncate";
    statusText.textContent = `✅ Terbaca: ${formatRupiah(ext.nominal)} (${ext.kategori})`;
    subText.textContent = ext.catatan || "Periksa hasil di bawah lalu tekan Simpan";
    showToast("Struk berhasil dibaca AI! Periksa lalu simpan.", "success");
  } catch (err) {
    spinner.classList.add("hidden");
    statusText.className = "text-xs font-extrabold text-rose-600 truncate";
    statusText.textContent = "⚠️ Gagal membaca gambar";
    subText.textContent = err.message;
    showToast("Scan gagal: " + err.message, "error");
  } finally {
    submitBtn.disabled = false;
  }
}

// ============================================================================
// MASTER DATA: REKENING, KATEGORI & ANGGARAN BULANAN
// ============================================================================
function getAllAccounts() {
  const fromTx = state.transactions.map((t) => t.rekening).filter(Boolean);
  return Array.from(new Set([...DEFAULT_ACCOUNTS, ...state.customAccounts, ...fromTx]));
}

function getCategoriesForType(jenis) {
  const base = DEFAULT_CATEGORIES[jenis] || [];
  const custom = state.customCategories[jenis] || [];
  const fromHistory = state.transactions
    .filter((t) => t.jenis === jenis && t.kategori !== "Transfer Antar Rekening")
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
  renderAll();
  showToast(`Kategori "${name}" ditambahkan!`, "success");

  postToSheets({ action: "saveMeta", categories: state.customCategories }).catch(() => {});
  return name;
}

function openBudgetSetup(categoryName = "") {
  switchTab("settings");
  populateBudgetSettings();
  if (categoryName) {
    document.getElementById("budgetCatSelect").value = categoryName;
    const lim = state.budgets[categoryName] || 0;
    document.getElementById("budgetLimitInput").value = lim > 0 ? lim.toLocaleString("id-ID") : "";
  }
  setTimeout(() => {
    document.getElementById("budgetSettingsCard").scrollIntoView({ behavior: "smooth" });
    document.getElementById("budgetLimitInput").focus();
  }, 100);
}

async function handleSaveBudget() {
  const cat = document.getElementById("budgetCatSelect").value;
  const limit = Number(document.getElementById("budgetLimitInput").value.replace(/[^\d]/g, "")) || 0;

  if (!cat) return showToast("Pilih kategori pengeluaran terlebih dahulu.", "error");
  if (limit <= 0) return showToast("Batas anggaran harus lebih dari Rp 0.", "error");

  state.budgets[cat] = limit;
  saveLocalState();
  renderAll();
  showToast(`Limit ${cat} disetel ke ${formatRupiah(limit)}/bulan!`, "success");

  postToSheets({ action: "saveMeta", budgets: state.budgets }).catch(() => {});
}

async function deleteBudget(cat) {
  delete state.budgets[cat];
  saveLocalState();
  renderAll();
  showToast(`Batas anggaran "${cat}" dihapus.`, "success");

  postToSheets({ action: "saveMeta", budgets: state.budgets }).catch(() => {});
}

function computeBudgetStatuses(targetMonth = getTodayISO().slice(0, 7)) {
  const spentByCat = {};

  state.transactions.forEach((tx) => {
    if (
      tx.jenis === "pengeluaran" &&
      tx.kategori !== "Transfer Antar Rekening" &&
      String(tx.tanggal).startsWith(targetMonth)
    ) {
      spentByCat[tx.kategori] = (spentByCat[tx.kategori] || 0) + tx.nominal;
    }
  });

  return Object.entries(state.budgets)
    .filter(([_, limit]) => Number(limit) > 0)
    .map(([category, limit]) => {
      const spent = spentByCat[category] || 0;
      const pct = Math.round((spent / limit) * 100);
      const remaining = limit - spent;
      let status = "safe";
      if (pct >= 100) status = "exceeded";
      else if (pct >= 80) status = "warning";

      return { category, limit: Number(limit), spent, pct, remaining, status };
    })
    .sort((a, b) => b.pct - a.pct);
}

function renderBudgetSections() {
  const statuses = computeBudgetStatuses();

  const alertBanner = document.getElementById("budgetAlertBanner");
  const alertIconBox = document.getElementById("budgetAlertIconBox");
  const alertTitle = document.getElementById("budgetAlertTitle");
  const alertList = document.getElementById("budgetAlertList");

  const risky = statuses.filter((s) => s.status === "warning" || s.status === "exceeded");
  if (risky.length === 0) {
    alertBanner.classList.add("hidden");
  } else {
    const hasExceeded = risky.some((s) => s.status === "exceeded");
    alertBanner.className = hasExceeded
      ? "rounded-2xl p-4 bg-rose-50/95 border border-rose-200 shadow-xs animate-fade-in"
      : "rounded-2xl p-4 bg-amber-50/95 border border-amber-200 shadow-xs animate-fade-in";

    alertIconBox.className = hasExceeded
      ? "w-9 h-9 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 mt-0.5"
      : "w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 mt-0.5";

    alertTitle.className = hasExceeded ? "text-xs font-extrabold text-rose-900" : "text-xs font-extrabold text-amber-900";
    alertTitle.textContent = hasExceeded
      ? "Perhatian: Pengeluaran Melebihi Batas Anggaran!"
      : "Peringatan: Anggaran Mendekati Limit (≥ 80%)";

    alertList.className = hasExceeded
      ? "mt-1 space-y-1 text-[11px] text-rose-800 leading-snug"
      : "mt-1 space-y-1 text-[11px] text-amber-800 leading-snug";

    alertList.innerHTML = risky
      .map((s) => {
        if (s.status === "exceeded") {
          return `<div>• <strong>${escapeHtml(s.category)}</strong> sudah terpakai <strong>${s.pct}%</strong> (lebih ${formatRupiah(Math.abs(s.remaining))})</div>`;
        }
        return `<div>• <strong>${escapeHtml(s.category)}</strong> terpakai <strong>${s.pct}%</strong> — sisa ${formatRupiah(s.remaining)}</div>`;
      })
      .join("");
  }

  const summaryBadge = document.getElementById("budgetSummaryBadge");
  const listEl = document.getElementById("budgetProgressList");

  if (statuses.length === 0) {
    summaryBadge.textContent = "Belum ada batas anggaran bulanan";
    listEl.innerHTML = `
      <div class="glass-card rounded-2xl p-4 flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <i data-lucide="shield-check" class="w-4 h-4"></i>
          </div>
          <p class="text-xs text-slate-500 leading-snug">Pasang target limit bulanan agar pengeluaran tiap kategori lebih terkontrol.</p>
        </div>
        <button type="button" onclick="openBudgetSetup()" class="px-3 py-2 rounded-xl bg-slate-900 text-white text-[11px] font-bold shrink-0">
          Mulai
        </button>
      </div>
    `;
    return;
  }

  const totalBudget = statuses.reduce((sum, s) => sum + s.limit, 0);
  const totalBudgetSpent = statuses.reduce((sum, s) => sum + s.spent, 0);
  const overallPct = Math.round((totalBudgetSpent / totalBudget) * 100);
  summaryBadge.textContent = `Terpakai ${formatRupiah(totalBudgetSpent)} dari ${formatRupiah(totalBudget)} (${overallPct}%)`;

  listEl.innerHTML = statuses
    .map((s) => {
      const barWidth = Math.min(100, s.pct);
      let barColor = "bg-gradient-to-r from-indigo-500 to-teal-500";
      let pillClass = "bg-emerald-50 text-emerald-700";
      let statusLabel = `Sisa ${formatRupiah(s.remaining)}`;

      if (s.status === "warning") {
        barColor = "bg-gradient-to-r from-amber-400 to-orange-500";
        pillClass = "bg-amber-50 text-amber-700";
        statusLabel = `Mendekati limit • Sisa ${formatRupiah(s.remaining)}`;
      } else if (s.status === "exceeded") {
        barColor = "bg-gradient-to-r from-rose-500 to-red-600";
        pillClass = "bg-rose-50 text-rose-700";
        statusLabel = `Over ${formatRupiah(Math.abs(s.remaining))}`;
      }

      return `
        <div onclick="openBudgetSetup('${escapeHtml(s.category)}')" class="glass-card rounded-2xl p-4 cursor-pointer active:scale-[0.99] transition">
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <span class="text-xs font-extrabold text-slate-800 truncate">${escapeHtml(s.category)}</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold ${pillClass} shrink-0">${s.pct}%</span>
          </div>

          <div class="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div class="h-full rounded-full ${barColor} transition-all duration-500" style="width: ${barWidth}%"></div>
          </div>

          <div class="flex items-center justify-between mt-2 text-[11px]">
            <span class="font-bold text-slate-700">${formatRupiah(s.spent)} <span class="font-normal text-slate-400">/ ${formatRupiah(s.limit)}</span></span>
            <span class="font-semibold ${s.status === "exceeded" ? "text-rose-600" : s.status === "warning" ? "text-amber-600" : "text-teal-600"}">
              ${statusLabel}
            </span>
          </div>
        </div>
      `;
    })
    .join("");
}

function populateBudgetSettings() {
  const select = document.getElementById("budgetCatSelect");
  const curVal = select.value;
  const expCats = getCategoriesForType("pengeluaran");
  select.innerHTML = expCats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  if (expCats.includes(curVal)) select.value = curVal;

  const selectedCat = select.value;
  const lim = state.budgets[selectedCat] || 0;
  document.getElementById("budgetLimitInput").value = lim > 0 ? lim.toLocaleString("id-ID") : "";

  const listContainer = document.getElementById("budgetSettingsList");
  const statuses = computeBudgetStatuses();

  if (statuses.length === 0) {
    listContainer.innerHTML = `<p class="text-[11px] text-slate-400">Belum ada target anggaran yang disimpan.</p>`;
    return;
  }

  listContainer.innerHTML = statuses
    .map(
      (s) => `
      <div class="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
        <div onclick="openBudgetSetup('${escapeHtml(s.category)}')" class="cursor-pointer min-w-0 flex-1">
          <p class="text-xs font-extrabold text-slate-800 truncate">${escapeHtml(s.category)}</p>
          <p class="text-[11px] text-slate-500">Limit: <strong>${formatRupiah(s.limit)}</strong> / bulan (${s.pct}% terpakai)</p>
        </div>
        <button type="button" onclick="deleteBudget('${escapeHtml(s.category)}')" title="Hapus Limit"
          class="w-8 h-8 rounded-lg bg-white text-slate-400 hover:text-rose-600 border border-slate-200 flex items-center justify-center shrink-0">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>`
    )
    .join("");
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
// RINGKASAN LAPORAN BULANAN (WHATSAPP & CETAK PDF A4)
// ============================================================================
function openReportModal() {
  const monthInput = document.getElementById("reportMonthInput");
  if (!monthInput.value) {
    monthInput.value = getTodayISO().slice(0, 7);
  }

  const accSelect = document.getElementById("reportAccountSelect");
  const allAccs = getAllAccounts();
  accSelect.innerHTML =
    `<option value="all">Semua Rekening</option>` +
    allAccs.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");

  if (state.selectedAccount !== "all" && allAccs.includes(state.selectedAccount)) {
    accSelect.value = state.selectedAccount;
  }

  renderReportPreview();
  document.getElementById("reportModal").classList.remove("hidden");
  lucide.createIcons();
}

function closeReportModal() {
  document.getElementById("reportModal").classList.add("hidden");
}

function buildMonthlyReportData() {
  const monthStr = document.getElementById("reportMonthInput").value || getTodayISO().slice(0, 7);
  const accFilter = document.getElementById("reportAccountSelect").value || "all";

  const [y, m] = monthStr.split("-").map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  const monthTxs = state.transactions
    .filter((t) => {
      const matchMonth = String(t.tanggal).startsWith(monthStr);
      const matchAcc = accFilter === "all" || (t.rekening || "Tunai") === accFilter;
      return matchMonth && matchAcc;
    })
    .sort((a, b) => a.tanggal.localeCompare(b.tanggal));

  let totalIncome = 0;
  let totalExpense = 0;
  const expByCat = {};
  const incByCat = {};

  monthTxs.forEach((tx) => {
    if (tx.jenis === "pemasukan") {
      if (accFilter !== "all" || tx.kategori !== "Transfer Antar Rekening") {
        totalIncome += tx.nominal;
        incByCat[tx.kategori] = (incByCat[tx.kategori] || 0) + tx.nominal;
      }
    } else {
      if (accFilter !== "all" || tx.kategori !== "Transfer Antar Rekening") {
        totalExpense += tx.nominal;
        expByCat[tx.kategori] = (expByCat[tx.kategori] || 0) + tx.nominal;
      }
    }
  });

  const netCashflow = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? Math.round((netCashflow / totalIncome) * 100) : 0;

  const prevExpense = state.transactions
    .filter((t) => {
      const matchMonth = String(t.tanggal).startsWith(prevMonthStr);
      const matchAcc = accFilter === "all" || (t.rekening || "Tunai") === accFilter;
      const isOperational = accFilter !== "all" || t.kategori !== "Transfer Antar Rekening";
      return t.jenis === "pengeluaran" && matchMonth && matchAcc && isOperational;
    })
    .reduce((sum, t) => sum + t.nominal, 0);

  const expenseCategories = Object.entries(expByCat)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amount]) => {
      const pct = totalExpense > 0 ? Math.round((amount / totalExpense) * 100) : 0;
      const limit = Number(state.budgets[cat] || 0);
      const budgetPct = limit > 0 ? Math.round((amount / limit) * 100) : null;
      return { cat, amount, pct, limit, budgetPct };
    });

  const incomeCategories = Object.entries(incByCat)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amount]) => {
      const pct = totalIncome > 0 ? Math.round((amount / totalIncome) * 100) : 0;
      return { cat, amount, pct };
    });

  const accountBalances = computeAccountBalances();
  const totalAssets = accountBalances.reduce((s, a) => s + a.balance, 0);

  return {
    monthStr,
    monthLabel: formatMonthYearIndo(monthStr),
    accFilter,
    accLabel: accFilter === "all" ? "Semua Rekening" : accFilter,
    totalIncome,
    totalExpense,
    netCashflow,
    savingsRate,
    prevExpense,
    expenseCategories,
    incomeCategories,
    accountBalances,
    totalAssets,
    transactions: monthTxs,
    printedAt: formatDateIndo(getTodayISO())
  };
}

function renderReportPreview() {
  const data = buildMonthlyReportData();
  const container = document.getElementById("reportPreviewContainer");

  const netColor = data.netCashflow >= 0 ? "text-emerald-600" : "text-rose-600";
  const netSign = data.netCashflow > 0 ? "+" : "";

  let compareNote = "Belum ada pembanding bulan lalu";
  if (data.prevExpense > 0) {
    const diff = data.totalExpense - data.prevExpense;
    const diffPct = Math.round((diff / data.prevExpense) * 100);
    compareNote =
      diff > 0
        ? `Naik ${formatRupiah(diff)} (+${diffPct}%) dari bulan lalu`
        : diff < 0
        ? `Turun ${formatRupiah(Math.abs(diff))} (${diffPct}%) dari bulan lalu`
        : "Sama dengan bulan lalu";
  }

  const expListHtml =
    data.expenseCategories.length === 0
      ? `<p class="text-xs text-slate-400">Tidak ada pengeluaran tercatat di bulan ini.</p>`
      : data.expenseCategories
          .map((item) => {
            let budgetBadge = "";
            if (item.limit > 0) {
              const cls =
                item.budgetPct >= 100
                  ? "bg-rose-50 text-rose-600"
                  : item.budgetPct >= 80
                  ? "bg-amber-50 text-amber-700"
                  : "bg-teal-50 text-teal-700";
              budgetBadge = `<span class="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${cls}">${item.budgetPct}% limit</span>`;
            }
            return `
              <div class="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0 text-xs">
                <div class="min-w-0 pr-2">
                  <span class="font-bold text-slate-800">${escapeHtml(item.cat)}</span>
                  <span class="text-[11px] text-slate-400 ml-1">(${item.pct}%)</span>
                  ${budgetBadge}
                </div>
                <span class="font-extrabold text-slate-900 shrink-0">${formatRupiah(item.amount)}</span>
              </div>`;
          })
          .join("");

  const accListHtml = data.accountBalances
    .map(
      (a) => `
      <div class="flex items-center justify-between text-xs py-1">
        <span class="font-semibold text-slate-600">${escapeHtml(a.name)}</span>
        <span class="font-bold ${a.balance < 0 ? "text-rose-600" : "text-slate-900"}">${formatRupiah(a.balance)}</span>
      </div>`
    )
    .join("");

  container.innerHTML = `
    <div class="rounded-2xl bg-gradient-to-br from-indigo-600 to-teal-600 p-4 text-white">
      <div class="flex items-center justify-between text-[11px] text-indigo-100">
        <span>PERIODE LAPORAN</span>
        <span class="bg-white/15 px-2 py-0.5 rounded-full font-semibold">${escapeHtml(data.accLabel)}</span>
      </div>
      <h3 class="text-lg font-extrabold mt-0.5">${escapeHtml(data.monthLabel)}</h3>
      <p class="text-[11px] text-indigo-100 mt-1">${data.transactions.length} transaksi tercatat • ${compareNote}</p>
    </div>

    <div class="grid grid-cols-2 gap-2.5">
      <div class="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-100">
        <p class="text-[11px] font-semibold text-emerald-700">Total Pemasukan</p>
        <p class="text-sm font-extrabold text-emerald-900 mt-0.5">${formatRupiah(data.totalIncome)}</p>
      </div>
      <div class="p-3.5 rounded-2xl bg-rose-50/70 border border-rose-100">
        <p class="text-[11px] font-semibold text-rose-700">Total Pengeluaran</p>
        <p class="text-sm font-extrabold text-rose-900 mt-0.5">${formatRupiah(data.totalExpense)}</p>
      </div>
    </div>

    <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
      <div>
        <p class="text-[11px] font-bold text-slate-500">Surplus / Defisit Bulan Ini</p>
        <p class="text-base font-extrabold ${netColor} mt-0.5">${netSign}${formatRupiah(data.netCashflow)}</p>
      </div>
      <span class="px-2.5 py-1 rounded-full bg-white border border-slate-200 text-xs font-extrabold text-slate-700">
        Saving ${data.savingsRate}%
      </span>
    </div>

    <div class="p-4 rounded-2xl border border-slate-200/80 space-y-1">
      <h4 class="text-xs font-extrabold uppercase tracking-wider text-slate-400 mb-2">Rincian Pengeluaran</h4>
      ${expListHtml}
    </div>

    <div class="p-4 rounded-2xl border border-slate-200/80 space-y-1">
      <div class="flex items-center justify-between mb-1.5">
        <h4 class="text-xs font-extrabold uppercase tracking-wider text-slate-400">Posisi Saldo Rekening</h4>
        <span class="text-[11px] font-extrabold text-indigo-600">Total: ${formatRupiah(data.totalAssets)}</span>
      </div>
      ${accListHtml}
    </div>
  `;
}

function generateWhatsAppMessage(data) {
  const lines = [];
  lines.push(`*LAPORAN KEUANGAN — DOMPETKU*`);
  lines.push(`Periode: *${data.monthLabel}*`);
  lines.push(`Rekening: *${data.accLabel}*`);
  lines.push(`────────────────────`);
  lines.push(`💰 *RINGKASAN ARUS KAS*`);
  lines.push(`• Pemasukan: *${formatRupiah(data.totalIncome)}*`);
  lines.push(`• Pengeluaran: *${formatRupiah(data.totalExpense)}*`);
  const netSign = data.netCashflow > 0 ? "+" : "";
  lines.push(`• Selisih Bersih: *${netSign}${formatRupiah(data.netCashflow)}* (${data.savingsRate}%)`);

  if (data.prevExpense > 0) {
    const diff = data.totalExpense - data.prevExpense;
    const diffPct = Math.round((diff / data.prevExpense) * 100);
    const trendTxt =
      diff > 0
        ? `Naik ${formatRupiah(diff)} (+${diffPct}%) vs bulan lalu`
        : diff < 0
        ? `Hemat ${formatRupiah(Math.abs(diff))} (${diffPct}%) vs bulan lalu`
        : `Sama dengan bulan lalu`;
    lines.push(`• Tren Belanja: ${trendTxt}`);
  }

  lines.push(``);
  lines.push(`📊 *PENGELUARAN PER KATEGORI*`);
  if (data.expenseCategories.length === 0) {
    lines.push(`• Belum ada pengeluaran`);
  } else {
    data.expenseCategories.forEach((c) => {
      const limitNote = c.limit > 0 ? ` [${c.budgetPct}% dari limit]` : "";
      lines.push(`• ${c.cat}: *${formatRupiah(c.amount)}* (${c.pct}%)${limitNote}`);
    });
  }

  if (data.incomeCategories.length > 0) {
    lines.push(``);
    lines.push(`📥 *SUMBER PEMASUKAN*`);
    data.incomeCategories.forEach((c) => {
      lines.push(`• ${c.cat}: *${formatRupiah(c.amount)}* (${c.pct}%)`);
    });
  }

  lines.push(``);
  lines.push(`🏦 *SALDO SAAT INI PER REKENING*`);
  data.accountBalances.forEach((a) => {
    lines.push(`• ${a.name}: *${formatRupiah(a.balance)}*`);
  });
  lines.push(`*Total Saldo Aset: ${formatRupiah(data.totalAssets)}*`);
  lines.push(`────────────────────`);
  lines.push(`_Dicetak dari DompetKu (${data.printedAt})_`);

  return lines.join("\n");
}

function shareReportWhatsApp() {
  const data = buildMonthlyReportData();
  const text = generateWhatsAppMessage(data);
  const waUrl = `[https://wa.me/?text=$](https://wa.me/?text=$){encodeURIComponent(text)}`;
  window.open(waUrl, "_blank", "noopener,noreferrer");
}

async function copyReportText() {
  const data = buildMonthlyReportData();
  const text = generateWhatsAppMessage(data);
  try {
    await navigator.clipboard.writeText(text);
    showToast("Teks laporan disalin ke clipboard!", "success");
  } catch (e) {
    showToast("Gagal menyalin teks.", "error");
  }
}

function printReportPDF() {
  const data = buildMonthlyReportData();
  const includeTx = document.getElementById("reportIncludeTx").checked;
  const printArea = document.getElementById("printableReportArea");

  const expRows =
    data.expenseCategories.length === 0
      ? `<tr><td colspan="4" style="padding:10px;text-align:center;color:#64748B;">Tidak ada pengeluaran pada bulan ini.</td></tr>`
      : data.expenseCategories
          .map((c) => {
            const budgetInfo = c.limit > 0 ? `${formatRupiah(c.limit)} (${c.budgetPct}%)` : "-";
            return `
              <tr style="border-bottom:1px solid #E2E8F0;">
                <td style="padding:8px 10px;font-weight:600;">${escapeHtml(c.cat)}</td>
                <td style="padding:8px 10px;text-align:right;font-weight:700;">${formatRupiah(c.amount)}</td>
                <td style="padding:8px 10px;text-align:right;">${c.pct}%</td>
                <td style="padding:8px 10px;text-align:right;color:#475569;">${budgetInfo}</td>
              </tr>`;
          })
          .join("");

  const accRows = data.accountBalances
    .map(
      (a) => `
      <tr style="border-bottom:1px solid #E2E8F0;">
        <td style="padding:8px 10px;font-weight:600;">${escapeHtml(a.name)}</td>
        <td style="padding:8px 10px;text-align:right;color:#059669;">${formatRupiah(a.allIn)}</td>
        <td style="padding:8px 10px;text-align:right;color:#E11D48;">${formatRupiah(a.allOut)}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:700;">${formatRupiah(a.balance)}</td>
      </tr>`
    )
    .join("");

  let txSectionHtml = "";
  if (includeTx) {
    const txRows =
      data.transactions.length === 0
        ? `<tr><td colspan="5" style="padding:10px;text-align:center;color:#64748B;">Tidak ada transaksi.</td></tr>`
        : data.transactions
            .map((t) => {
              const isInc = t.jenis === "pemasukan";
              return `
                <tr style="border-bottom:1px solid #F1F5F9;">
                  <td style="padding:6px 8px;white-space:nowrap;">${formatDateIndo(t.tanggal)}</td>
                  <td style="padding:6px 8px;">${escapeHtml(t.kategori)}</td>
                  <td style="padding:6px 8px;">${escapeHtml(t.rekening || "Tunai")}</td>
                  <td style="padding:6px 8px;color:#475569;">${escapeHtml(t.catatan || "-")}</td>
                  <td style="padding:6px 8px;text-align:right;font-weight:700;color:${isInc ? "#059669" : "#0F172A"};white-space:nowrap;">
                    ${isInc ? "+" : "-"}${formatRupiah(t.nominal)}
                  </td>
                </tr>`;
            })
            .join("");

    txSectionHtml = `
      <div style="margin-top:22px;">
        <h3 style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#334155;margin-bottom:8px;">
          Daftar Transaksi (${data.transactions.length} Transaksi)
        </h3>
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr style="background:#F8FAFC;border-top:1px solid #CBD5E1;border-bottom:1px solid #CBD5E1;text-align:left;color:#475569;">
              <th style="padding:7px 8px;">Tanggal</th>
              <th style="padding:7px 8px;">Kategori</th>
              <th style="padding:7px 8px;">Rekening</th>
              <th style="padding:7px 8px;">Catatan</th>
              <th style="padding:7px 8px;text-align:right;">Nominal</th>
            </tr>
          </thead>
          <tbody>${txRows}</tbody>
        </table>
      </div>
    `;
  }

  printArea.innerHTML = `
    <div style="font-family:'Plus Jakarta Sans',sans-serif;color:#0F172A;">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #4F46E5;padding-bottom:12px;margin-bottom:18px;">
        <div>
          <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;color:#4F46E5;text-transform:uppercase;">DompetKu Personal Finance</div>
          <h1 style="font-size:22px;font-weight:800;margin:2px 0 0 0;">Laporan Keuangan Bulanan</h1>
        </div>
        <div style="text-align:right;font-size:11px;color:#475569;">
          <div>Periode: <strong>${escapeHtml(data.monthLabel)}</strong></div>
          <div>Filter Akun: <strong>${escapeHtml(data.accLabel)}</strong></div>
          <div>Dicetak: ${data.printedAt}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">
        <div style="border:1px solid #CBD5E1;border-radius:10px;padding:12px;background:#F8FAFC;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748B;">Total Pemasukan</div>
          <div style="font-size:16px;font-weight:800;color:#059669;margin-top:4px;">${formatRupiah(data.totalIncome)}</div>
        </div>
        <div style="border:1px solid #CBD5E1;border-radius:10px;padding:12px;background:#F8FAFC;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748B;">Total Pengeluaran</div>
          <div style="font-size:16px;font-weight:800;color:#E11D48;margin-top:4px;">${formatRupiah(data.totalExpense)}</div>
        </div>
        <div style="border:1px solid #CBD5E1;border-radius:10px;padding:12px;background:#F8FAFC;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748B;">Arus Kas Bersih</div>
          <div style="font-size:16px;font-weight:800;color:#0F172A;margin-top:4px;">${formatRupiah(data.netCashflow)}</div>
        </div>
      </div>

      <h3 style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#334155;margin-bottom:8px;">
        Ringkasan Pengeluaran per Kategori
      </h3>
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:20px;">
        <thead>
          <tr style="background:#F1F5F9;border-top:1px solid #CBD5E1;border-bottom:1px solid #CBD5E1;color:#334155;">
            <th style="padding:8px 10px;text-align:left;">Kategori</th>
            <th style="padding:8px 10px;text-align:right;">Realisasi</th>
            <th style="padding:8px 10px;text-align:right;">Porsi</th>
            <th style="padding:8px 10px;text-align:right;">Target Anggaran</th>
          </tr>
        </thead>
        <tbody>${expRows}</tbody>
      </table>

      <h3 style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#334155;margin-bottom:8px;">
        Posisi Saldo Akhir per Rekening (Total Aset: ${formatRupiah(data.totalAssets)})
      </h3>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead>
          <tr style="background:#F1F5F9;border-top:1px solid #CBD5E1;border-bottom:1px solid #CBD5E1;color:#334155;">
            <th style="padding:8px 10px;text-align:left;">Rekening</th>
            <th style="padding:8px 10px;text-align:right;">Total Masuk</th>
            <th style="padding:8px 10px;text-align:right;">Total Keluar</th>
            <th style="padding:8px 10px;text-align:right;">Saldo Akhir</th>
          </tr>
        </thead>
        <tbody>${accRows}</tbody>
      </table>

      ${txSectionHtml}
    </div>
  `;

  setTimeout(() => {
    window.print();
  }, 150);
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
  if (key.includes("bca")) return { icon: "landmark", bg: "bg-blue-50 text-blue-600" };
  if (key.includes("mandiri")) return { icon: "building-2", bg: "bg-amber-50 text-amber-600" };
  if (key.includes("tunai") || key.includes("cash")) return { icon: "banknote", bg: "bg-emerald-50 text-emerald-600" };
  if (key.includes("qris")) return { icon: "qr-code", bg: "bg-purple-50 text-purple-600" };
  return { icon: "credit-card", bg: "bg-teal-50 text-teal-600" };
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
// RENDER DASHBOARD, KARTU SALDO, ANGGARAN, INSIGHT, RIWAYAT & GRAFIK
// ============================================================================
function renderAll() {
  updatePeriodPills();
  renderAccountCards();
  renderBudgetSections();
  renderDashboard();
  renderCharts();
  populateHistoryFilters();
  renderHistory();
  populateBudgetSettings();
  renderCustomTags();
  renderAiKeyStatus();
  lucide.createIcons();
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

  const avgDaily = nonTransferExp / Math.max(1, range.days);
  document.getElementById("insightDailyAvg").textContent = formatRupiah(avgDaily);

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

  const recentContainer = document.getElementById("recentList");
  const recentItems = filtered.slice(0, 5);
  recentContainer.innerHTML =
    recentItems.length === 0
      ? renderEmptyState("Belum ada transaksi pada filter ini. Tekan tombol + di bawah untuk mencatat.")
      : recentItems.map((tx) => renderTransactionCard(tx)).join("");
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
  const accSelect = document.getElementById("filterAccount");
  const curAcc = accSelect.value;
  const allAccs = getAllAccounts();
  accSelect.innerHTML =
    `<option value="all">Semua Akun</option>` +
    allAccs.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
  if (allAccs.includes(curAcc)) accSelect.value = curAcc;

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

  const budgetStats = computeBudgetStatuses();
  const budgetWrapper = document.getElementById("chartBudgetWrapper");
  const budgetEmpty = document.getElementById("chartBudgetEmpty");

  if (state.charts.budget) state.charts.budget.destroy();
  if (budgetStats.length === 0) {
    budgetWrapper.classList.add("hidden");
    budgetEmpty.classList.remove("hidden");
  } else {
    budgetWrapper.classList.remove("hidden");
    budgetEmpty.classList.add("hidden");
    state.charts.budget = new Chart(document.getElementById("chartBudget"), {
      type: "bar",
      data: {
        labels: budgetStats.map((b) => b.category),
        datasets: [
          {
            label: "Batas Anggaran",
            data: budgetStats.map((b) => b.limit),
            backgroundColor: "#CBD5E1",
            borderRadius: 8
          },
          {
            label: "Terpakai Bulan Ini",
            data: budgetStats.map((b) => b.spent),
            backgroundColor: budgetStats.map((b) =>
              b.status === "exceeded" ? "#F43F5E" : b.status === "warning" ? "#F59E0B" : "#0D9488"
            ),
            borderRadius: 8
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
  }

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
// MODAL INPUT, EDIT, TRANSFER, PREVIEW LIMIT & HAPUS TRANSAKSI
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

  // Reset AI Scanner preview box & tampilkan banner scanner
  document.getElementById("aiScannerBox").classList.remove("hidden");
  document.getElementById("aiScanPreviewBox").classList.add("hidden");

  document.getElementById("btnTypeTransfer").classList.remove("hidden");
  document.getElementById("typeSwitcherBox").className = "grid grid-cols-3 gap-1.5 p-1.5 bg-slate-100 rounded-2xl mb-4";

  const defaultAcc = state.selectedAccount !== "all" ? state.selectedAccount : "BCA";
  renderAccountSelectorPills(defaultAcc);
  populateTransferSelects();
  setTxType("pengeluaran");

  document.getElementById("txModal").classList.remove("hidden");
  lucide.createIcons();
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
  document.getElementById("aiScannerBox").classList.add("hidden");

  document.getElementById("btnTypeTransfer").classList.add("hidden");
  document.getElementById("typeSwitcherBox").className = "grid grid-cols-2 gap-1.5 p-1.5 bg-slate-100 rounded-2xl mb-4";

  renderAccountSelectorPills(tx.rekening || "Tunai");
  setTxType(tx.jenis);
  document.getElementById("txKategori").value = tx.kategori;
  updateModalBudgetPreview();
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
    document.getElementById("modalBudgetPreview").classList.add("hidden");
  } else {
    btnTrf.className = "py-2.5 rounded-xl text-xs font-extrabold bg-white text-indigo-600 shadow-xs transition";
    populateTransferSelects();
    return;
  }

  const cats = getCategoriesForType(jenis);
  document.getElementById("txKategori").innerHTML = cats
    .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
    .join("");
  updateModalBudgetPreview();
}

function updateModalBudgetPreview() {
  const box = document.getElementById("modalBudgetPreview");
  const jenis = document.getElementById("txJenis").value;
  const kategori = document.getElementById("txKategori").value;
  const limit = Number(state.budgets[kategori] || 0);

  if (jenis !== "pengeluaran" || limit <= 0) {
    box.classList.add("hidden");
    return;
  }

  const editId = document.getElementById("txId").value.trim();
  const inputNominal = Number(document.getElementById("txNominal").value.replace(/[^\d]/g, "")) || 0;
  const txDate = document.getElementById("txTanggal").value || getTodayISO();
  const txMonth = txDate.slice(0, 7);

  const currentSpent = state.transactions
    .filter(
      (t) =>
        t.id !== editId &&
        t.jenis === "pengeluaran" &&
        t.kategori === kategori &&
        String(t.tanggal).startsWith(txMonth)
    )
    .reduce((sum, t) => sum + t.nominal, 0);

  const projectedSpent = currentSpent + inputNominal;
  const projectedPct = Math.round((projectedSpent / limit) * 100);
  const remaining = limit - projectedSpent;

  box.classList.remove("hidden");
  if (projectedPct >= 100) {
    box.className = "mt-2 px-3.5 py-2.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-[11px] leading-snug";
    box.innerHTML = `🚨 <strong>Melebihi Limit Anggaran (${projectedPct}%)!</strong> Total jadi ${formatRupiah(projectedSpent)} dari batas ${formatRupiah(limit)}.`;
  } else if (projectedPct >= 80) {
    box.className = "mt-2 px-3.5 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-[11px] leading-snug";
    box.innerHTML = `⚠️ <strong>Mendekati Limit (${projectedPct}%):</strong> Sisa anggaran ${escapeHtml(kategori)} tinggal <strong>${formatRupiah(remaining)}</strong>.`;
  } else {
    box.className = "mt-2 px-3.5 py-2.5 rounded-xl border border-teal-200 bg-teal-50/70 text-teal-800 text-[11px] leading-snug";
    box.innerHTML = `🛡️ <strong>Anggaran Aman (${projectedPct}%):</strong> Sisa limit bulan ini <strong>${formatRupiah(remaining)}</strong> dari ${formatRupiah(limit)}.`;
  }
}

function addQuickNominal(amount) {
  const input = document.getElementById("txNominal");
  const current = Number(input.value.replace(/[^\d]/g, "")) || 0;
  input.value = (current + amount).toLocaleString("id-ID");
  updateModalBudgetPreview();
}

function clearNominal() {
  document.getElementById("txNominal").value = "";
  updateModalBudgetPreview();
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
  updateModalBudgetPreview();
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
      } else {
        const res = await postToSheets({ action: "add", transaction: txPayload });
        txPayload.id = res.id;
        state.transactions.unshift(txPayload);
      }

      const budgetStatus = computeBudgetStatuses().find((b) => b.category === kategori);
      if (jenis === "pengeluaran" && budgetStatus && budgetStatus.status === "exceeded") {
        showToast(`Tersimpan! ⚠️ Anggaran ${kategori} sudah ${budgetStatus.pct}% (melebihi limit).`, "error");
      } else if (jenis === "pengeluaran" && budgetStatus && budgetStatus.status === "warning") {
        showToast(`Tersimpan! ⚠️ Anggaran ${kategori} sudah ${budgetStatus.pct}% (sisa ${formatRupiah(budgetStatus.remaining)}).`, "error");
      } else {
        showToast(id ? "Transaksi berhasil diperbarui!" : `Tersimpan di akun ${rekening}!`, "success");
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

function formatMonthYearIndo(monthStr) {
  const namaBulan = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
  const [y, m] = String(monthStr).split("-");
  const idx = Number(m) - 1;
  return `${namaBulan[idx] || m} ${y}`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3800);
}
