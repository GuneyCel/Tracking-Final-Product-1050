let statusChartInstance = null;
let typeChartInstance = null;
let floorChartInstance = null;
let batteryChartInstance = null;

// View Switching 
function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
    
    if(viewId === 'view-analytics') loadAnalytics();
    if(viewId === 'view-users') loadUsers();
}

// Analytics Engine (Chart.js) 
function loadAnalytics() {
    fetch('/api/admin/stats')
        .then(res => {
            if (!res.ok) throw new Error(`Server crashed with HTTP ${res.status}.`);
            return res.json();
        })
        .then(data => {
            // If Python sends back  JSON error message catch it here
            if (data.status === "error") {
                throw new Error(data.message || "Unknown database error");
            }

            // Update Top KPI Cards
            document.getElementById('stat-users').innerText = data.total_users;
            document.getElementById('stat-tickets').innerText = data.open_tickets;
            document.getElementById('stat-critical-bat').innerText = data.critical_batteries;
            
            const active = data.status_counts['active'] || 0;
            const used = data.status_counts['used'] || 0;
            const free = data.status_counts['free'] || 0;
            const total = active + used + free;
            
            // Idle rate = Free / Total
            const idleRate = total === 0 ? 0 : Math.round((free / total) * 100);
            document.getElementById('stat-idle').innerText = idleRate + '%';

            // Pass all data to the chart renderer
            renderCharts(data.status_counts, data.type_counts, data.floor_counts, data.battery_counts);
        })
        .catch(err => {
            console.error("Analytics Load Error:", err);
            alert("Failed to load Analytics data, Check server logs.");        
        });
}

function renderCharts(statusData, typeData, floorData, batteryData) {
    // Status Chart (Doughnut)
    if(statusChartInstance) statusChartInstance.destroy();
    statusChartInstance = new Chart(document.getElementById('statusChart'), {
        type: 'doughnut',
        data: {
            labels: ['Active (In Motion)', 'Used (Stationary)', 'Free (Available)'],
            datasets: [{
                data: [statusData['active']||0, statusData['used']||0, statusData['free']||0],
                backgroundColor: ['#4F46E5', '#F59E0B', '#10B981']
            }]
        },
        options: { responsive: true, cutout: '70%', maintainAspectRatio: false }
    });

    // Type Chart (Pie)
    if(typeChartInstance) typeChartInstance.destroy();
    typeChartInstance = new Chart(document.getElementById('typeChart'), {
        type: 'pie',
        data: {
            labels: Object.keys(typeData).map(k => k.charAt(0).toUpperCase() + k.slice(1)),
            datasets: [{
                data: Object.values(typeData),
                backgroundColor: ['#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6']
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });

    // Floor Distribution (Bar)
    if(floorChartInstance) floorChartInstance.destroy();
    floorChartInstance = new Chart(document.getElementById('floorChart'), {
        type: 'bar',
        data: {
            labels: Object.keys(floorData),
            datasets: [{
                label: 'Total Assets',
                data: Object.values(floorData),
                backgroundColor: '#6366F1',
                borderRadius: 6
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });

    // Battery Health (Doughnut)
    if(batteryChartInstance) batteryChartInstance.destroy();
    batteryChartInstance = new Chart(document.getElementById('batteryChart'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(batteryData),
            datasets: [{
                data: Object.values(batteryData),
                backgroundColor: ['#10B981', '#F59E0B', '#EF4444']
            }]
        },
        options: { responsive: true, cutout: '60%', maintainAspectRatio: false }
    });
}

// User Management
function loadUsers() {
    fetch('/api/users')
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('user-table-body');
            tbody.innerHTML = '';
            data.users.forEach(u => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-family: monospace;">${u.mac_address}</td>
                    <td><strong>${u.name}</strong></td>
                    <td><span class="badge ${u.role}">${u.role}</span></td>
                    <td>${u.current_room || 'Unknown'}</td>
                    <td>
                        <button class="secondary-btn small-btn" style="color:#ef4444;" onclick="deleteUser('${u.mac_address}')">Revoke Access</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        });
}

// To Save New Users
function saveUser(e) {
    e.preventDefault();
    fetch('/api/manage-user', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            mac: document.getElementById('user-mac').value,
            name: document.getElementById('user-name').value,
            role: document.getElementById('user-role').value
        })
    }).then(() => {
        closeModal('modal-add-user');
        loadUsers();
    });
}

// To Delete New Users
function deleteUser(mac) {
    if(confirm('Revoke access for this badge?')) {
        fetch('/api/manage-user', {
            method: 'DELETE',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({mac: mac})
        }).then(() => loadUsers());
    }
}

// Init
loadAnalytics();
