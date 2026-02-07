/**
 * DIGITIZER MODULE CORE LOGIC v3.0
 * Requirements: 
 * 1. Global X Calibration (Fixed X0, X1).
 * 2. Individual Y Calibration (Y0, Y1 per mode).
 * 3. Master Q Synchronization (First mode sets Q points; others snap to them).
 * 4. Max 4 Points.
 */

/**
 * DIGITIZER MODULE CORE LOGIC v3.1
 * Changes:
 * - Draggable Origin Lines (X0, Y0).
 * - Clarified "Fix Origin" logic (Cancel resets only Y).
 * - Fixed Scaling directions.
 */

/**
 * DIGITIZER MODULE CORE LOGIC v3.2
 * Changes:
 * - Export Logic: Uses MasterQ as definitive X-axis. Aligns all Y-arrays (H, P, etc) to it, filling 0s for missing points.
 * - Point Capture: Highlights MasterQ line when snapped.
 * - Draggable Origins: Retained from v3.1
 */

/**
 * DIGITIZER MODULE CORE LOGIC v3.3
 * Changes:
 * - Smart "Fix Origin": If X set, only updates Y0 (Current Mode). No dialogs.
 * - Decoupled X0/Y0 objects to allow independent dragging.
 * - Ensure Y Scale Helpers are reset correctly on Origin update.
 */

const DigiCore = (() => {
    // --- STATE ---
    let canvas, ctx, container;
    let image = null;
    let isDragging = false;
    let lastMouse = { x: 0, y: 0 };
    let dragTarget = null;

    // View Transform
    let transform = { x: 0, y: 0, scale: 1 };

    // CALIBRATION DATA
    let calX = {
        p0: null, // Origin X (Image Coord)
        p1: null, // Scale X (Image Coord)
        val0: 0,
        val1: 100
    };

    // Y is Local (Per Mode)
    const calY_Default = { p0: null, p1: null, val0: 0, val1: 100 };
    const calY_Store = {
        'QH': JSON.parse(JSON.stringify(calY_Default)),
        'QP': JSON.parse(JSON.stringify(calY_Default)),
        'QN': JSON.parse(JSON.stringify(calY_Default)),
        'QE': JSON.parse(JSON.stringify(calY_Default))
    };

    // Helper Lines
    const modeColors = {
        'QH': '#ff4d4d', // Red
        'QP': '#2ecc71', // Green
        'QN': '#3498db', // Blue
        'QE': '#f39c12'  // Orange
    };
    const modeDisplayNames = {
        'QH': 'Q-H',
        'QP': 'Q-P',
        'QN': 'Q-N',
        'QE': 'Q-E'
    };

    // POINTS & SYNC
    const pointsStore = { 'QH': [], 'QP': [], 'QN': [], 'QE': [] };
    let masterQ = [];
    let masterMode = null; // Tracks which mode is defining the Master Axes

    let currentMode = 'QH';
    let showCurves = false;

    // --- REGRESSION ENGINE ---
    function polyFit(pts, degree = 3) {
        if (!pts || pts.length < 2) return null;
        const n = pts.length;
        const actualDegree = Math.min(degree, n - 1);

        // Normalize X for numerical stability
        const maxX = Math.max(...pts.map(p => Math.abs(p.x))) || 1;
        const normPts = pts.map(p => ({ x: p.x / maxX, y: p.y }));

        const X = [], Y = [];
        for (let i = 0; i <= 2 * actualDegree; i++) {
            let sum = 0;
            for (let j = 0; j < n; j++) sum += Math.pow(normPts[j].x, i);
            X.push(sum);
        }
        for (let i = 0; i <= actualDegree; i++) {
            let sum = 0;
            for (let j = 0; j < n; j++) sum += Math.pow(normPts[j].x, i) * normPts[j].y;
            Y.push(sum);
        }
        const matrix = [];
        for (let i = 0; i <= actualDegree; i++) {
            matrix[i] = [];
            for (let j = 0; j <= actualDegree; j++) matrix[i][j] = X[i + j];
            matrix[i][actualDegree + 1] = Y[i];
        }
        for (let i = 0; i <= actualDegree; i++) {
            let max = i;
            for (let j = i + 1; j <= actualDegree; j++) if (Math.abs(matrix[j][i]) > Math.abs(matrix[max][i])) max = j;
            let temp = matrix[i]; matrix[i] = matrix[max]; matrix[max] = temp;
            if (Math.abs(matrix[i][i]) < 1e-18) return null;
            for (let j = i + 1; j <= actualDegree; j++) {
                const f = matrix[j][i] / matrix[i][i];
                for (let k = i; k <= actualDegree + 1; k++) matrix[j][k] -= matrix[i][k] * f;
            }
        }
        const coeffs = [];
        for (let i = actualDegree; i >= 0; i--) {
            let s = 0;
            for (let j = i + 1; j <= actualDegree; j++) s += matrix[i][j] * coeffs[j];
            coeffs[i] = (matrix[i][actualDegree + 1] - s) / matrix[i][i];
        }
        // Denormalize: Ai = Bi / (maxX^i)
        return coeffs.map((b, i) => b / Math.pow(maxX, i));
    }

    function calculateRMSE(pts, coeffs) {
        if (!pts || pts.length < 2 || !coeffs) return null;
        let sumSqErr = 0;
        pts.forEach(p => {
            let yFit = 0;
            for (let d = 0; d < coeffs.length; d++) {
                yFit += coeffs[d] * Math.pow(p.x, d);
            }
            sumSqErr += Math.pow(p.y - yFit, 2);
        });
        return Math.sqrt(sumSqErr / pts.length);
    }

    function calculateR2(pts, coeffs) {
        if (!pts || pts.length < 2 || !coeffs) return null;
        let yMean = 0;
        pts.forEach(p => yMean += p.y);
        yMean /= pts.length;

        let ssRes = 0;
        let ssTot = 0;
        pts.forEach(p => {
            let yFit = 0;
            for (let d = 0; d < coeffs.length; d++) {
                yFit += coeffs[d] * Math.pow(p.x, d);
            }
            ssRes += Math.pow(p.y - yFit, 2);
            ssTot += Math.pow(p.y - yMean, 2);
        });
        if (ssTot === 0) return 1;
        return 1 - (ssRes / ssTot);
    }

    function buildCurves() {
        showCurves = !showCurves;
        updateUI();
        draw();
    }

    function init() {
        canvas = document.getElementById('digiCanvas');
        ctx = canvas.getContext('2d');
        container = document.getElementById('digiContainer');

        new ResizeObserver(() => {
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;
            draw();
        }).observe(container);

        setupEvents();
    }

    function setupEvents() {
        document.getElementById('imgUpload').addEventListener('change', handleImageUpload);

        document.querySelectorAll('input[name="digMode"]').forEach(el => {
            el.addEventListener('change', (e) => switchMode(e.target.value));
        });

        container.addEventListener('mousedown', onMouseDown);
        container.addEventListener('mousemove', onMouseMove);
        container.addEventListener('mouseup', onMouseUp);
        container.addEventListener('wheel', handleZoom, { passive: false });

        bindInput('valX0', (v) => calX.val0 = v);
        bindInput('valY0', (v) => getCurrentCalY().val0 = v);
        bindInput('valX1', (v) => calX.val1 = v);
        bindInput('valY1', (v) => { getCurrentCalY().val1 = v; draw(); });

        document.getElementById('btnFixX0').addEventListener('click', () => fixCoord('X0'));
        document.getElementById('btnFixY0').addEventListener('click', () => fixCoord('Y0'));
        document.getElementById('btnFixX1').addEventListener('click', () => fixCoord('X1'));
        document.getElementById('btnFixY1').addEventListener('click', () => fixCoord('Y1'));

        document.getElementById('btnAddPoint').addEventListener('click', capturePoint);

        document.addEventListener('keydown', (e) => {
            // Ignore if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.code === 'Space') {
                const tab = document.getElementById('tab-digitizer');
                // Ensure tab is active/visible
                if (tab && (tab.classList.contains('active') || tab.style.display !== 'none')) {
                    e.preventDefault();
                    capturePoint();
                }
            }
        });

        // Prevent Panning while interacting with panels
        document.querySelectorAll('.digi-panel').forEach(panel => {
            const stop = (e) => e.stopPropagation();
            panel.addEventListener('mousedown', stop);
            panel.addEventListener('mousemove', stop);
            panel.addEventListener('mouseup', stop);
            panel.addEventListener('wheel', stop);
            panel.addEventListener('click', stop);
        });

        updateUI();
    }

    function bindInput(id, cb) {
        document.getElementById(id).addEventListener('change', (e) => {
            cb(parseFloat(e.target.value));
            draw();
        });
    }

    function switchMode(mode) {
        // VALIDATION: Check if current mode is "complete" compared to MasterQ
        const currentPts = pointsStore[currentMode];
        const masterCount = masterQ.length;

        // If we have started digitizing in this mode (count > 0)
        // AND we haven't matched the full set of Master points yet
        if (masterCount > 0 && currentPts.length > 0 && currentPts.length < masterCount) {
            const diff = masterCount - currentPts.length;
            alert(`Процесс не завершен! В текущем режиме снято ${currentPts.length} из ${masterCount} точек.\nПожалуйста, снимите еще ${diff} точек.`);
            // Restore radio button selection to current mode (UI fix)
            const radio = document.querySelector(`input[name="digMode"][value="${currentMode}"]`);
            if (radio) radio.checked = true;
            return;
        }

        currentMode = mode;
        const cy = getCurrentCalY();

        // Unlock inputs & buttons temporarily to allow value updates and state reset
        document.getElementById('valY0').disabled = false;
        document.getElementById('valY1').disabled = false;
        document.getElementById('valY0').removeAttribute('disabled');
        document.getElementById('valY1').removeAttribute('disabled');

        document.getElementById('btnFixY0').disabled = false;
        document.getElementById('btnFixY1').disabled = false;

        const map = { 'QH': 'H (m)', 'QP': 'P2 (kW)', 'QN': 'NPSH (m)', 'QE': 'Eff (%)' };
        document.getElementById('lblAxisY').innerText = map[mode];

        document.getElementById('valY0').value = cy.val0;
        document.getElementById('valY1').value = cy.val1;

        updateUI();
        renderPointsList();
        draw();
    }

    function getCurrentCalY() { return calY_Store[currentMode]; }
    function getCP() {
        const cy = getCurrentCalY();
        if (!calX.p0 || !cy.p0) {
            // Stage 1: Setting Origins (Bottom-Left bias)
            return { x: canvas.width * 0.35, y: canvas.height * 0.75 };
        } else if (!calX.p1 || !cy.p1) {
            // Stage 2: Setting Scales (Top-Right bias, balanced for A4)
            return { x: canvas.width * 0.65, y: canvas.height * 0.20 };
        } else {
            // Stage 3: Digitizing Points (Center)
            return { x: canvas.width * 0.50, y: canvas.height * 0.50 };
        }
    }

    // --- LOGIC: CALIBRATION ---
    function fixCoord(type) {
        if (!image) return alert("Загрузите изображение");
        const cp = getCP();
        const centerImg = screenToImage(cp.x, cp.y);
        const cy = getCurrentCalY();
        const offset = 100 / transform.scale;

        // Stage BEFORE change
        const wasOriginsDone = calX.p0 && cy.p0;
        const wasScalesDone = calX.p1 && cy.p1;

        if (type === 'X0') {
            if (calX.p1) return alert("Нельзя менять X0 после фиксации X1");
            calX.p0 = { x: centerImg.x, y: centerImg.y };
        } else if (type === 'Y0') {
            if (cy.p1) return alert("Нельзя менять Y0 после фиксации Y1");
            cy.p0 = { x: centerImg.x, y: centerImg.y };
        } else if (type === 'X1') {
            if (!calX.p0) return alert("Сначала задайте X0");
            calX.p1 = { x: centerImg.x, y: calX.p0.y };
        } else if (type === 'Y1') {
            if (!cy.p0) return alert("Сначала задайте Y0");
            cy.p1 = { x: cy.p0.x, y: centerImg.y };
        }

        // Stage AFTER change
        const isOriginsDone = calX.p0 && cy.p0;
        const isScalesDone = calX.p1 && cy.p1;

        // AUTO-ALIGN to NEXT stage only if current stage JUST finished
        const stageAdvanced = (!wasOriginsDone && isOriginsDone) || (!wasScalesDone && isScalesDone);
        if (stageAdvanced) {
            centerImage();
        }

        updateUI();
        draw();
    }

    function resetAll(skipConfirm = false) {
        if (!skipConfirm && !confirm("Полный сброс всей калибровки и всех точек?")) return;
        calX = { p0: null, p1: null, val0: 0, val1: 100 };
        Object.keys(calY_Store).forEach(k => {
            calY_Store[k] = { p0: null, p1: null, val0: 0, val1: 100 };
        });
        masterQ = [];
        Object.keys(pointsStore).forEach(k => pointsStore[k] = []);
        showCurves = false;

        // Return to Stage 1 alignment
        centerImage();
        updateUI();
        draw();
    }

    // --- CAPTURE LOGIC ---
    function capturePoint() {
        const cy = getCurrentCalY();
        if (!calX.p1 || !cy.p1) return alert("Зафиксируйте X1 и Y1!");

        const pts = pointsStore[currentMode];
        // Remove 4 point limit

        const cp = getCP();
        const ptImg = screenToImage(cp.x, cp.y);

        // X Logic
        const dxPx = calX.p1.x - calX.p0.x;
        const dxVal = calX.val1 - calX.val0;
        const qRaw = calX.val0 + (ptImg.x - calX.p0.x) * (dxVal / dxPx);

        // Y Logic (Fixed)
        const dyPx = cy.p1.y - cy.p0.y;
        const dyVal = cy.val1 - cy.val0;
        const yRaw = cy.val0 + (ptImg.y - cy.p0.y) * (dyVal / dyPx);

        let realQ = qRaw;

        // Use Locked Axis if available
        if (lockedQ !== null) {
            realQ = lockedQ;

            // Check if point for this Q already exists in CURRENT mode
            const alreadyHas = pts.some(p => Math.abs(p.x - realQ) < 0.001);
            if (alreadyHas) return alert("Точка для этого Q уже задана в текущем режиме!");

        } else {
            // Unlocked state (Free cursor)

            // 1. Initialize Master Mode if this is the very first point
            if (masterQ.length === 0) {
                masterMode = currentMode;
            }

            // 2. STRICT CHECK: If we are NOT in Master Mode, and Master Points exist, must lock.
            if (masterQ.length > 0 && currentMode !== masterMode) {
                return alert("Ошибка! В этом режиме нельзя создавать новые оси Q.\nКликните по существующей оси, чтобы снять точку.");
            }

            // 3. Allow adding new axis (Master Mode or First Point)
            masterQ.push(realQ);
            masterQ.sort((a, b) => a - b);
        }

        pointsStore[currentMode].push({ x: realQ, y: yRaw });
        pointsStore[currentMode].sort((a, b) => a.x - b.x);
        renderPointsList();
        updateUI();
        draw();
    }

    // --- DRAW ---
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Quality settings
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.save();
        ctx.translate(transform.x, transform.y);
        ctx.scale(transform.scale, transform.scale);
        if (image) ctx.drawImage(image, 0, 0);

        const cy = getCurrentCalY();

        // 1. ORIGIN X (Blue)
        if (calX.p0) drawInfLine(calX.p0.x, 'V', '#007bff', `X0`, true);

        // 2. ORIGIN Y (Green)
        if (cy.p0) drawInfLine(cy.p0.y, 'H', '#28a745', `Y0`, true);

        // 3. SCALE X
        if (calX.p1) drawInfLine(calX.p1.x, 'V', 'blue', `X1`, false);

        // 4. SCALE Y
        if (cy.p1) drawInfLine(cy.p1.y, 'H', '#28a745', `Y1`, false);

        // 5. POINTS RENDERING (Other modes)
        const drawPoint = (pt, mode, isActive) => {
            const imgX = valToImg(pt.x, true);
            const imgY = valToImg(pt.y, false, mode);
            const color = modeColors[mode] || 'red';
            const r = (isActive ? 10 : 7) / transform.scale;

            ctx.beginPath();
            ctx.arc(imgX, imgY, r, 0, Math.PI * 2);

            if (isActive) {
                ctx.save();
                ctx.shadowColor = 'rgba(0,0,0,0.4)';
                ctx.shadowBlur = 8 / transform.scale;
                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 3 / transform.scale;
                ctx.stroke();
                ctx.strokeStyle = color;
                ctx.lineWidth = 1 / transform.scale;
                ctx.stroke();
                ctx.restore();
            } else {
                ctx.globalAlpha = 0.7; // Brighter background points
                ctx.fillStyle = color;
                ctx.fill();
                ctx.globalAlpha = 1.0;
            }
        };

        Object.keys(pointsStore).forEach(mode => {
            if (mode === currentMode) return;
            pointsStore[mode].forEach(pt => drawPoint(pt, mode, false));
        });

        // 5. POLYNOMIAL CURVES
        if (showCurves) {
            Object.keys(pointsStore).forEach(mode => {
                const pts = pointsStore[mode];
                if (pts.length < 2) return;
                const coeffs = polyFit(pts, 3);
                if (!coeffs) return;

                const color = modeColors[mode] || 'red';
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = 4 / transform.scale;
                ctx.setLineDash([15, 10]);

                const xCoords = pts.map(p => p.x);
                const minXValue = Math.min(...xCoords);
                const maxXValue = Math.max(...xCoords);
                const stepCount = 100;
                for (let i = 0; i <= stepCount; i++) {
                    const xVal = minXValue + (maxXValue - minXValue) * (i / stepCount);
                    let yVal = 0;
                    for (let d = 0; d < coeffs.length; d++) {
                        yVal += coeffs[d] * Math.pow(xVal, d);
                    }
                    const px = valToImg(xVal, true);
                    const py = valToImg(yVal, false, mode);
                    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                }
                ctx.stroke();
                ctx.setLineDash([]);
            });
        }

        // 6. POINTS RENDERING (Current mode)
        pointsStore[currentMode].forEach(pt => drawPoint(pt, currentMode, true));

        // 7. MASTER Q GUIDES & SNAP HIGHLIGHT
        const cp = getCP();
        const ptImg = screenToImage(cp.x, cp.y);
        let closestQ = null;
        if (calX.p0 && calX.p1 && masterQ.length) {
            const dxPx = calX.p1.x - calX.p0.x;
            const dxVal = calX.val1 - calX.val0;
            const currentQ = calX.val0 + (ptImg.x - calX.p0.x) * (dxVal / dxPx);
            const qPerPx = Math.abs(dxVal / dxPx);
            const snapThresh = 20 * qPerPx;

            let minD = Infinity;
            masterQ.forEach(mq => {
                const d = Math.abs(currentQ - mq);
                if (d < minD) { minD = d; closestQ = mq; }
            });
            if (minD > snapThresh) closestQ = null;
        }

        if (calX.p0 && calX.p1) {
            masterQ.forEach((mq, idx) => {
                const px = valToImg(mq, true);
                const isSnap = (closestQ !== null && Math.abs(mq - closestQ) < 0.001);
                drawInfLine(px, 'V', isSnap ? 'rgba(255,0,0,0.8)' : 'rgba(255,0,0,0.2)', `Q${idx + 1}`, false);
            });
        }

        ctx.restore();

        // CROSSHAIR (Screen Space) - VISUALIZE LOCK
        let cpVisual = getCP();

        const isLocked = (lockedQ !== null);
        const mainColor = isLocked ? '#00ff00' : '#ff4500'; // Green if locked, Red/Orange if free
        const outlineColor = '#ffffff';

        // 1. Draw thicker white outline
        ctx.beginPath();
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = isLocked ? 6 : 4;
        ctx.moveTo(cpVisual.x, 0); ctx.lineTo(cpVisual.x, canvas.height);
        ctx.moveTo(0, cpVisual.y); ctx.lineTo(canvas.width, cpVisual.y);
        ctx.stroke();

        // 2. Draw inner bright line
        ctx.beginPath();
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = isLocked ? 3 : 2;
        ctx.moveTo(cpVisual.x, 0); ctx.lineTo(cpVisual.x, canvas.height);
        ctx.moveTo(0, cpVisual.y); ctx.lineTo(canvas.width, cpVisual.y);
        ctx.stroke();

        // Target Circle (Dual)
        ctx.beginPath();
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = 5;
        ctx.arc(cpVisual.x, cpVisual.y, 14, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 2;
        ctx.arc(cpVisual.x, cpVisual.y, 14, 0, Math.PI * 2);
        ctx.stroke();
    }

    // --- UTILS & INTERACTION ---
    let lockedQ = null;
    let isClickCandidate = false;

    function getMousePos(e) {
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function onMouseDown(e) {
        const { x, y } = getMousePos(e);
        lastMouse = { x, y };
        isClickCandidate = true; // Potential click

        dragTarget = 'IMAGE'; container.style.cursor = 'grabbing'; isDragging = true;
    }

    function onMouseMove(e) {
        const { x, y } = getMousePos(e);

        if (isDragging) {
            // If moved significantly, it's a drag, not a click
            if (Math.hypot(x - lastMouse.x, y - lastMouse.y) > 3) {
                isClickCandidate = false;
            }

            if (dragTarget === 'IMAGE') {
                // If locked, we restrict Pan to Y-axis only (Slide Rule effect)
                // And Force X alignment to center (optional, but restricting Pan X is enough if we auto-centered on lock)
                if (lockedQ !== null) {
                    transform.y += (y - lastMouse.y);
                    // transform.x remains locked
                } else {
                    transform.x += (x - lastMouse.x);
                    transform.y += (y - lastMouse.y);
                }
            }
            lastMouse = { x, y };
            draw();
            return;
        }

        // Hover State
        if (lockedQ === null && calX.p0 && calX.p1 && masterQ.length) {
            let near = false;
            masterQ.forEach(mq => {
                const screenX = valToImg(mq, true) * transform.scale + transform.x;
                if (Math.abs(x - screenX) < 15) near = true;
            });
            container.style.cursor = near ? 'pointer' : 'default';
        } else {
            container.style.cursor = lockedQ !== null ? 'ns-resize' : 'default';
        }

        lastMouse = { x, y };
        draw();
    }

    function onMouseUp(e) {
        isDragging = false;
        dragTarget = null;
        container.style.cursor = 'grab';

        if (isClickCandidate) {
            handleCanvasClick(e);
        }
        isClickCandidate = false;
    }

    function handleCanvasClick(e) {
        if (!calX.p1 || !masterQ.length) return;

        const { x, y } = getMousePos(e);

        // CLICK TO UNLOCK
        if (lockedQ !== null) {
            lockedQ = null;
            draw();
            return;
        }

        // CLICK TO LOCK
        let bestQ = null;
        let minDist = Infinity;

        masterQ.forEach(mq => {
            const screenX = valToImg(mq, true) * transform.scale + transform.x;
            const dist = Math.abs(x - screenX);
            if (dist < 15) {
                if (dist < minDist) { minDist = dist; bestQ = mq; }
            }
        });

        if (bestQ !== null) {
            lockedQ = bestQ;

            // AUTO-CENTER THE LOCKED LINE
            // We want screenX of bestQ to be canvas.width * 0.5
            // screenX = imgX * scale + transX
            // transX = screenX - imgX * scale
            const targetScreenX = canvas.width * 0.5;
            const imgX = valToImg(bestQ, true);
            transform.x = targetScreenX - imgX * transform.scale;

            draw();
        }
    }

    function drawInfLine(pos, type, color, label, isInteractive) {
        ctx.beginPath();
        ctx.lineWidth = 2.0 / transform.scale;
        if (isInteractive) ctx.setLineDash([5, 5]); else ctx.setLineDash([]);
        ctx.strokeStyle = color;
        if (type === 'V') { ctx.moveTo(pos, -10000); ctx.lineTo(pos, 10000); }
        else { ctx.moveTo(-10000, pos); ctx.lineTo(10000, pos); }
        ctx.stroke();
        ctx.setLineDash([]);

        if (label) {
            ctx.save();
            ctx.fillStyle = color;
            // Target ~24px screen font size
            const fs = 30 / transform.scale;
            ctx.font = `bold ${fs}px 'Segoe UI', Inter, sans-serif`;

            // Text shadow for readability
            ctx.shadowColor = "white";
            ctx.shadowBlur = 4 / transform.scale;
            ctx.lineWidth = 4 / transform.scale;
            ctx.lineJoin = "round";
            ctx.miterLimit = 2;
            ctx.strokeStyle = "white";

            if (type === 'V') {
                const textX = pos + 10 / transform.scale;
                // Sticky to top of screen with small offset
                const screenY = 120; // Lower to avoid UI panels
                const textY = screenToImage(0, screenY).y;
                ctx.strokeText(label, textX, textY);
                ctx.fillText(label, textX, textY);
            } else {
                // Sticky to left of screen, past the expanded 480px left panel
                const screenX = 560; // Increased from 480
                const textX = screenToImage(screenX, 0).x;
                const textY = pos - 10 / transform.scale;
                ctx.strokeText(label, textX, textY);
                ctx.fillText(label, textX, textY);
            }
            ctx.restore();
        }
    }

    function valToImg(val, isX, mode = null) {
        if (isX) {
            if (!calX.p1 || !calX.p0) return 0;
            return calX.p0.x + (val - calX.val0) * ((calX.p1.x - calX.p0.x) / (calX.val1 - calX.val0));
        } else {
            const targetMode = mode || currentMode;
            const cy = calY_Store[targetMode];
            if (!cy.p1 || !cy.p0) return 0;
            // Linear mapping: Y = Y0_px + (val - Y0_val) * (Y1_px - Y0_px) / (Y1_val - Y0_val)
            return cy.p0.y + (val - cy.val0) * ((cy.p1.y - cy.p0.y) / (cy.val1 - cy.val0));
        }
    }

    function screenToImage(sx, sy) { return { x: (sx - transform.x) / transform.scale, y: (sy - transform.y) / transform.scale }; }
    function imageToScreen(ix, iy) { return { x: ix * transform.scale + transform.x, y: iy * transform.scale + transform.y }; }

    async function handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        // Reset everything for the new file
        resetAll(true);

        if (file.type === 'application/pdf') {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                const page = await pdf.getPage(1);
                const viewport = page.getViewport({ scale: 4.0 }); // High resolution
                const tempCanvas = document.createElement('canvas');
                const tempCtx = tempCanvas.getContext('2d');
                tempCanvas.height = viewport.height;
                tempCanvas.width = viewport.width;
                await page.render({ canvasContext: tempCtx, viewport: viewport }).promise;
                const img = new Image();
                img.onload = () => { image = img; centerImage(); draw(); };
                img.src = tempCanvas.toDataURL();
            } catch (err) { alert("Ошибка PDF: " + err.message); }
        } else {
            const r = new FileReader();
            r.onload = (v) => {
                const i = new Image();
                i.onload = () => { image = i; centerImage(); draw(); };
                i.src = v.target.result;
            };
            r.readAsDataURL(file);
        }
    }

    function centerImage() {
        if (!image) return;
        const cy = getCurrentCalY();
        const cp = getCP();

        let s;
        if (!calX.p0 || !cy.p0) {
            // Stage 1: Bottom-Left corner to Crosshair
            s = Math.min((canvas.width - cp.x) / image.width, cp.y / image.height) * 0.9;
            transform = { x: cp.x, y: cp.y - (image.height * s), scale: s };
        } else if (!calX.p1 || !cy.p1) {
            // Stage 2: Top-Right corner to Crosshair
            s = Math.min(cp.x / image.width, (canvas.height - cp.y) / image.height) * 0.9;
            transform = { x: cp.x - (image.width * s), y: cp.y, scale: s };
        } else {
            // Stage 3: Center image to Crosshair
            s = Math.min(canvas.width / image.width, canvas.height / image.height) * 0.9;
            transform = { x: cp.x - (image.width * s) / 2, y: cp.y - (image.height * s) / 2, scale: s };
        }
    }

    function handleZoom(e) {
        e.preventDefault();
        const f = 1 + (e.deltaY < 0 ? 0.1 : -0.1);
        const cp = getCP();
        const ix = (cp.x - transform.x) / transform.scale;
        const iy = (cp.y - transform.y) / transform.scale;
        transform.scale *= f;
        transform.x = cp.x - ix * transform.scale;
        transform.y = cp.y - iy * transform.scale;
        draw();
    }

    function updateUI() {
        const btnX0 = document.getElementById('btnFixX0');
        const btnY0 = document.getElementById('btnFixY0');
        const btnX1 = document.getElementById('btnFixX1');
        const btnY1 = document.getElementById('btnFixY1');
        const btnAdd = document.getElementById('btnAddPoint');
        const btnBuild = document.getElementById('btnBuildCurve');


        const cy = getCurrentCalY();

        // SYNC INPUT VALUES
        document.getElementById('valX0').value = calX.val0;
        document.getElementById('valY0').value = cy.val0;
        document.getElementById('valX1').value = calX.val1;
        document.getElementById('valY1').value = cy.val1;

        // GLOBAL X LOCK (Persists across modes)
        const isXFixed = !!calX.p1;
        const isXOriginFixed = !!calX.p0;

        // X0 Button
        btnX0.innerText = isXOriginFixed ? "X0 OK" : "🎯 SET X0";
        btnX0.disabled = isXOriginFixed; // Locked if set

        // X1 Button
        btnX1.innerText = isXFixed ? "X1 OK" : "✅ FIX X1";
        btnX1.disabled = !isXOriginFixed || isXFixed; // Locked if X0 missing OR X1 already set

        // X Inputs
        document.getElementById('valX0').disabled = isXFixed;
        document.getElementById('valX1').disabled = isXFixed;


        // LOCAL Y LOCK (Per Mode)
        const isYFixed = !!cy.p1;
        const isYOriginFixed = !!cy.p0;

        // Y0 Button
        btnY0.innerText = isYOriginFixed ? "Y0 OK" : "🎯 SET Y0";
        btnY0.disabled = isYOriginFixed; // Locked if set for THIS mode

        // Y1 Button
        btnY1.innerText = isYFixed ? "Y1 OK" : "✅ FIX Y1";
        btnY1.disabled = !isYOriginFixed || isYFixed; // Locked if Y0 missing OR Y1 already set for THIS mode

        // Y Inputs - Force property update
        // If Y is fixed, disable inputs. If Y is NOT fixed (new mode), enable them.
        const yDisabled = isYFixed;
        document.getElementById('valY0').disabled = yDisabled;
        document.getElementById('valY1').disabled = yDisabled;

        // Also ensure we remove the attribute just in case it got stuck (belt and suspenders)
        if (!yDisabled) {
            document.getElementById('valY0').removeAttribute('disabled');
            document.getElementById('valY1').removeAttribute('disabled');
        }

        btnAdd.disabled = !(calX.p1 && cy.p1);

        const canBuild = Object.values(pointsStore).some(pts => pts.length >= 3);
        if (btnBuild) {
            btnBuild.disabled = !canBuild;
            btnBuild.style.opacity = canBuild ? "1" : "0.5";
            btnBuild.style.pointerEvents = canBuild ? "auto" : "none";
            btnBuild.classList.toggle('active', showCurves);
            btnBuild.innerText = showCurves ? "СКРЫТЬ ГРАФИК" : "ПОСТРОИТЬ ГРАФИК";
        }
    }

    function renderPointsList() {
        const list = document.getElementById('digiPointsList');
        list.innerHTML = '';

        let totalCount = 0;
        Object.keys(pointsStore).sort().forEach(mode => {
            const pts = pointsStore[mode];
            if (pts.length === 0) return;
            totalCount += pts.length;

            const group = document.createElement('div');
            group.style.marginBottom = '15px';

            // Calculate RMSE for the group
            let errorText = "";
            if (pts.length >= 3) {
                const coeffs = polyFit(pts, 3);
                const rmse = calculateRMSE(pts, coeffs);
                const r2 = calculateR2(pts, coeffs);
                if (rmse !== null && r2 !== null) {
                    const unitsMap = { 'QH': 'm', 'QP': 'kW', 'QN': 'm', 'QE': '%' };
                    errorText = ` <span style="opacity:0.8; font-weight:normal; font-size:0.95em; margin-left:10px;">(СКО: ${rmse.toFixed(2)} ${unitsMap[mode]}, R²: ${r2.toFixed(3)})</span>`;
                }
            }

            const header = document.createElement('div');
            header.className = 'points-group-header';
            header.style.backgroundColor = `${modeColors[mode]}15`; // Light alpha
            header.style.color = modeColors[mode];
            header.style.borderLeft = `4px solid ${modeColors[mode]}`;
            header.innerHTML = `ТОЧКИ ${modeDisplayNames[mode]}${errorText}`;
            group.appendChild(header);

            pts.forEach((pt, idx) => {
                const div = document.createElement('div');
                div.className = 'point-row';
                const axisLabel = mode.charAt(1);
                div.innerHTML = `<span>#${idx + 1}</span> <span>Q:${pt.x.toFixed(1)} / ${axisLabel}:${pt.y.toFixed(1)}</span> <span onclick="DigiCore.delPoint(${idx}, '${mode}')" style="cursor:pointer; color:red;">✖</span>`;
                group.appendChild(div);
            });
            list.appendChild(group);
        });

        document.getElementById('lblPointCount').innerText = totalCount;
    }

    function delPoint(idx, mode) {
        const targetMode = mode || currentMode;

        // Get the point to be deleted
        const ptToDelete = pointsStore[targetMode][idx];
        if (!ptToDelete) return;
        const qVal = ptToDelete.x;

        // If deleting from Master Mode, we must remove the Master Axis and sync all modes
        if (targetMode === masterMode) {
            // 1. Remove from MasterQ
            masterQ = masterQ.filter(mq => Math.abs(mq - qVal) > 0.001);

            // 2. Remove this Q from ALL modes (to keep indices synced)
            Object.keys(pointsStore).forEach(m => {
                pointsStore[m] = pointsStore[m].filter(p => Math.abs(p.x - qVal) > 0.001);
            });

            // If MasterQ becomes empty, reset masterMode?
            if (masterQ.length === 0) {
                masterMode = null; // Reset so next point can start fresh
            }

        } else {
            // Just delete the single point in this non-master mode
            pointsStore[targetMode].splice(idx, 1);
        }

        renderPointsList();
        updateUI();
        draw();
    }

    async function exportData() {
        if (masterQ.length === 0) return alert("Нет точек для экспорта");

        // VALIDATION: All active modes (with > 0 points) must have the same count as masterQ
        const targetCount = masterQ.length;
        let errors = [];
        Object.keys(pointsStore).forEach(mode => {
            const count = pointsStore[mode].length;
            if (count > 0 && count < targetCount) {
                const missing = targetCount - count;
                const modeName = modeDisplayNames[mode] || mode;
                errors.push(`В режиме ${modeName} снято ${count} точек, а всего в сетке — ${targetCount}. Необходимо доснят еще ${missing} для ${modeName}.`);
            }
        });

        if (errors.length > 0) {
            alert(errors.join('\n'));
            return;
        }

        // --- EXPORT DATA (POINTS TAB) ---
        const qExportStr = masterQ.map(q => q.toFixed(6)).join(' ');
        document.getElementById('qText').value = qExportStr;

        const getAlignedYs = (mode) => {
            if (pointsStore[mode].length === 0) return null;
            return masterQ.map(q => {
                const pt = pointsStore[mode].find(p => Math.abs(p.x - q) < 0.001);
                return pt ? pt.y.toFixed(6) : '0';
            }).join(' ');
        };

        const hVals = getAlignedYs('QH');
        const pVals = getAlignedYs('QP');
        const nVals = getAlignedYs('QN');
        const eVals = getAlignedYs('QE');

        if (hVals !== null) document.getElementById('hText').value = hVals;
        if (pVals !== null) document.getElementById('p2Text').value = pVals;
        if (nVals !== null) document.getElementById('npshText').value = nVals;
        if (eVals !== null) document.getElementById('effText').value = eVals;

        // --- CENTRALIZED COEFFICIENT CALCULATION (via Backend) ---
        const api = window.API_URL || "";
        const fd = new FormData();
        fd.append('q_text', qExportStr);
        if (hVals) fd.append('h_text', hVals);
        if (pVals) fd.append('p2_text', pVals);
        if (nVals) fd.append('npsh_text', nVals);
        if (eVals) fd.append('eff_text', eVals);
        fd.append('save', 'false'); // Only calculate, don't save to DB yet
        fd.append('save_source', 'points');

        try {
            const response = await fetch(`${api}/api/calculate`, { method: 'POST', body: fd });
            if (!response.ok) throw new Error("Backend calculation failed");
            const res = await response.json();

            if (res.error) throw new Error(res.error);

            const pMap = { 'h': 'h_coeffs', 'p2': 'p2_coeffs', 'npsh': 'npsh_coeffs', 'eff': 'eff_coeffs' };
            Object.keys(pMap).forEach(prefix => {
                const coeffs = res[pMap[prefix]];
                if (coeffs && coeffs.length === 4) {
                    for (let i = 0; i <= 3; i++) {
                        const el = document.getElementById(`modes-${prefix}-a${i}`);
                        if (el) {
                            // Backend returns [A3, A2, A1, A0]. Mapping: a3=c[0], a2=c[1], a1=c[2], a0=c[3]
                            el.value = coeffs[3 - i].toFixed(12);
                        }
                    }
                }
            });

            // Set Q min/max from backend response
            const qMinEl = document.getElementById('modes-qMin');
            const qMaxEl = document.getElementById('modes-qMax');
            if (qMinEl && res.q_min !== undefined) qMinEl.value = res.q_min.toFixed(6);
            if (qMaxEl && res.q_max !== undefined) qMaxEl.value = res.q_max.toFixed(6);

            // --- SYNC MODES TAB (Common Meta) ---
            // If the user already had common fields filled in 'calc', copy them to 'modes' now
            const syncFields = ['company', 'executor', 'pumpName', 'oemName', 'dn_suction', 'dn_discharge', 'rpm', 'impeller', 'p2_nom', 'price', 'currency', 'qReq', 'hReq', 'hSt'];
            syncFields.forEach(f => {
                const src = document.getElementById(f);
                const dst = document.getElementById('modes-' + f);
                if (src && dst) dst.value = src.value;
            });

            // Ensure charts are rendered on both tabs immediately
            if (window.calc) await window.calc(false);
            if (window.calcModes) await window.calcModes(false);

            showTab('calc');
            alert("Данные успешно экспортированы.");

        } catch (err) {
            console.error(err);
            alert("Ошибка при расчете коэффициентов на бэкенде: " + err.message);
        }
    }

    window.DigiCore = {
        init,
        delPoint,
        buildCurves,
        clearPoints: () => {
            if (confirm('Очистить ВСЕ точки во всех режимах (QH, QP и т.д.)? Калибровка осей сохранится.')) {
                masterQ = [];
                Object.keys(pointsStore).forEach(k => pointsStore[k] = []);
                renderPointsList();
                updateUI();
                draw();
            }
        },
        exportData,
        resetAll
    };
    return window.DigiCore;
})();

document.addEventListener('DOMContentLoaded', DigiCore.init);
