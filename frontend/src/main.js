import './main.css';

// Offline Readiness: Import libraries from node_modules
import * as echarts from 'echarts';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';

// Expose to window for legacy scripts/global access
window.echarts = echarts;
window.html2canvas = html2canvas;
window.jspdf = { jsPDF };
window.PDFLib = { PDFDocument };
window.pdfjsLib = pdfjsLib;

import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

import './digitizer.js';
import './selection.js';
import { authManager } from './AuthManager';
import { storageManager } from './StorageManager';

const API = window.API_URL || "";
let chartCombo1, chartCombo2;
let currentDrawPath_calc = "";
let currentDrawPath_modes = "";
let chartCombo1_modes, chartCombo2_modes;
let globalArchiveData = [];
let modalResolver = null;
let pendingImportFile = null;

let currentLoadedPump = null; // Store currently loaded record globally to persist link state

// Global helper to update drawing link visibility
// Global helper to update drawing link visibility
async function updateLink(prefix, pump = currentLoadedPump) {
    const drawLink = document.getElementById(prefix + 'drawLink');
    if (!drawLink) return;

    const fileInput = document.getElementById(prefix + 'drawingFile');
    if (fileInput) {
        fileInput.style.display = '';
        fileInput.style.width = 'auto';
        fileInput.style.flex = '0 1 auto';
    }

    if (pump && pump.drawing_filename) {
        try {
            const path = await storageManager.getAdapter().getDrawing(pump);
            if (path) {
                drawLink.href = path;
                drawLink.style.display = 'inline-block';
                drawLink.style.flexShrink = '0';
                drawLink.style.marginTop = '4px';
                drawLink.innerText = '📄 Открыть';
                drawLink.title = pump.drawing_filename;
            } else {
                drawLink.style.display = 'none';
            }
        } catch (e) {
            console.error("Drawing link error:", e);
            drawLink.style.display = 'none';
        }
    } else {
        drawLink.href = 'javascript:void(0);';
        drawLink.style.display = 'none';
        drawLink.title = '';
    }
}

function showSaveModal(id) {
    document.getElementById('modalTitle').innerText = `Запись #${id} уже существует`;
    document.getElementById('saveModal').style.display = "block";
    return new Promise(resolve => {
        modalResolver = resolve;
    });
}

function resolveModal(choice) {
    document.getElementById('saveModal').style.display = "none";
    if (modalResolver) modalResolver(choice);
}

function closeImportModal() {
    document.getElementById('importModal').style.display = "none";
    document.getElementById('dbUpload').value = ""; // reset
    pendingImportFile = null;
}

// Close modal if clicked outside
window.onclick = function (event) {
    if (event.target == document.getElementById('saveModal')) resolveModal('cancel');
    if (event.target == document.getElementById('importModal')) closeImportModal();
}

// Replaced window.onload with DOMContentLoaded to avoid conflicts
document.addEventListener('DOMContentLoaded', () => {
    // 1. Force Clear all inputs on refresh (Browser persistence bypass)
    resetAllFields();

    chartCombo1 = echarts.init(document.getElementById('chartCombo1'));
    chartCombo2 = echarts.init(document.getElementById('chartCombo2'));
    chartCombo1_modes = echarts.init(document.getElementById('modes-chartCombo1'));
    chartCombo2_modes = echarts.init(document.getElementById('modes-chartCombo2'));

    // Debounce resize to prevent lag
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (chartCombo1) chartCombo1.resize();
            if (chartCombo2) chartCombo2.resize();
            if (chartCombo1_modes) chartCombo1_modes.resize();
            if (chartCombo2_modes) chartCombo2_modes.resize();
        }, 100);
    });
    loadArchive();

    // Reveal App (Prevent FOUC)
    document.body.classList.add('loaded');
});

function resetAllFields() {
    const fields = [
        'dispId', 'modes-dispId', 'comment', 'modes-comment',
        'pumpName', 'modes-pumpName', 'oemName', 'modes-oemName',
        'dn_suction', 'modes-dn_suction', 'dn_discharge', 'modes-dn_discharge',
        'rpm', 'modes-rpm', 'impeller', 'modes-impeller',
        'p2_nom', 'modes-p2_nom', 'price', 'modes-price',
        'qReq', 'modes-qReq', 'hReq', 'modes-hReq', 'hSt', 'modes-hSt',
        'qText', 'hText', 'p2Text', 'npshText', 'effText',
        'modes-qMin', 'modes-qMax'
    ];

    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (id.includes('dispId')) el.value = "NEW";
            else el.value = "";
        }
    });

    // Clear coefficients specifically
    const prefixes = ['h', 'eff', 'p2', 'npsh'];
    prefixes.forEach(p => {
        for (let i = 0; i <= 3; i++) {
            const el = document.getElementById(`modes-${p}-a${i}`);
            if (el) el.value = "";
        }
    });

    // Reset Files
    ['drawingFile', 'modes-drawingFile'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });

    // Hide Footers
    ['mathFooter', 'modes-mathFooter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });

    currentDrawPath_calc = "";
    currentDrawPath_modes = "";
    currentLoadedPump = null;
}

// --- WORKSPACE & AUTH LOGIC ---
async function switchMode(mode) {
    if (mode === 'cloud' && !authManager.isAuthenticated()) {
        showLogin();
        // Revert selector until logged in
        document.getElementById('modeSelector').value = storageManager.currentMode;
        return;
    }
    storageManager.setMode(mode);
    updateUIForMode();
    loadArchive();
}

function updateUIForMode() {
    const isCloud = storageManager.isCloud();
    document.getElementById('localFileControls').style.display = isCloud ? 'none' : 'flex';
    document.getElementById('importBtn').style.display = isCloud ? 'flex' : 'none';

    // Auth display
    const userInfo = document.getElementById('userInfo');
    const authBtn = document.getElementById('authBtn');
    if (authManager.isAuthenticated()) {
        userInfo.innerText = authManager.user.email;
        authBtn.innerText = 'Выход';
        if (authManager.user.role === 'admin') {
            document.getElementById('adminTabBtn').style.display = 'block';
        }
    } else {
        userInfo.innerText = '';
        authBtn.innerText = 'Вход';
        document.getElementById('adminTabBtn').style.display = 'none';
    }
}

function toggleAuth() {
    if (authManager.isAuthenticated()) {
        authManager.logout();
        switchMode('local');
        updateUIForMode();
    } else {
        showLogin();
    }
}

function showLogin() {
    document.getElementById('authModal').style.display = 'block';
    showLoginForm();
}

function closeAuthModal() {
    document.getElementById('authModal').style.display = 'none';
}

function showLoginForm() {
    document.getElementById('authModalTitle').innerText = 'Вход в Команду';
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
}

function showRegister() {
    document.getElementById('authModalTitle').innerText = 'Регистрация организации';
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
}

async function handleLogin() {
    console.log("LOGIN: Attempting login...");
    const emailInput = document.getElementById('loginEmail');
    const passInput = document.getElementById('loginPass');
    if (!emailInput || !passInput) {
        console.error("LOGIN ERROR: Input fields not found");
        return;
    }
    const email = emailInput.value;
    const pass = passInput.value;
    console.log("LOGIN: Email =", email);

    try {
        await authManager.login(email, pass);
        console.log("LOGIN SUCCESS: User authenticated");
        closeAuthModal();
        switchMode('cloud');
        const selector = document.getElementById('modeSelector');
        if (selector) selector.value = 'cloud';
        console.log("LOGIN SUCCESS: Switched to TEAM mode");
    } catch (e) {
        console.error("LOGIN ERROR:", e);
        alert('Ошибка входа: ' + e.message);
    }
}

async function handleRegister() {
    console.log("REGISTER: Attempting registration...");
    const org = document.getElementById('regOrg').value;
    const email = document.getElementById('regEmail').value;
    const pass = document.getElementById('regPass').value;

    if (!org || !email || !pass) {
        alert("Заполните все поля");
        return;
    }

    try {
        await authManager.register(email, pass, org);
        console.log("REGISTER SUCCESS: Organization created");
        closeAuthModal();
        switchMode('cloud');
        const selector = document.getElementById('modeSelector');
        if (selector) selector.value = 'cloud';
    } catch (e) {
        console.error("REGISTER ERROR:", e);
        alert('Ошибка регистрации: ' + e.message);
    }
}

async function selectLocalFile() {
    try {
        const [handle] = await window.showOpenFilePicker({
            types: [{ description: 'JSON Database', accept: { 'application/json': ['.json'] } }],
            multiple: false
        });
        await storageManager.localAdapter.setFileHandle(handle);
        document.getElementById('localFileName').innerText = handle.name;
        loadArchive();
    } catch (e) {
        if (e.name !== 'AbortError') console.error(e);
    }
}

// --- EXPOSE GLOBALS for HTML access ---
window.showTab = showTab;
window.calc = calc;
window.calcModes = calcModes;
window.loadArchive = loadArchive;
window.closeImportModal = closeImportModal;
window.resolveModal = resolveModal;
window.showSaveModal = showSaveModal;
window.updateLink = updateLink;
window.downloadAllPNG = downloadAllPNG;
window.syncOEM = syncOEM;
window.loadPumpData = loadPumpData;
window.deletePump = deletePump;
window.exportToPNG = exportToPNG;
window.switchMode = switchMode;
window.toggleAuth = toggleAuth;
window.showRegister = showRegister;
window.showLogin = showLogin;
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.closeAuthModal = closeAuthModal;
window.selectLocalFile = selectLocalFile;
window.loadLogo = (input, imgId) => {
    if (input.files && input.files[0]) {
        var reader = new FileReader();
        reader.onload = function (e) {
            document.getElementById(imgId).src = e.target.result;
        }
        reader.readAsDataURL(input.files[0]);
    }
};


function showTab(t) {
    // 1. Reset all Tabs (Navigation buttons)
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.querySelector(`[onclick="showTab('${t}')"]`)?.classList.add('active');

    // 2. Hide all top-level Views
    document.querySelectorAll('.workspace-view').forEach(el => el.style.display = 'none');
    document.getElementById('main-workspace').classList.remove('active'); // Grid

    // 3. Logic Routing
    if (t === 'calc' || t === 'modes') {
        // --- UNIFIED WORKSPACE MODE ---
        document.getElementById('main-workspace').classList.add('active'); // Show Unified Grid

        // Hide all stages and controls inside grid
        document.querySelectorAll('.stage-view').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.controls-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.controls-submit').forEach(el => el.style.display = 'none');

        // Activate specific Stage & Controls
        document.getElementById('stage-' + t).classList.add('active');
        document.getElementById('controls-' + t).classList.add('active');
        document.getElementById('controls-footer-' + t).style.display = 'block';

        // Update Header Title
        const names = { 'calc': 'Построение по точкам', 'modes': 'Построение по коэффициентам' };
        document.getElementById('controls-title').innerText = names[t] || 'Параметры';

        // Resize charts
        setTimeout(() => {
            if (chartCombo1) chartCombo1.resize();
            if (chartCombo2) chartCombo2.resize();
            if (chartCombo1_modes) chartCombo1_modes.resize();
            if (chartCombo2_modes) chartCombo2_modes.resize();
        }, 100);

    } else {
        // --- STANDALONE MODE (Archive / Digitizer) ---
        const view = document.getElementById('tab-' + t);
        if (view) {
            view.style.display = 'flex'; // Use flex for these views
            if (t === 'archive') {
                loadArchive();
            }
        }
    }
}

function syncOEM(val, prefix = "") { document.getElementById(prefix + 'oemName').value = val; }

/* ОРИГИНАЛЬНАЯ МАТЕМАТИКА v2.33 [cite: 33-47] */
function calculateRealR2(qArr, yArr, c) {
    if (qArr.length <= 4) return 1.0;
    let ssRes = 0, ssTot = 0;
    const mean = yArr.reduce((a, b) => a + b, 0) / yArr.length;
    qArr.forEach((q, i) => {
        const pred = c[0] * Math.pow(q, 3) + c[1] * Math.pow(q, 2) + c[2] * q + c[3];
        ssRes += Math.pow(yArr[i] - pred, 2); ssTot += Math.pow(yArr[i] - mean, 2);
    });
    return ssTot === 0 ? 1 : 1 - (ssRes / ssTot);
}

function getNiceAxis(vals, isQ = false) {
    let f = vals.filter(v => !isNaN(v) && isFinite(v));
    if (f.length === 0) return { min: 0, max: 100, interval: 10 };

    let minVal = isQ ? 0 : Math.min(...f);
    let maxVal = Math.max(...f);

    // Add small padding (5-10%)
    let range = maxVal - minVal;
    if (range === 0) range = maxVal || 10;

    let targetMax = isQ ? maxVal * 1.05 : maxVal + (range * 0.1);
    // If not Q, ensure min doesn't drop below 0 if data is all positive
    if (!isQ && minVal >= 0) minVal = 0;

    // Calculate nice interval
    const roughInterval = (targetMax - minVal) / 6; // Aim for ~6 ticks
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughInterval)));
    const normalized = roughInterval / magnitude;

    let interval;
    if (normalized < 1.5) interval = 1 * magnitude;
    else if (normalized < 3) interval = 2 * magnitude;
    else if (normalized < 7) interval = 5 * magnitude;
    else interval = 10 * magnitude;

    const maxAxis = Math.ceil(targetMax / interval) * interval;
    const minAxis = isQ ? 0 : Math.floor(minVal / interval) * interval;

    return { min: minAxis, max: maxAxis, interval };
}

// Unit conversion factors (to SI: m3/h, m, kW)
const UNIT_CONV = {
    q: { m3h: 1, ls: 3.6, lmin: 0.06, usgpm: 0.2271247 },
    h: { m: 1, ft: 0.3048 },
    p2: { kW: 1, hp: 0.7457, W: 0.001 }
};

function toSIValue(val, unit, type) {
    if (!UNIT_CONV[type] || !UNIT_CONV[type][unit]) return val;
    return val * UNIT_CONV[type][unit];
}

function fromSIValue(val, unit, type) {
    if (!UNIT_CONV[type] || !UNIT_CONV[type][unit]) return val;
    return val / UNIT_CONV[type][unit];
}

function parseLocalFloat(val) {
    if (!val) return 0;
    const s = val.toString().trim();
    if (!s) return 0;
    return parseFloat(s.replace(',', '.')) || 0;
}



function getSIArray(id, type) {
    const val = document.getElementById(id).value.trim();
    if (!val) return [];
    const factor = getSIFactor(id, type);
    return val.split(/\s+/).map(v => parseLocalFloat(v) * factor).filter(n => !isNaN(n));
}

function getSISingle(id, type) {
    const factor = getSIFactor(id, type);
    return parseLocalFloat(document.getElementById(id).value) * factor;
}

function getLogoDims(imgObj) {
    const maxH = 160; const maxW = 440;
    let ratio = imgObj.naturalWidth / imgObj.naturalHeight;
    let w = maxH * ratio; let h = maxH;
    if (w > maxW) { w = maxW; h = maxW / ratio; }
    return { width: w, height: h };
}

/* ИСПРАВЛЕННЫЙ ВЫЗОВ CALC (УСТРАНЯЕТ ОШИБКУ 422) */
async function calc(save) {
    if (save && storageManager.isCloud() && !authManager.isAuthenticated()) {
        alert('Необходимо войти в систему для сохранения в облако');
        showLogin();
        return;
    }

    const qV = getSIArray('qText', 'q'), hV = getSIArray('hText', 'h');
    const p2V = getSIArray('p2Text', 'p2'), npshV = getSIArray('npshText', 'h'), effV = getSIArray('effText', 'eff');

    if (qV.length < 3) return alert("Ошибка: Необходимо ввести минимум 3 значения Q.");
    if (hV.length < 3) return alert("Ошибка: Необходимо ввести минимум 3 значения H.");
    if (qV.length !== hV.length) return alert(`Ошибка несоответствия: Количество значений H (${hV.length}) не совпадает с Q (${qV.length}).`);

    const errs = [];
    if (p2V.length > 0 && p2V.length !== qV.length) errs.push(`Ошибка несоответствия: Количество значений P2 (${p2V.length}) не совпадает с Q (${qV.length})`);
    if (npshV.length > 0 && npshV.length !== qV.length) errs.push(`Ошибка несоответствия: Количество значений NPSH (${npshV.length}) не совпадает с Q (${qV.length})`);
    if (effV.length > 0 && effV.length !== qV.length) errs.push(`Ошибка несоответствия: Количество значений КПД (${effV.length}) не совпадает с Q (${qV.length})`);

    [['Q', qV], ['H', hV], ['P2', p2V], ['NPSH', npshV], ['КПД', effV]].forEach(item => {
        if (item[1].some(x => x < 0)) errs.push(`Ошибка: Отрицательное значение в поле ${item[0]}`);
    });

    if (errs.length > 0) return alert(errs.join('\n'));

    const fd = new FormData();
    const ids = {
        'company': 'company', 'executor': 'executor', 'pumpName': 'name', 'oemName': 'oem_name',
        'dn_suction': 'dn_suction', 'dn_discharge': 'dn_discharge', 'rpm': 'rpm',
        'impeller': 'impeller_actual', 'price': 'price', 'currency': 'currency', 'comment': 'comment'
    };
    for (let k in ids) fd.append(ids[k], document.getElementById(k).value.toString());

    fd.append('q_req', getSISingle('qReq', 'q').toString());
    fd.append('h_req', getSISingle('hReq', 'h').toString());
    fd.append('h_st', getSISingle('hSt', 'h').toString());
    fd.append('p2_nom', getSISingle('p2_nom', 'p2').toString());

    fd.append('q_text', qV.join(' '));
    fd.append('h_text', hV.join(' '));
    fd.append('npsh_text', npshV.join(' '));
    fd.append('p2_text', p2V.join(' '));
    fd.append('eff_text', effV.join(' '));

    const currentId = document.getElementById('dispId').value;
    fd.append('save', save.toString());
    fd.append('save_source', 'points');
    if (currentId && currentId !== "NEW") fd.append('original_id', currentId);

    const now = new Date();
    const nowStr = now.toLocaleDateString('ru-RU') + ' ' +
        now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    fd.append('client_time', nowStr);

    if (save && currentId && currentId !== "NEW") {
        const choice = await showSaveModal(currentId);
        if (choice === 'cancel') return;
        if (choice === 'update') fd.append('id', currentId);
    } else if (currentId && currentId !== "NEW") {
        fd.append('id', currentId);
    }

    const fileList = document.getElementById('drawingFile').files;
    if (fileList.length > 0) fd.append('drawing', fileList[0]);

    try {
        const d = await storageManager.savePump(fd);
        if (d.id === "ERROR") throw new Error(d.message);
        if (save) {
            alert(`Успешно ${d.id == currentId ? 'обновлено' : 'создано'}: #${d.id}`);
            document.getElementById('dispId').value = d.id;
            loadArchive();
        }
        render(d);
    } catch (e) {
        alert("Ошибка: " + e.message);
        if (e.message.includes('401')) toggleAuth();
    }
}

// --- REFACTORED RENDER ---
function render(d, prefix = "") {
    const isModes = prefix === "modes-";
    const c1 = isModes ? chartCombo1_modes : chartCombo1;
    const c2 = isModes ? chartCombo2_modes : chartCombo2;
    const footerId = prefix + "mathFooter";
    const headerId = prefix + "mathHeader";
    const contentId = prefix + "mathContent";
    const coeffGridId = prefix + "coeffGrid";

    const dl = document.getElementById(prefix === "" ? 'drawLink' : 'modes-drawLink');
    // REMOVED: Legacy drawing link management that clobbered state during calc

    // For Modes, we might still have raw points (e.g. transferred from Digitizer)
    const qRaw = getSIArray('qText', 'q');
    const hRaw = getSIArray('hText', 'h');
    const effRaw = getSIArray('effText', 'eff');
    const p2Raw = getSIArray('p2Text', 'p2');
    const npshRaw = getSIArray('npshText', 'h');

    const getPoints = (yRaw) => qRaw.map((q, i) => [q, yRaw[i] !== undefined ? yRaw[i] : null]).filter(p => p[1] !== null);

    // Check data presence FIRST to use in R2 calculations
    const hasData = (coeffs, rawPoints) => {
        if (!coeffs) return (rawPoints && rawPoints.length > 0);
        const polyExists = coeffs.reduce((a, b) => a + Math.abs(b), 0) > 1e-9;
        return polyExists || (rawPoints && rawPoints.length > 0);
    };

    const hasHQ = hasData(d.h_coeffs, hRaw);
    const hasEff = hasData(d.eff_coeffs, effRaw);
    const hasP2 = hasData(d.p2_coeffs, p2Raw);
    const hasNpsh = hasData(d.npsh_coeffs, npshRaw);

    const r2H = hasHQ ? calculateRealR2(qRaw, hRaw, d.h_coeffs) : 1.0;
    const r2E = hasEff ? calculateRealR2(qRaw, effRaw, d.eff_coeffs) : null;
    const r2P = hasP2 ? calculateRealR2(qRaw, p2Raw, d.p2_coeffs) : null;
    const r2N = hasNpsh ? calculateRealR2(qRaw, npshRaw, d.npsh_coeffs) : null;

    const oem = document.getElementById(prefix + 'oemName').value,
        comp = document.getElementById(prefix + 'company').value,
        calcId = document.getElementById(prefix + 'dispId').value;
    const dateStr = new Date().toLocaleDateString('ru-RU');

    const qReq = getSISingle(prefix + 'qReq', 'q'),
        hReq = getSISingle(prefix + 'hReq', 'h'),
        hSt = getSISingle(prefix + 'hSt', 'h');

    const k = (hReq - hSt) / (qReq * qReq || 1);
    const f = (c, q) => (c[0] * Math.pow(q, 3) + c[1] * Math.pow(q, 2) + c[2] * q + c[3]);

    let qInt = 0, hInt = 0;
    let prevDiff = null;
    const step = Math.max(0.05, d.q_max / 2000);

    for (let q = 0; q <= d.q_max * 1.5; q += step) {
        const hP = f(d.h_coeffs, q);
        const hS = hSt + k * q * q;
        const diff = hP - hS;
        if (hP < 0) break;
        if (prevDiff !== null && diff <= 0 && prevDiff > 0) {
            const fraction = prevDiff / (prevDiff - diff);
            qInt = (q - step) + fraction * step;
            hInt = f(d.h_coeffs, qInt);
            break;
        }
        prevDiff = diff;
        if (q === 0 && diff <= 0) { qInt = 0; hInt = hP; break; }
    }

    const hPumpAtReq = f(d.h_coeffs, qReq);
    let drawLimit = qReq;
    if (hReq > hPumpAtReq) drawLimit = qReq;
    else if (qInt > qReq) drawLimit = qInt;
    else drawLimit = qReq;

    if (qInt === 0) { qInt = qReq; hInt = hReq; }

    // Generate data FIRST to determine true visual range
    const genData = (coeffs) => Array.from({ length: 100 }, (_, i) => {
        const q = d.q_min + (d.q_max - d.q_min) * (i / 99);
        return [q, f(coeffs, q)];
    });

    const hCurve = genData(d.h_coeffs);
    const npshCurve = genData(d.npsh_coeffs);
    const p2Curve = genData(d.p2_coeffs);
    const effCurve = genData(d.eff_coeffs);

    // Helper to get range from curve + specific points
    const getRange = (curve, extraPoints = []) => {
        const curveVals = curve.map(p => p[1]);
        return [...curveVals, ...extraPoints];
    };

    const qAxis = getNiceAxis([Math.max(d.q_max, drawLimit)], true);

    // H Axis: Curve + Req + Int + St
    const hAxis = getNiceAxis(getRange(hCurve, [hReq, hInt, hSt, f(d.h_coeffs, qInt)]));

    // Define point values
    const npshF = f(d.npsh_coeffs, qInt);
    const p2F = f(d.p2_coeffs, qInt);
    const effF = f(d.eff_coeffs, qInt);

    // NPSH Axis: Curve + Value at Qint
    const npshAxis = getNiceAxis(getRange(npshCurve, [npshF]));

    // P2 Axis: Curve + Value at Qint
    const p2Axis = getNiceAxis(getRange(p2Curve, [p2F]));

    // Eff Axis: Curve + Value at Qint
    const effAxis = getNiceAxis(getRange(effCurve, [effF]));

    const baseGrid = { left: 90, right: 90, bottom: 80 };
    const commonX = { type: 'value', name: 'Q [м³/ч]', min: 0, max: qAxis.max, interval: qAxis.interval, axisLine: { show: true, lineStyle: { width: 3 } }, axisLabel: { fontSize: 20 }, nameTextStyle: { fontSize: 22 }, nameLocation: 'middle', nameGap: 45 };

    const drawAll = (logoData = null, fontScale = 1) => {
        const fs = (size) => Math.round(size * fontScale);
        const graphic = [{
            type: 'group', left: 15, top: 10, children: [
                { type: 'text', style: { text: comp, font: `bold ${fs(32)}px Segoe UI`, fill: '#004085' }, top: 0 },
                { type: 'text', style: { text: 'ID: ' + calcId + ' | ' + dateStr, font: `${fs(26)}px Segoe UI`, fill: '#777' }, top: fs(45) }
            ]
        }];
        if (logoData) graphic.push({ type: 'image', id: 'logo', right: 20, top: 10, z: 100, style: logoData });

        const scaledX = { ...commonX, axisLabel: { fontSize: fs(24) }, nameTextStyle: { fontSize: fs(26) }, nameGap: fs(50) };

        const series1 = [];
        if (hasHQ) {
            series1.push({
                name: 'H Насос', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: genData(d.h_coeffs), lineStyle: { width: 5, color: '#004085' }, symbol: 'none', markLine: {
                    symbol: 'none', lineStyle: { type: 'dashed', color: '#333', width: 2 }, label: { fontSize: fs(22), formatter: (params) => params.value.toFixed(1) },
                    data: [{ xAxis: qInt }, [{ coord: [0, hInt], label: { position: 'start', distance: fs(45), formatter: (params) => hInt.toFixed(1) } }, { coord: [qInt, hInt] }]]
                }
            });
            series1.push({ name: 'H Данные', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0, data: getPoints(hRaw), itemStyle: { color: '#004085' }, symbolSize: 7 });
            series1.push({ name: 'Сеть', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: Array.from({ length: 100 }, (_, i) => (drawLimit / 99) * i).map(q => [q, hSt + k * q * q]), lineStyle: { type: 'dashed', color: '#666', width: 3 }, symbol: 'none' });
            series1.push({ name: 'РТ', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0, data: [[qInt, hInt]], itemStyle: { color: 'transparent' }, symbol: 'circle', symbolSize: 1, label: { show: true, formatter: 'РТ', position: 'top', color: '#28a745', fontSize: fs(20), fontWeight: 'bold' } });
            series1.push({ name: 'Задание', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0, data: [[qReq, hReq]], itemStyle: { color: '#dc3545' }, symbol: 'circle', symbolSize: 10, label: { show: true, formatter: 'Req', position: 'right', color: '#dc3545', fontSize: fs(18) } });
        }

        if (hasEff) {
            series1.push({
                name: 'КПД', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: genData(d.eff_coeffs), lineStyle: { width: 5, color: '#28a745' }, symbol: 'none', clip: false, markLine: {
                    symbol: 'none', lineStyle: { type: 'dashed', color: '#333', width: 2 }, label: { fontSize: fs(22), formatter: (params) => params.value.toFixed(1), position: 'end', distance: fs(45) },
                    data: [[{ coord: [qInt, effF], label: { position: 'end', distance: fs(45), formatter: (params) => effF.toFixed(1) } }, { coord: [qAxis.max, effF] }]]
                }
            });
            series1.push({ name: 'КПД Данные', type: 'scatter', xAxisIndex: 1, yAxisIndex: 1, data: getPoints(effRaw), itemStyle: { color: '#28a745' }, symbolSize: 7 });
        }

        c1.setOption({
            title: { text: oem || 'Pump Reference', left: 'center', top: fs(60), textStyle: { fontSize: fs(42), fontWeight: 'bold', color: '#000' }, show: hasHQ },
            tooltip: { trigger: 'axis' },
            grid: [{ ...baseGrid, top: fs(180), left: fs(90), right: fs(90), bottom: fs(80), show: hasHQ }, { ...baseGrid, height: '50%', top: null, bottom: fs(80), left: fs(90), right: fs(90), show: hasEff }],
            xAxis: [{ gridIndex: 0, ...scaledX, show: hasHQ }, { gridIndex: 1, ...scaledX, show: false }],
            yAxis: [
                { gridIndex: 0, type: 'value', name: hasHQ ? 'H [м]' : '', min: hAxis.min, max: hAxis.max, interval: hAxis.interval, position: 'left', axisLine: { onZero: false, show: hasHQ, lineStyle: { color: '#004085', width: 3 } }, axisTick: { show: hasHQ }, axisLabel: { show: hasHQ, fontSize: fs(24) }, nameTextStyle: { fontSize: fs(26) } },
                { gridIndex: 1, type: 'value', name: hasEff ? 'КПД [%]' : '', min: effAxis.min, max: effAxis.max, interval: effAxis.interval, position: 'right', splitLine: { show: false }, axisLine: { onZero: false, show: hasEff, lineStyle: { color: '#28a745', width: 3 } }, axisTick: { show: hasEff }, axisLabel: { show: hasEff, fontSize: fs(24) }, nameTextStyle: { fontSize: fs(26) } }
            ],
            graphic, series: series1, animation: false
        }, true);

        const series2 = [];
        const hasAny2 = hasP2 || hasNpsh;
        if (hasP2) {
            series2.push({
                name: 'P2', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: genData(d.p2_coeffs), lineStyle: { width: 5, color: '#ffa500' }, symbol: 'none', clip: false, markLine: {
                    symbol: 'none', lineStyle: { type: 'dashed', color: '#333' }, label: { fontSize: fs(22), formatter: (params) => params.value.toFixed(1) },
                    data: [{ xAxis: qInt }, [{ coord: [0, p2F], label: { position: 'start', distance: fs(45), formatter: (params) => p2F.toFixed(1) } }, { coord: [qInt, p2F] }]]
                }
            });
            series2.push({ name: 'P2 Данные', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0, data: getPoints(p2Raw), itemStyle: { color: '#ffa500' }, symbolSize: 7 });
        }
        if (hasNpsh) {
            series2.push({
                name: 'NPSH', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: genData(d.npsh_coeffs), lineStyle: { width: 4, color: '#dc3545' }, symbol: 'none', clip: false, markLine: {
                    symbol: 'none', lineStyle: { type: 'dashed', color: '#dc3545', width: 2 }, label: { fontSize: fs(22), formatter: (params) => params.value.toFixed(1), position: 'end', distance: fs(45) },
                    data: [[{ coord: [qInt, npshF], label: { position: 'end', distance: fs(45), formatter: (params) => npshF.toFixed(1) } }, { coord: [qAxis.max, npshF] }]]
                }
            });
            series2.push({ name: 'NPSH Данные', type: 'scatter', xAxisIndex: 1, yAxisIndex: 1, data: getPoints(npshRaw), itemStyle: { color: '#dc3545' }, symbolSize: 6 });
        }

        c2.setOption({
            title: { show: false }, tooltip: { trigger: 'axis' },
            grid: [{ ...baseGrid, top: fs(40), left: fs(90), right: fs(90), bottom: fs(80), show: hasAny2 }, { ...baseGrid, height: '50%', top: null, bottom: fs(80), left: fs(90), right: fs(90), show: hasNpsh }],
            xAxis: [{ gridIndex: 0, ...scaledX, show: hasAny2 }, { gridIndex: 1, ...scaledX, show: false }],
            yAxis: [
                { gridIndex: 0, type: 'value', name: hasP2 ? 'P2 [кВт]' : '', min: p2Axis.min, max: p2Axis.max, interval: p2Axis.interval, position: 'left', axisLine: { onZero: false, show: hasP2, lineStyle: { color: '#ffa500', width: 3 } }, axisTick: { show: hasP2 }, axisLabel: { show: hasP2, fontSize: fs(24) }, nameTextStyle: { fontSize: fs(26) } },
                { gridIndex: 1, type: 'value', name: hasNpsh ? 'NPSH [м]' : '', min: 0, max: npshAxis.max, interval: npshAxis.interval, position: 'right', splitLine: { show: false }, axisLine: { onZero: false, show: hasNpsh, lineStyle: { color: '#dc3545', width: 3 } }, axisTick: { show: hasNpsh }, axisLabel: { show: hasNpsh, fontSize: fs(24) }, nameTextStyle: { fontSize: fs(26) } }
            ],
            series: series2, animation: false
        }, true);
    };

    // Reactively sync drawing link state
    const pth = d.draw_path || d.drawing_path;
    if (pth) {
        currentDrawPath_calc = pth;
        currentDrawPath_modes = pth;
    }
    if (d.id && d.id !== "NEW") {
        if (!currentLoadedPump || currentLoadedPump.id !== d.id) currentLoadedPump = { ...d };
        else Object.assign(currentLoadedPump, d);
    }

    updateLink('');
    updateLink('modes-');

    drawAll();
    const lImg = new Image();
    // Unified Logo: always use 'logoImg' regardless of prefix
    const logoId = 'logoImg';
    const logoEl = document.getElementById(logoId);
    if (logoEl && logoEl.src) {
        lImg.src = logoEl.src;
        lImg.onload = () => {
            const dm = getLogoDims(lImg);
            const isExport = document.body.classList.contains('export-mode');
            drawAll({ image: lImg.src, height: dm.height, width: dm.width, opacity: 0.95 }, isExport ? 1.3 : 1);
        };
    } else {
        // Safe fallback if no logo
        console.warn("Logo element not found or empty");
    }

    const ft = document.getElementById(footerId);
    if (ft) {
        ft.style.display = 'block';
        console.log(`Showing footer: ${footerId}`);
    } else {
        console.error(`Footer ID not found: ${footerId}`);
    }

    const p2Val = f(d.p2_coeffs, qInt);
    const effVal = f(d.eff_coeffs, qInt);
    const npshVal = f(d.npsh_coeffs, qInt);
    const sep = '<span class="math-sep">|</span>';

    let mathHtml = `
        <div class="math-header-wrapper">
            <div class="math-results-header">Рабочая Точка (Факт)</div>
            <div class="math-op-row">
                <span class="math-op-item" title="Подача">Q = <span class="math-op-val">${qInt.toFixed(1)}</span> м³/ч</span>
                ${sep}
                <span class="math-op-item" title="Напор">H = <span class="math-op-val">${hInt.toFixed(1)}</span> м</span>
    `;
    if (hasP2) mathHtml += `${sep}<span class="math-op-item" title="Мощность">P2 = <span class="math-op-val">${p2Val.toFixed(2)}</span> kW</span>`;
    if (hasNpsh) mathHtml += `${sep}<span class="math-op-item" title="Кавитационный запас">NPSH = <span class="math-op-val">${npshVal.toFixed(2)}</span> m</span>`;
    if (hasEff) mathHtml += `${sep}<span class="math-op-item" title="КПД">КПД = <span class="math-op-val">${effVal.toFixed(1)}</span> %</span>`;
    mathHtml += `</div></div>`;

    document.getElementById(headerId).innerHTML = mathHtml;

    const fmtVal = (v) => {
        if (v === 0) return "0";
        return v.toFixed(12).replace(/\.?0+$/, '');
    };
    const kStr = fmtVal(k);

    document.getElementById(contentId).innerHTML = `
        <div class="network-block">
             <div><span class="network-title">СЕТЬ:</span> <span class="network-formula">H = Hst + K⋅Q²</span></div>
             <div><span class="network-coeff-label">Коэффициент</span> <span class="network-coeff-val">K = ${kStr}</span> <span style="font-size:12px; color:#888;">[м/(м³/ч)²]</span></div>
        </div>`;

    const row = (name, c, r2 = null) => `
        <tr>
            <td style="font-weight:600">${name}</td>
            <td>${fmtVal(c[3])}</td> <!-- A0 -->
            <td>${fmtVal(c[2])}</td> <!-- A1 -->
            <td>${fmtVal(c[1])}</td> <!-- A2 -->
            <td>${fmtVal(c[0])}</td> <!-- A3 -->
            <td style="color:var(--text-secondary); font-family:var(--font-mono); text-align:right;">${r2 !== null ? r2.toFixed(4) : '-'}</td>
        </tr>
    `;

    document.getElementById(coeffGridId).innerHTML = `
        <div class="network-title" style="margin-bottom:8px; margin-top:16px; padding-top:16px; border-top:1px solid var(--border-light);">КОЭФФИЦИЕНТЫ ПОЛИНОМОВ:</div>
        <table class="coeff-table">
            <thead><tr><th>Параметр</th><th>A0 (Free)</th><th>A1 (Q)</th><th>A2 (Q²)</th><th>A3 (Q³)</th><th style="text-align:right">R² (Точн.)</th></tr></thead>
            <tbody>
                ${hasHQ ? row('H-Q', d.h_coeffs, r2H) : ''}
                ${hasEff ? row('КПД', d.eff_coeffs, r2E) : ''}
                ${hasP2 ? row('P2', d.p2_coeffs, r2P) : ''}
                ${hasNpsh ? row('NPSH', d.npsh_coeffs, r2N) : ''}
            </tbody>
        </table>
        <div class="math-accuracy" style="margin-top:8px;">
            Диапазон применимости: Qmin = ${d.q_min} м³/ч, Qmax = ${d.q_max} м³/ч
        </div>
    `;
}

function getSIFactor(id, type) {
    const curveUnits = {
        'qText': 'q_curve_unit', 'hText': 'h_curve_unit', 'npshText': 'npsh_curve_unit', 'p2Text': 'p2_curve_unit',
        'modes-qMin': 'modes-q_curve_unit', 'modes-qMax': 'modes-q_curve_unit',
        'modes-h-a0': 'modes-h_curve_unit', 'modes-p2-a0': 'modes-p2_curve_unit', 'modes-npsh-a0': 'modes-npsh_curve_unit'
    };
    const unitId = curveUnits[id] || (id.startsWith('modes-') ? 'modes-' + type + '_unit' : type + '_unit');
    const unit = document.getElementById(unitId)?.value || (type === 'q' ? 'm3h' : (type === 'h' ? 'm' : 'kW'));
    return UNIT_CONV[type]?.[unit] || 1;
}

// --- CALC MODES (NEW) ---
async function calcModes(save) {
    if (save && storageManager.isCloud() && !authManager.isAuthenticated()) {
        alert('Необходимо войти в систему для сохранения в облако');
        showLogin();
        return;
    }

    const parseC = (id) => {
        const val = document.getElementById(id).value;
        return parseLocalFloat(val || "0");
    };

    const factorQ = getSIFactor('modes-qMin', 'q');
    const getCoeffsSI = (p) => {
        const type = (p === 'p2') ? 'p2' : 'h';
        const factorY = (p === 'eff') ? 1 : getSIFactor(`modes-${p}-a0`, type);
        return [
            parseC(`modes-${p}-a3`) * factorY / Math.pow(factorQ, 3),
            parseC(`modes-${p}-a2`) * factorY / Math.pow(factorQ, 2),
            parseC(`modes-${p}-a1`) * factorY / factorQ,
            parseC(`modes-${p}-a0`) * factorY
        ];
    };

    const d = {
        h_coeffs: getCoeffsSI('h'),
        eff_coeffs: getCoeffsSI('eff'),
        p2_coeffs: getCoeffsSI('p2'),
        npsh_coeffs: getCoeffsSI('npsh'),
        q_min: parseC('modes-qMin') * factorQ,
        q_max: parseC('modes-qMax') * factorQ,
        draw_path: ""
    };

    if (save) {
        const fd = new FormData();
        const ids = {
            'modes-company': 'company', 'modes-executor': 'executor', 'modes-pumpName': 'name', 'modes-oemName': 'oem_name',
            'modes-dn_suction': 'dn_suction', 'modes-dn_discharge': 'dn_discharge', 'modes-rpm': 'rpm',
            'modes-impeller': 'impeller_actual', 'modes-comment': 'comment',
            'modes-price': 'price', 'modes-currency': 'currency'
        };
        for (let k in ids) fd.append(ids[k], document.getElementById(k).value.toString());

        fd.append('q_req', getSISingle('modes-qReq', 'q').toString());
        fd.append('h_req', getSISingle('modes-hReq', 'h').toString());
        fd.append('h_st', getSISingle('modes-hSt', 'h').toString());
        fd.append('p2_nom', getSISingle('modes-p2_nom', 'p2').toString());
        fd.append('q_min', d.q_min.toString());
        fd.append('q_max', d.q_max.toString());

        const f_poly = (c, q) => (c[0] * Math.pow(q, 3) + c[1] * Math.pow(q, 2) + c[2] * q + c[3]);
        const hAtQMin = f_poly(d.h_coeffs, d.q_min);
        const hAtQMax = f_poly(d.h_coeffs, d.q_max);
        fd.append('h_min', Math.min(hAtQMin, hAtQMax).toString());
        fd.append('h_max', Math.max(hAtQMin, hAtQMax).toString());

        const currentId = document.getElementById('modes-dispId').value;
        fd.append('q_text', "MODES");
        fd.append('h_text', JSON.stringify(d.h_coeffs));
        fd.append('eff_text', JSON.stringify(d.eff_coeffs));
        fd.append('p2_text', JSON.stringify(d.p2_coeffs));
        fd.append('npsh_text', JSON.stringify(d.npsh_coeffs));
        fd.append('save', "true");
        fd.append('save_source', "coeffs");
        if (currentId && currentId !== "NEW") fd.append('original_id', currentId);

        const now = new Date();
        const nowStr = now.toLocaleDateString('ru-RU') + ' ' +
            now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        fd.append('client_time', nowStr);

        const fileList = document.getElementById('modes-drawingFile').files;
        if (fileList.length > 0) fd.append('drawing', fileList[0]);
        if (currentId && currentId !== "NEW") {
            const choice = await showSaveModal(currentId);
            if (choice === 'cancel') return;
            if (choice === 'update') fd.append('id', currentId);
        }

        try {
            const res = await storageManager.savePump(fd);
            if (res.id && res.id !== "ERROR") {
                alert(`Успешно ${res.id == currentId ? 'обновлено' : 'создано'}: #${res.id}`);
                document.getElementById('modes-dispId').value = res.id;
                loadArchive();
            }
        } catch (e) { alert("Save Error: " + e.message); }
    }

    render(d, "modes-");
}

async function downloadAllPNG() {
    const cs = [chartCombo1, chartCombo2];
    const pr = 2;

    let w = 0, h = 0;
    cs.forEach(c => {
        w = Math.max(w, c.getWidth());
        h += c.getHeight();
    });

    const canvas = document.createElement('canvas');
    canvas.width = w * pr;
    canvas.height = h * pr;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let currentY = 0;
    for (const c of cs) {
        const cw = c.getWidth();
        const ch = c.getHeight();

        await new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, currentY * pr, cw * pr, ch * pr);
                currentY += ch;
                resolve();
            };
            img.src = c.getDataURL({ pixelRatio: pr, backgroundColor: '#fff' });
        });
    }

    const titleObj = chartCombo1.getOption().title;
    const titleText = (Array.isArray(titleObj) ? titleObj[0].text : titleObj.text) || 'chart';

    const l = document.createElement('a');
    l.href = canvas.toDataURL('image/png');
    l.download = `RusPump_Report_${titleText.replace(/\s+/g, '_')}.png`;
    l.click();
}

async function loadArchive() {
    console.log('--- FETCHING ARCHIVE ---');
    try {
        const data = await storageManager.getPumps();
        console.log(`--- ARCHIVE FETCHED: ${data.length} records ---`);
        globalArchiveData = data;
        window.globalArchiveData = data;
        filterArchive();
    } catch (err) {
        console.error('Archive Error:', err);
        if (err.message.includes('401')) {
            console.warn('Session expired. Logging out.');
            alert('Срок действия сессии истек. Пожалуйста, войдите снова.');
            authManager.logout();
            toggleAuth(); // Show login
            updateUIForMode();
        }
    }
}

function filterArchive() {
    const query = document.getElementById('globalSearch').value.toLowerCase();
    const inputs = document.querySelectorAll('#filterRow input');
    const filters = {};
    inputs.forEach(i => {
        const val = i.value.trim().toLowerCase();
        if (val) filters[i.getAttribute('f-key')] = val;
    });

    const NUMERIC_KEYS = ['id', 'q_req', 'h_req', 'q_min', 'q_max', 'h_min', 'h_max', 'p2_nom', 'dn_suction', 'dn_discharge', 'price'];

    if (!globalArchiveData) return;

    const filtered = globalArchiveData.filter(p => {
        // Global Search
        if (query) {
            const allStr = Object.values(p).join(' ').toLowerCase();
            if (!allStr.includes(query)) return false;
        }
        // Columns Filters
        for (let k in filters) {
            const filterVal = filters[k];
            const dataVal = (p[k] || '').toString().toLowerCase();

            if (NUMERIC_KEYS.includes(k) && !isNaN(parseFloat(p[k]))) {
                const numericData = parseFloat(p[k]);

                // Greater than or equal: >=100
                if (filterVal.startsWith('>=')) {
                    const threshold = parseFloat(filterVal.substring(2));
                    if (isNaN(threshold) || numericData < threshold) return false;
                    continue;
                }
                // Less than or equal: <=100
                if (filterVal.startsWith('<=')) {
                    const threshold = parseFloat(filterVal.substring(2));
                    if (isNaN(threshold) || numericData > threshold) return false;
                    continue;
                }
                // Greater than: >100
                if (filterVal.startsWith('>')) {
                    const threshold = parseFloat(filterVal.substring(1));
                    if (isNaN(threshold) || numericData <= threshold) return false;
                    continue;
                }
                // Less than: <100
                if (filterVal.startsWith('<')) {
                    const threshold = parseFloat(filterVal.substring(1));
                    if (isNaN(threshold) || numericData >= threshold) return false;
                    continue;
                }
                // Range: 100-500
                if (filterVal.includes('-')) {
                    const parts = filterVal.split('-').map(v => parseFloat(v));
                    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                        if (numericData < parts[0] || numericData > parts[1]) return false;
                        continue;
                    }
                }
                // List: 10, 20, 30
                if (filterVal.includes(',')) {
                    const list = filterVal.split(',').map(v => parseFloat(v.trim()));
                    if (!list.includes(numericData)) return false;
                    continue;
                }
            }

            // Fallback for non-numeric or simple string match
            if (!dataVal.includes(filterVal)) return false;
        }
        return true;
    });

    console.log(`--- ARCHIVE FILTERED: ${filtered.length} of ${globalArchiveData.length} visible ---`);
    renderTableBody(filtered);
}

function resetFilters() {
    console.log('--- RESETTING ALL FILTERS ---');
    if (document.getElementById('globalSearch')) document.getElementById('globalSearch').value = '';

    document.querySelectorAll('#filterRow input').forEach(input => input.value = '');

    filterArchive();
}
window.resetFilters = resetFilters;

function renderTableBody(data) {
    const v = (val) => (val === null || val === undefined || val === '') ? '-' : val;
    const vNum = (val) => {
        if (val === null || val === undefined || val === '' || isNaN(val)) return '-';
        return parseFloat(Number(val).toFixed(2)).toString();
    };
    const fPrice = (val) => {
        if (val === null || val === undefined || val === '' || isNaN(val)) return '-';
        const parts = val.toString().split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
        return parts.join('.');
    };
    document.getElementById('archiveBody').innerHTML = data.map(p => `
        <tr onclick='loadPumpData(${p.id})'>
            <td>#${p.id}</td>
            <td>${v(p.name)}</td>
            <td>${v(p.oem_name)}</td>
            <td>${v(p.company)}</td>
            <td>${v(p.created_at)}</td>
            <td>${v(p.updated_at)}</td>
            <td>${vNum(p.q_req)}</td>
            <td>${vNum(p.h_req)}</td>
            <td>${vNum(p.q_min)}</td>
            <td>${vNum(p.q_max)}</td>
            <td>${vNum(p.h_min)}</td>
            <td>${vNum(p.h_max)}</td>
            <td>${vNum(p.p2_nom)}</td>
            <td>${vNum(p.dn_suction)}</td>
            <td>${vNum(p.dn_discharge)}</td>
            <td>${fPrice(p.price)}</td>
            <td>${v(p.currency)}</td>
            <td>${v(p.comment)}</td>
            <td>${v(p.drawing_filename)}</td>
            <td style="text-align:center; color:${p.drawing_path ? 'green' : '#ccc'}">${p.drawing_path ? '✔' : '✖'}</td>
            <td onclick="deletePump(${p.id}, event)" style="text-align:center; cursor:pointer; font-size: 16px;" title="Удалить">🗑</td>
        </tr>`).join('');
}

async function loadPumpData(id) {
    const p = globalArchiveData.find(x => x.id == id);
    if (!p) return;

    resetAllFields();

    const source = p.save_source || (p.q_text === 'MODES' ? 'coeffs' : 'points');

    const fillTab = (prefix) => {
        const setVal = (fid, v) => {
            const el = document.getElementById(prefix + fid);
            if (el) el.value = v === 0 ? "0" : (v || "");
        };

        setVal('dispId', p.id);
        setVal('company', p.company);
        setVal('executor', p.executor);
        setVal('pumpName', p.name);
        setVal('oemName', p.oem_name);
        setVal('dn_suction', p.dn_suction);
        setVal('dn_discharge', p.dn_discharge);
        setVal('rpm', p.rpm);
        setVal('impeller', p.impeller_actual);
        setVal('comment', p.comment);
        setVal('p2_nom', p.p2_nom);
        setVal('price', p.price);
        setVal('currency', p.currency);

        const qUnitEl = document.getElementById(prefix + 'q_unit') || document.getElementById(prefix + 'q_curve_unit');
        const hUnitEl = document.getElementById(prefix + 'h_unit') || document.getElementById(prefix + 'h_curve_unit');
        const hStEl = document.getElementById(prefix + 'hSt');

        if (qUnitEl) setVal('qReq', fromSIValue(p.q_req, qUnitEl.value, 'q'));
        if (hUnitEl) setVal('hReq', fromSIValue(p.h_req, hUnitEl.value, 'h'));
        if (hStEl && hUnitEl) setVal('hSt', fromSIValue(p.h_st, hUnitEl.value, 'h'));

        if (prefix === '') {
            setVal('qText', p.q_text);
            setVal('hText', p.h_text);
            setVal('effText', p.eff_text);
            setVal('p2Text', p.p2_text);
            setVal('npshText', p.npsh_text);
        } else {
            const fillCoeffs = (key, coeffs) => {
                if (!coeffs) return;
                try {
                    let c = (typeof coeffs === 'string') ? JSON.parse(coeffs) : coeffs;
                    setVal(`${key}-a0`, c[3]);
                    setVal(`${key}-a1`, c[2]);
                    setVal(`${key}-a2`, c[1]);
                    setVal(`${key}-a3`, c[0]);
                } catch (e) { }
            };
            fillCoeffs('h', p.h_coeffs);
            fillCoeffs('eff', p.eff_coeffs);
            fillCoeffs('p2', p.p2_coeffs);
            fillCoeffs('npsh', p.npsh_coeffs);

            const qUnit = document.getElementById('modes-q_curve_unit')?.value || 'm3h';
            setVal('qMin', fromSIValue(p.q_min, qUnit, 'q'));
            setVal('qMax', fromSIValue(p.q_max, qUnit, 'q'));
        }
    };

    if (source === 'coeffs') {
        fillTab('modes-');
    } else {
        fillTab('');
        fillTab('modes-');
    }

    currentLoadedPump = p;
    if (source === 'coeffs') {
        await updateLink('modes-', p);
        await updateLink('', null); // Clear link from Points tab
    } else {
        await updateLink('', p);
        await updateLink('modes-', p);
    }

    if (source === 'coeffs') {
        showTab('modes');
        calcModes(false);
    } else {
        showTab('calc');
        calc(false);
    }
}

function loadLogo(i, targetId = 'logoImg') {
    if (i.files && i.files[0]) {
        const r = new FileReader();
        r.onload = e => {
            const img = document.getElementById(targetId);
            if (img) img.src = e.target.result;
            // Trigger redraw of active tab if applicable
            const activeTab = document.querySelector('.tab-btn.active').getAttribute('onclick').includes('modes') ? 'modes' : 'calc';
            if (activeTab === 'calc') calc(false);
            if (activeTab === 'modes') calcModes(false);
        };
        r.readAsDataURL(i.files[0]);
    }
}

function importCSV(input) {
    const reader = new FileReader();
    reader.onload = e => {
        const rows = e.target.result.split('\n').filter(row => row.trim() !== '');
        const data = rows.slice(1).map(r => r.split(','));
        document.getElementById('qText').value = data.map(r => r[0]).join(' '); document.getElementById('hText').value = data.map(r => r[1]).join(' ');
        document.getElementById('npshText').value = data.map(r => r[2]).join(' '); document.getElementById('p2Text').value = data.map(r => r[3]).join(' ');
        document.getElementById('effText').value = data.map(r => r[4]).join(' ');
    };
    reader.readAsText(input.files[0]);
}
async function deletePump(id, event) {
    if (event) event.stopPropagation();
    if (!confirm(`Удалить расчет ID: ${id}?`)) return;

    try {
        await storageManager.deletePump(id);
        const currentTabId = document.getElementById('dispId').value;
        const currentModesId = document.getElementById('modes-dispId').value;

        if (currentTabId == id) document.getElementById('dispId').value = "NEW";
        if (currentModesId == id) document.getElementById('modes-dispId').value = "NEW";

        loadArchive();
    } catch (err) {
        alert('Ошибка при удалении: ' + err.message);
    }
}

async function exportDB() {
    if (storageManager.isCloud()) {
        window.location.href = `${API}/api/admin/export_db`;
    } else {
        const data = await storageManager.getPumps();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ruspump_archive_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
    }
}

async function importDB(input) {
    if (!input.files || !input.files[0]) return;
    pendingImportFile = input.files[0];
    document.getElementById('importModal').style.display = 'block';
}

async function finalizeImport(merge) {
    if (!pendingImportFile) return;
    document.getElementById('importModal').style.display = "none";

    const fd = new FormData();
    fd.append("file", pendingImportFile);
    fd.append("merge", merge.toString());

    try {
        if (storageManager.isCloud()) {
            const r = await fetch(`${API}/api/admin/import_db`, { method: 'POST', body: fd });
            const d = await r.json();
            if (r.ok && d.status === 'ok') {
                alert(d.message);
                window.location.reload();
            } else {
                alert("Ошибка: " + (d.message || d.detail || "Unknown error"));
            }
        } else {
            // Local merge logic
            const content = await pendingImportFile.text();
            const newData = JSON.parse(content);
            const adapter = storageManager.localAdapter;
            if (merge) {
                adapter.data = [...adapter.data, ...newData];
            } else {
                adapter.data = newData;
            }
            await adapter.saveToFile();
            loadArchive();
        }
    } catch (e) {
        alert("Ошибка импорта: " + e.message);
    }
    document.getElementById('dbUpload').value = "";
    pendingImportFile = null;
}

// ========== PDF EXPORT WITH MERGE ==========
async function exportToPNG() {
    let stageElement = document.querySelector('.stage-view.active .stage');
    if (!stageElement) {
        const activeView = document.querySelector('.workspace-view.active');
        stageElement = activeView?.querySelector('.stage');
    }
    if (!stageElement) {
        alert('Графики не найдены');
        return;
    }

    const parentId = stageElement.parentElement.id;
    const prefix = (parentId === 'stage-modes' || parentId === 'tab-modes') ? 'modes-' : '';

    document.getElementById('exportLoader').style.display = 'flex';
    document.body.classList.add('export-mode');

    [chartCombo1, chartCombo2, chartCombo1_modes, chartCombo2_modes].forEach(c => {
        if (c) c.resize();
    });

    await new Promise(r => setTimeout(r, 200));

    try {
        const A4_WIDTH_PX = 4960;
        const A4_HEIGHT_PX = 7016;
        const SIDE_MARGIN = 80;
        const TOP_MARGIN = 80;

        const rect = stageElement.getBoundingClientRect();
        const availableWidth = A4_WIDTH_PX - (2 * SIDE_MARGIN);
        const availableHeight = A4_HEIGHT_PX - (2 * TOP_MARGIN);
        const scale = Math.min(availableWidth / rect.width, availableHeight / rect.height);

        const canvas = await html2canvas(stageElement, {
            backgroundColor: '#ffffff',
            scale: scale,
            width: rect.width,
            height: rect.height,
            logging: false,
            useCORS: true,
            allowTaint: true
        });

        const a4Canvas = document.createElement('canvas');
        a4Canvas.width = A4_WIDTH_PX;
        a4Canvas.height = A4_HEIGHT_PX;
        const ctx = a4Canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, A4_WIDTH_PX, A4_HEIGHT_PX);

        const scaledWidth = rect.width * scale;
        const scaledHeight = rect.height * scale;
        const imgX = (A4_WIDTH_PX - scaledWidth) / 2;
        const imgY = TOP_MARGIN;

        ctx.drawImage(canvas, imgX, imgY, scaledWidth, scaledHeight);
        const imgData = a4Canvas.toDataURL('image/JPEG', 0.90);

        const { PDFDocument } = PDFLib;
        const pdfDoc = await PDFDocument.create();

        const chartImg = await pdfDoc.embedJpg(imgData);
        const page1 = pdfDoc.addPage([595.28, 841.89]);
        page1.drawImage(chartImg, {
            x: 0,
            y: 0,
            width: 595.28,
            height: 841.89,
        });

        const drawingInput = document.getElementById(prefix + 'drawingFile');
        let mergeData = null;
        let mimeType = null;

        const getType = (mime) => {
            if (mime === 'application/pdf') return 'pdf';
            if (mime && mime.startsWith('image/')) return 'image';
            return null;
        };

        if (drawingInput && drawingInput.files.length > 0) {
            const file = drawingInput.files[0];
            mimeType = file.type;
            if (getType(mimeType)) mergeData = await file.arrayBuffer();
        } else {
            const currentPump = window.currentLoadedPump;
            if (currentPump && currentPump.drawing_filename) {
                try {
                    if (storageManager.isCloud()) {
                        const url = `${API}/api/drawings/${currentPump.id}`;
                        const resp = await fetch(url, { headers: authManager.getAuthHeader() });
                        if (resp.ok) {
                            const blob = await resp.blob();
                            mimeType = blob.type;
                            mergeData = await blob.arrayBuffer();
                        }
                    } else if (currentPump.drawing_data) {
                        // Base64 to ArrayBuffer for local mode
                        const base64 = currentPump.drawing_data.split(',')[1];
                        const binary = atob(base64);
                        const len = binary.length;
                        const bytes = new Uint8Array(len);
                        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
                        mergeData = bytes.buffer;
                        mimeType = currentPump.drawing_data.split(';')[0].split(':')[1];
                    }
                } catch (e) { console.error("Error fetching drawing for merge:", e); }
            }
        }

        if (mergeData) {
            const mergeType = getType(mimeType);
            if (mergeType === 'pdf') {
                const donorPdfDoc = await PDFDocument.load(mergeData);
                const pagesToCopy = donorPdfDoc.getPageIndices();
                const copiedPages = await pdfDoc.copyPages(donorPdfDoc, pagesToCopy);
                copiedPages.forEach((page) => pdfDoc.addPage(page));
            } else if (mergeType === 'image') {
                let embeddedImg = (mimeType === 'image/png') ? await pdfDoc.embedPng(mergeData) : await pdfDoc.embedJpg(mergeData);
                const { width, height } = embeddedImg.scale(1);
                const page = pdfDoc.addPage([595.28, 841.89]);
                const scaleImg = Math.min(595.28 / width, 841.89 / height);
                const drawWidth = width * scaleImg;
                const drawHeight = height * scaleImg;
                page.drawImage(embeddedImg, {
                    x: (595.28 - drawWidth) / 2,
                    y: (841.89 - drawHeight) / 2,
                    width: drawWidth,
                    height: drawHeight,
                });
            }
        }

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const comp = document.getElementById(prefix + 'company')?.value || 'Report';
        link.download = `${comp}_${timestamp}.pdf`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Export error:', error);
        alert('Ошибка экспорта: ' + error.message);
    } finally {
        document.getElementById('exportLoader').style.display = 'none';
        document.body.classList.remove('export-mode');
        void document.body.offsetWidth;
        [chartCombo1, chartCombo2, chartCombo1_modes, chartCombo2_modes].forEach(c => {
            if (c) c.resize();
        });
    }
}

function setupSync() {
    const fields = ['company', 'executor', 'pumpName', 'oemName', 'dn_suction', 'dn_discharge', 'rpm', 'impeller', 'p2_nom', 'price', 'currency', 'qReq', 'hReq', 'hSt'];
    fields.forEach(f => {
        const calcEl = document.getElementById(f);
        const modesEl = document.getElementById('modes-' + f);
        if (!calcEl || !modesEl) return;
        const updateFn = (src, dst) => {
            if (dst.value !== src.value) {
                dst.value = src.value;
                if (f === 'pumpName') {
                    const prefix = src.id === 'pumpName' ? '' : 'modes-';
                    if (typeof window.syncOEM === 'function') window.syncOEM(src.value, prefix);
                }
            }
        };
        const events = ['input', 'change'];
        events.forEach(evt => {
            calcEl.addEventListener(evt, () => updateFn(calcEl, modesEl));
            modesEl.addEventListener(evt, () => updateFn(modesEl, calcEl));
        });
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    setupSync();

    // Sync UI with current storage mode
    const modeSelector = document.getElementById('modeSelector');
    if (modeSelector) {
        modeSelector.value = storageManager.currentMode;
    }
    updateUIForMode();

    // Load initial archive
    try {
        await loadArchive();
        // Reveal app
        document.body.classList.add('loaded');
    } catch (e) {
        console.error("Initialization error:", e);
        document.body.classList.add('loaded'); // Fallback
    }
});

