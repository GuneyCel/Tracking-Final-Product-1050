let allAssets = [];
let isEditing = false;

// =========================================
// ASSET DIRECTORY LOGIC
// =========================================

function loadDirectory() {
    fetch('/api/assets')
        .then(res => res.json())
        .then(data => {
            allAssets = data.assets;
            renderTable(allAssets);
        });
}

function renderTable(assetsToRender) {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    assetsToRender.forEach(asset => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-family: monospace;">${asset.tag_mac}</td>
            <td><strong>${asset.asset_name || 'Unnamed'}</strong></td>
            <td style="text-transform: capitalize;">${asset.asset_type || 'Unknown'}</td>
            <td><span class="badge ${asset.status}">${asset.status}</span></td>
            <td>F${asset.floor || 1}</td>
            <td>${asset.battery !== null ? asset.battery + '%' : 'N/A'}</td>
            <td>
                <button class="action-btn" onclick='editAsset(${JSON.stringify(asset)})'>Edit</button>
                <button class="action-btn delete" onclick="deleteAsset('${asset.tag_mac}')">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filterTable() {
    const term = document.getElementById('directory-search').value.toLowerCase();
    const filtered = allAssets.filter(a => 
        (a.asset_name && a.asset_name.toLowerCase().includes(term)) || 
        (a.tag_mac && a.tag_mac.toLowerCase().includes(term))
    );
    renderTable(filtered);
}

// =========================================
// FORM HANDLING (ADD / EDIT / DELETE)
// =========================================

// openModal and closeModal are handled by script.js

function openAddAssetModal() {
    isEditing = false;
    document.getElementById('modal-title').innerText = "Add New Asset";
    document.getElementById('asset-form').reset();
    document.getElementById('form-mac').disabled = false; 
    openModal('modal-asset-form');
}

function editAsset(asset) {
    isEditing = true;
    document.getElementById('modal-title').innerText = "Edit Asset";
    document.getElementById('form-mac').value = asset.tag_mac;
    document.getElementById('form-mac').disabled = true; // Protect primary key
    document.getElementById('form-name').value = asset.asset_name;
    document.getElementById('form-type').value = asset.asset_type || 'iv pump';
    document.getElementById('form-status').value = asset.status || 'active';
    openModal('modal-asset-form');
}

function saveAsset(e) {
    e.preventDefault();
    
    const payload = {
        tag_mac: document.getElementById('form-mac').value,
        asset_name: document.getElementById('form-name').value,
        asset_type: document.getElementById('form-type').value,
        status: document.getElementById('form-status').value,
        floor: 1, 
        battery: 100
    };

    const method = isEditing ? 'PUT' : 'POST';

    fetch('/api/manage-asset', {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(res => {
        if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
        return res.json();
    })
    .then(data => {
        if(data.status === 'success') {
            closeModal('modal-asset-form');
            loadDirectory(); 
        } else {
            alert("Error: " + data.message);
        }
    })
    .catch(err => {
        console.error("Save Asset Error:", err);
        alert("Failed to save! Check the terminal running Python for the exact error.");
    });
}

function deleteAsset(mac) {
    if(confirm(`Are you sure you want to delete asset ${mac}? This will remove it from the map.`)) {
        fetch('/api/manage-asset', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag_mac: mac })
        })
        .then(res => res.json())
        .then(data => {
            if(data.status === 'success') {
                loadDirectory();
            } else {
                alert("Error: " + data.message);
            }
        });
    }
}

// =========================================
// BATTERY LOG & SIDE PANELS
// =========================================

function openBatteryPanel() {
    renderBatteryLog();
    // Uses the global openSidePanel from script.js
    openSidePanel('panel-battery'); 
}

function renderBatteryLog() {
    const container = document.getElementById('battery-list');
    container.innerHTML = '';
    
    const sortedAssets = [...allAssets].sort((a, b) => {
        const batA = a.battery !== null ? a.battery : 100;
        const batB = b.battery !== null ? b.battery : 100;
        return batA - batB;
    });

    sortedAssets.forEach(asset => {
        const battery = asset.battery !== null ? asset.battery : 100;
        
        let color = '#10b981'; 
        if (battery <= 20) color = '#ef4444';
        else if (battery <= 50) color = '#f59e0b'; 

        const el = document.createElement('div');
        el.className = 'filter-row';
        el.style.alignItems = 'center';
        
        el.innerHTML = `
            <div style="line-height: 1.3;">
                <strong style="color: var(--text-primary); font-size: 0.95rem;">${asset.asset_name || 'Unnamed Asset'}</strong><br>
                <small style="color: var(--text-muted); font-size: 0.75rem; font-family: monospace;">${asset.tag_mac}</small>
            </div>
            <div style="color: ${color}; font-weight: 800; font-size: 1.15rem; background: ${color}15; padding: 4px 10px; border-radius: 6px;">
                ${battery}%
            </div>
        `;
        container.appendChild(el);
    });
}

// =========================================
// VIEW SWITCHER & TICKETS
// =========================================

function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
    
    if(viewId === 'view-tickets') {
        loadTickets();
    }
}

function loadTickets() {
    fetch('/api/tickets')
        .then(res => res.json())
        .then(data => renderTicketTable(data.tickets))
        .catch(err => console.error("Error fetching tickets:", err));
}

function renderTicketTable(tickets) {
    const tbody = document.getElementById('ticket-body');
    tbody.innerHTML = '';

    if(tickets.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--text-muted);">No active support tickets! 🎉</td></tr>`;
        return;
    }

    tickets.forEach(ticket => {
        const issuesHtml = ticket.issues.map(issue => `<span style="display:block; margin-bottom:4px;">• ${issue}</span>`).join('');
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-family: monospace; font-weight: bold;">#${ticket.ticket_id}</td>
            <td style="color: var(--text-muted); font-size: 0.85rem;">${ticket.timestamp}</td>
            <td style="font-family: monospace;">${ticket.mac}</td>
            <td style="font-size: 0.85rem; color: #b91c1c;">${issuesHtml}</td>
            <td style="font-size: 0.9rem; color: var(--text-muted); white-space: pre-wrap;">${ticket.description || '<i>No description provided.</i>'}</td>
            <td>
                <button class="action-btn" style="color: #10b981;" onclick="resolveTicket('${ticket.ticket_id}')">✔ Resolve</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function resolveTicket(ticketId) {
    if(confirm(`Mark ticket #${ticketId} as resolved and clear it from the queue?`)) {
        fetch('/api/resolve-ticket', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticket_id: ticketId })
        })
        .then(res => res.json())
        .then(data => {
            if(data.status === 'success') loadTickets();
        });
    }
}

// Initialize
loadDirectory();