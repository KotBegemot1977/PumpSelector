
const SelectionCore = (() => {
    let results = [];

    async function search() {
        const qReq = parseFloat(document.getElementById('sel-q').value);
        const hReq = parseFloat(document.getElementById('sel-h').value);
        const tol = parseFloat(document.getElementById('sel-tol').value);

        if (!qReq || !hReq) return alert("Введите Q и H");

        const btn = document.getElementById('btn-search');
        const spinner = document.getElementById('sel-spinner');

        btn.disabled = true;
        spinner.style.display = 'inline-block';

        try {
            const api = window.API_URL || "http://localhost:8000";
            const response = await fetch(`${api}/api/selection/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ q_req: qReq, h_req: hReq, tolerance_percent: tol || 10 })
            });

            if (!response.ok) throw new Error("Search failed");

            results = await response.json();
            renderTable();
        } catch (e) {
            alert("Ошибка поиска: " + e.message);
        } finally {
            btn.disabled = false;
            spinner.style.display = 'none';
        }
    }

    function renderTable() {
        const tbody = document.getElementById('sel-table-body');
        tbody.innerHTML = '';

        if (results.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8">Нет результатов</td></tr>';
            return;
        }

        results.forEach(item => {
            const p = item.pump;
            const diff = item.deviation_percent.toFixed(1);
            const h = item.h_at_point.toFixed(1);
            const pow = item.power_at_point ? item.power_at_point.toFixed(2) : '-';
            const eff = item.eff_at_point ? item.eff_at_point.toFixed(1) : '-';

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${p.id}</td>
                <td style="font-weight:bold; color:var(--brand-primary);">${p.name}</td>
                <td>${p.rpm || '-'}</td>
                <td>${h}</td>
                <td style="${diff > 0 ? '' : 'color:green'}">${diff}%</td>
                <td>${pow}</td>
                <td>${eff}</td>
                <td>
                    <button class="btn btn-outline" style="padding:2px 8px; font-size:12px;" onclick="SelectionCore.loadPump(${p.id})">
                        📈 ГРАФИК
                    </button>
                    ${p.drawing_filename ? '<span style="margin-left:5px">📐</span>' : ''}
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    async function loadPump(id) {
        // Logic to switch to CALC tab and load this pump
        // We can reuse loadArchive but we need to fetch full details first if not in results
        // Actually results has pump model dump.

        const item = results.find(r => r.pump.id === id);
        if (!item) return;

        // Populate Main Tab
        const p = item.pump;

        // Use existing legacy fill function or manual
        // We need to set everything: coeffs, limits, text fields

        // Quickest way: call API to get full pump detail to be safe, then populate
        // But we have data. Let's try to simulate what "archive row click" does.

        // Since 'loadArchive' logic is buried in index.html or main.js, let's look at main.js
        // Ideally we expose a 'loadInstance(pumpData)' function.
        // For now, let's piggyback on the API or global function if available. 
        // We exposed 'loadArchive' global. But that RELOADS the archive list.

        // We need 'loadRow(pumpId)' equivalent.
        // In main.js, there isn't a clean exposed 'loadPump' function yet, it's likely inside row click handler.

        // Let's implement a clean loader here calling the backend
        try {
            const api = window.API_URL || "http://localhost:8000";
            // We can just fetch it again to get fresh data or use item.pump
            // Let's use item.pump, assuming it has all fields (Model dump usually does)

            const data = p;

            // Set Inputs
            const setVal = (id, v) => { if (document.getElementById(id)) document.getElementById(id).value = v || ''; };

            setVal('oemName', data.oem_name);
            setVal('company', data.company);
            setVal('dispId', data.id);
            setVal('dnIn', data.dn_suction);
            setVal('dnOut', data.dn_discharge);

            // Text Areas
            setVal('qText', data.q_text);
            setVal('hText', data.h_text);
            setVal('p2Text', data.p2_text);
            setVal('effText', data.eff_text);
            setVal('npshText', data.npsh_text);

            // Trigger Calc to refresh chart
            // We need to switch tab first
            if (window.showTab) window.showTab('calc');

            // Delay slightly to let UI settle then click calc
            setTimeout(() => {
                if (window.calc) window.calc(false); // Calc without save
            }, 100);

        } catch (e) {
            console.error(e);
        }
    }

    return {
        search,
        loadPump
    };
})();

window.SelectionCore = SelectionCore;
