const surface = document.getElementById('map-surface');
const viewport = document.getElementById('viewport');
const socket = io();

let scale = 1.0, posX = 0, posY = 0;
const METERS_TO_PX = 60; 
let currentFloor = 1;

// --- Caches ---
const assetNamesCache = {}; 
const masterRegistry = {};  
const userRegistry = {}; 

// Failsafe in case HTML doesn't pass the MAC
const myMacAddress = typeof MY_MAC !== 'undefined' ? MY_MAC : null;

let smartZoomEnabled = true;
const ZOOM_LABEL_THRESHOLD = 0.75; 

// =========================================
// MULTI-TOUCH PAN & ZOOM ENGINE
// =========================================
function updateTransform() {
    surface.style.transform = `translate(${posX}px, ${posY}px) scale(${scale})`;
}

// Map Reset Function
function resetMapTransform() {
    surface.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
    scale = 1.0; 
    posX = 0; 
    posY = 0;
    updateTransform();
    checkSmartZoom();
    
    setTimeout(() => {
        surface.style.transition = 'none';
    }, 400);
}
// Check to see if smart zoom is enalged
function checkSmartZoom() {
    if (!smartZoomEnabled) {
        surface.classList.remove('zoom-hide-labels');
        return;
    }
    if (scale < ZOOM_LABEL_THRESHOLD) {
        surface.classList.add('zoom-hide-labels');
    } else {
        surface.classList.remove('zoom-hide-labels');
    }
}

function toggleSmartZoom(btn) {
    smartZoomEnabled = !smartZoomEnabled;
    if (smartZoomEnabled) {
        btn.className = 'filter-toggle included';
        btn.innerHTML = '✓';
    } else {
        btn.className = 'filter-toggle neutral';
        btn.innerHTML = '';
    }
    checkSmartZoom();
}

function changeZoom(delta, zoomCenterX, zoomCenterY) {
    const oldScale = scale;
    scale = Math.min(Math.max(0.2, scale + delta), 3);

    if (zoomCenterX === undefined || zoomCenterY === undefined) {
        zoomCenterX = viewport.clientWidth / 2;
        zoomCenterY = viewport.clientHeight / 2;
    }

    const surfaceX = (zoomCenterX - posX) / oldScale;
    const surfaceY = (zoomCenterY - posY) / oldScale;

    posX = zoomCenterX - (surfaceX * scale);
    posY = zoomCenterY - (surfaceY * scale);

    updateTransform();
    checkSmartZoom(); 
}

const evCache = [];
let prevDiff = -1;
let startX = 0, startY = 0;

viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    changeZoom(e.deltaY > 0 ? -0.1 : 0.1, mouseX, mouseY);
}, {passive: false});

viewport.addEventListener('pointerdown', pointerdownHandler);
viewport.addEventListener('pointermove', pointermoveHandler);
viewport.addEventListener('pointerup', pointerupHandler);
viewport.addEventListener('pointercancel', pointerupHandler);

function pointerdownHandler(ev) {
    evCache.push(ev);
    viewport.setPointerCapture(ev.pointerId); 
    if (evCache.length === 1) {
        startX = ev.clientX - posX;
        startY = ev.clientY - posY;
    }
}

function pointermoveHandler(ev) {
    const index = evCache.findIndex(cachedEv => cachedEv.pointerId === ev.pointerId);
    if (index === -1) return; 
    evCache[index] = ev;

    if (evCache.length === 1) {
        posX = evCache[0].clientX - startX;
        posY = evCache[0].clientY - startY;
        updateTransform();
    }
    else if (evCache.length === 2) {
        const curDiff = Math.hypot(evCache[0].clientX - evCache[1].clientX, evCache[0].clientY - evCache[1].clientY);
        if (prevDiff > 0) {
            const zoomDelta = (curDiff - prevDiff) * 0.005; 
            const rect = viewport.getBoundingClientRect();
            const centerX = ((evCache[0].clientX + evCache[1].clientX) / 2) - rect.left;
            const centerY = ((evCache[0].clientY + evCache[1].clientY) / 2) - rect.top;
            changeZoom(zoomDelta, centerX, centerY);
            startX = evCache[0].clientX - posX;
            startY = evCache[0].clientY - posY;
        }
        prevDiff = curDiff;
    }
}

function pointerupHandler(ev) {
    const index = evCache.findIndex(cachedEv => cachedEv.pointerId === ev.pointerId);
    if (index !== -1) {
        evCache.splice(index, 1);
        viewport.releasePointerCapture(ev.pointerId);
    }
    if (evCache.length === 1) {
        startX = evCache[0].clientX - posX;
        startY = evCache[0].clientY - posY;
    }
    if (evCache.length < 2) {
        prevDiff = -1;
    }
}

// Compare the last update value in the Database for an asset to the current time
function getTimeAgo(dbTimestamp) {
    if (!dbTimestamp) return "No data yet";
    const safeDateString = String(dbTimestamp).replace(' ', 'T');
    const pastDate = new Date(safeDateString);
    if (isNaN(pastDate.getTime())) return dbTimestamp;

    const now = new Date();
    const secondsPast = Math.floor((now.getTime() - pastDate.getTime()) / 1000);

    if (secondsPast < 10) return "Just now";
    if (secondsPast < 60) return `${secondsPast} seconds ago`;
    if (secondsPast < 3600) return `${Math.floor(secondsPast / 60)} minutes ago`;
    if (secondsPast < 86400) return `${Math.floor(secondsPast / 3600)} hours ago`;
    return `${Math.floor(secondsPast / 86400)} days ago`;
}

// A check to see if the asset passes the filter requirments or not
function doesAssetPassFilters(asset) {
    const floor = parseInt(asset.floor) || 1;
    const status = (asset.status || "unknown").toLowerCase();
    const type = (asset.asset_type || "unknown").toLowerCase();

    // Floor Check
    if (floor !== currentFloor || activeFilters.floor[floor] === -1) return false;

    // Type Check
    const hasTypeIncludes = Object.values(activeFilters.type).includes(1);
    if (activeFilters.type[type] === -1) return false;
    if (hasTypeIncludes && activeFilters.type[type] !== 1) return false;

    // Status Check
    const hasStatusIncludes = Object.values(activeFilters.status).includes(1);
    if (activeFilters.status[status] === -1) return false;
    if (activeFilters.status.active === -1 && (status === 'used' || status === 'free')) return false;
    
    if (hasStatusIncludes) {
        let passesStatus = false;
        if (activeFilters.status[status] === 1) passesStatus = true;
        if (activeFilters.status.active === 1 && (status === 'used' || status === 'free')) passesStatus = true;
        if (!passesStatus) return false;
    }

    return true;
}

function changeFloor(floorNum) {
    currentFloor = floorNum;
    surface.style.backgroundImage = `url('/static/ACEB_F${floorNum}.svg')`;
    
    const buttons = document.querySelectorAll('.floor-picker button');
    buttons.forEach((btn, index) => {
        if (index + 1 === floorNum) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
       
    filterMapDots();

    document.querySelectorAll('.hub-marker').forEach(marker => {
        if (parseInt(marker.dataset.floor) === currentFloor) {
            marker.style.display = 'block';
        } else {
            marker.style.display = 'none';
        }
    });

    document.querySelectorAll('.user-dot').forEach(dot => {
        if (parseInt(dot.dataset.floor) === currentFloor) {
            dot.style.display = 'block';
        } else {
            dot.style.display = 'none';
        }
    });
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('btn-sidebar-toggle');
    sidebar.classList.toggle('collapsed');
}

function renderHubs(hubs) {
    hubs.forEach(hub => {
        const id = 'hub-' + hub.room_name;
        let marker = document.getElementById(id);
        if (!marker) {
            marker = document.createElement('div');
            marker.id = id;
            marker.className = 'hub-marker';
            surface.appendChild(marker);
        }
        const x = hub.x_coord * METERS_TO_PX;
        const y = hub.y_coord * METERS_TO_PX;
        marker.style.left = `${x}px`;
        marker.style.top = `${y}px`;
        marker.innerText = hub.room_name;
        marker.dataset.floor = hub.floor || 1; 
    });
    changeFloor(currentFloor);
}

function updateUser(data) {
    const id = data.mac_address || data.tag_id;
    userRegistry[id] = { ...userRegistry[id], ...data }; 


    let dot = document.getElementById(id);
    if (!dot) {
        dot = document.createElement('div');
        dot.id = id; 
        dot.className = 'user-dot';
        surface.appendChild(dot);
    }

    const baseX = (data.x_coord || data.x) * METERS_TO_PX;
    const baseY = (data.y_coord || data.y) * METERS_TO_PX;
    
    dot.style.left = `${baseX}px`;
    dot.style.top = `${baseY}px`;
    dot.style.zIndex = 150; 
    
    const room = data.current_room || data.room || "Unknown";
    const name = data.name || "Staff";
    
    if (myMacAddress && id === myMacAddress) {
        dot.innerHTML = `<div class="label"><b>You Are Here</b><br>${room}</div>`;
    } else {
        dot.innerHTML = `<div class="label"><b>${name}</b><br>${room}</div>`;
    }
    
    const userFloor = data.floor || 1; 
    dot.dataset.floor = userFloor; 
    
    if (parseInt(userFloor) !== currentFloor) {
        dot.style.display = 'none';
    } else {
        dot.style.display = 'block';
    }
}

function updateAsset(data) {
    const id = data.tag_mac || data.tag_id;
    masterRegistry[id] = { ...masterRegistry[id], ...data }; 
    if (data.asset_name) {
        assetNamesCache[id] = data.asset_name;
    }

    let dot = document.getElementById(id);
    if (!dot) {
        dot = document.createElement('div');
        dot.id = id; 
        dot.className = 'asset';
        surface.appendChild(dot);
    }

    const baseX = (data.x_coord || data.x) * METERS_TO_PX;
    const baseY = (data.y_coord || data.y) * METERS_TO_PX;
    
    dot.style.left = `${baseX}px`;
    dot.style.top = `${baseY}px`;
    
    const room = data.current_room || data.room;
    const displayName = assetNamesCache[id] || id.split(':').pop();
    dot.innerHTML = `<div class="label"><b>${displayName}</b><br>${room}</div>`;
    
    const assetFloor = data.floor || 1; 
    dot.dataset.floor = assetFloor; 
    
    dot.onpointerdown = (e) => {
        e.stopPropagation(); 
        showAssetInfo(id);
    };

    filterMapDots();
    
    const searchModal = document.getElementById('modal-search');
    if (searchModal && !searchModal.classList.contains('hidden')) {
        renderSearchList(); 
    }
}

function openModal(modalId) { 
    document.getElementById(modalId).classList.remove('hidden'); 
    autoCloseSidebar();
}

function closeModal(modalId) { 
    document.getElementById(modalId).classList.add('hidden'); 
}

function openSidePanel(panelId) {
    const targetPanel = document.getElementById(panelId);
    const isAlreadyOpen = !targetPanel.classList.contains('hidden');

    document.querySelectorAll('.side-panel').forEach(panel => {
        panel.classList.add('hidden');
        panel.classList.remove('closing'); 
    });

    if (!isAlreadyOpen) {
        targetPanel.classList.remove('hidden');
        autoCloseSidebar();
    }
}

function closeSidePanel(panelId) { 
    const panel = document.getElementById(panelId);
    panel.classList.add('closing');
    
    setTimeout(() => {
        if (panel.classList.contains('closing')) {
            panel.classList.add('hidden');
            panel.classList.remove('closing'); 
        }
    }, 400); 
}

function autoCloseSidebar() {
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar && !sidebar.classList.contains('collapsed')) {
            toggleSidebar();
        }
    }
}

let activeFilters = {
    status: { active: 0, used: 0, free: 0 },
    floor: { 1: 0, 2: 0 },
    type: { "iv pump": 0, "wheelchair": 0, "bed": 0, "monitor": 0 }
};

function filterMapDots() {
    document.querySelectorAll('.asset').forEach(dot => {
        const asset = masterRegistry[dot.id];
        if (!asset || !doesAssetPassFilters(asset)) {
            dot.style.display = 'none';
        } else {
            dot.style.display = 'block';
        }
    });
}

function handleSearchInput(input) {
    const icon = document.getElementById('search-icon');
    
    if (input.value.length > 0) {
        icon.innerText = '✕'; 
        icon.classList.add('can-clear');
        icon.onclick = () => {
            input.value = '';
            handleSearchInput(input);
            renderSearchList();
            input.focus();
        };
    } else {
        icon.innerText = '🔍';
        icon.classList.remove('can-clear');
        icon.onclick = null;
    }
    
    renderSearchList();
}

// Renders the list for the search menu
function renderSearchList() {
    const container = document.getElementById('search-results');
    const searchInput = document.getElementById('search-input');
    if (!container || !searchInput) return;

    const rawSearchTerm = searchInput.value;
    const searchTerm = rawSearchTerm.toLowerCase();
    container.innerHTML = ''; 

    // Filter the items first
    const filteredAssets = Object.values(masterRegistry).filter(asset => {
        const id = asset.tag_mac || asset.tag_id;
        const name = (asset.asset_name || assetNamesCache[id] || id.split(':').pop()).toLowerCase();
        
        // Basic Search Filter
        if (searchTerm && !name.includes(searchTerm)) return false;
        
        // Existing Map/Floor Filters
        const floor = parseInt(asset.floor) || 1;
        const status = (asset.status || "unknown").toLowerCase();
        const type = (asset.asset_type || "unknown").toLowerCase();
        
        if (activeFilters.floor[floor] === -1) return false;
        if (activeFilters.status[status] === -1) return false;
        if (activeFilters.status.active === -1 && (status === 'used' || status === 'free')) return false;
        if (activeFilters.type[type] === -1) return false;

        return true;
    });

    // Render with Staggered Animation
    filteredAssets.forEach((asset, index) => {
        const id = asset.tag_mac || asset.tag_id;
        const name = asset.asset_name || assetNamesCache[id] || id.split(':').pop();
        const room = asset.current_room || asset.room || "Unknown";
        const status = (asset.status || "unknown").toLowerCase();

        const el = document.createElement('div');
        el.className = 'result-item animate-item'; // Added animation class
        
        // The Stagger logic so each item waits slightly longer than the last
        el.style.animationDelay = `${index * 0.05}s`; 

        el.onclick = () => showAssetInfo(id);

        // Search term highlighting logic
        let displayHTML = name;
        if (searchTerm) {
            const safeTerm = rawSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
            const regex = new RegExp(`(${safeTerm})`, "gi");
            displayHTML = name.replace(regex, "<span class='highlight'>$1</span>");
        }

        el.innerHTML = `
            <div class="result-info">
                <strong>${displayHTML}</strong>
                <span>Status: ${status} | Room: ${room}</span>
            </div>
            <div class="result-floor">F${asset.floor || 1}</div>
        `;
        container.appendChild(el);
    });

    if (filteredAssets.length === 0) {
        container.innerHTML = `<div class="animate-item" style="text-align:center; padding:2rem; color:#9ca3af;">No assets found</div>`;
    }
}

function openSearchPanel() {
    const container = document.getElementById('search-container');
    container.classList.add('is-open');
}

document.addEventListener('click', function(event) {
    const searchContainer = document.getElementById('search-container');
    const filtersModal = document.getElementById('modal-search-filters'); 

    if(!searchContainer) return;

    const clickedInsideSearch = searchContainer.contains(event.target);
    const clickedInsideFilters = filtersModal ? filtersModal.contains(event.target) : false;

    if (!clickedInsideSearch && !clickedInsideFilters) {
        searchContainer.classList.remove('is-open');
    }
});

function openFiltersModal(event) {
    if (event) event.stopPropagation(); 
    document.getElementById('modal-search-filters').classList.remove('hidden');
}

// Toggles the filter logic
function toggleFilter(btn) {
    const category = btn.dataset.category;
    const val = btn.dataset.val;
    let currentState = activeFilters[category][val];
    let nextState = currentState === 0 ? 1 : (currentState === 1 ? -1 : 0);
    activeFilters[category][val] = nextState;
    
    document.querySelectorAll(`.filter-toggle[data-category="${category}"][data-val="${val}"]`).forEach(el => {
        el.className = 'filter-toggle ' + (nextState === 1 ? 'included' : (nextState === -1 ? 'excluded' : 'neutral'));
        el.innerHTML = nextState === 1 ? '✓' : (nextState === -1 ? '✗' : '');
    });
    renderSearchList(); filterMapDots(); 
}

let displayStates = { rooms: true, assets: true };
function toggleDisplay(btn) {
    const target = btn.dataset.displayTarget;
    displayStates[target] = !displayStates[target];

    if (displayStates[target]) {
        btn.className = 'filter-toggle included'; btn.innerHTML = '✓';
    } else {
        btn.className = 'filter-toggle neutral'; btn.innerHTML = '';
    }

    if (!displayStates.rooms) surface.classList.add('hide-rooms');
    else surface.classList.remove('hide-rooms');

    if (!displayStates.assets) surface.classList.add('hide-assets');
    else surface.classList.remove('hide-assets');
}

function resetFilters() {
    activeFilters = { status: { active: 0, used: 0, free: 0 }, floor: { 1: 0, 2: 0 }, type: { "iv pump": 0, "wheelchair": 0, "bed": 0, "monitor": 0 } };
    document.querySelectorAll('.filter-toggle').forEach(btn => {
        btn.className = 'filter-toggle neutral'; btn.innerHTML = '';
    });
    renderSearchList(); filterMapDots(); 
}

function closeFiltersModal() {
    document.getElementById('modal-search-filters').classList.add('hidden');
    document.getElementById('modal-search').classList.remove('hidden');
}

let currentlySelectedAssetId = null;

function showAssetInfo(id) {
    const asset = masterRegistry[id];
    if (!asset) return;
    currentlySelectedAssetId = id;
    
    const name = asset.asset_name || assetNamesCache[id] || id.split(':').pop();
    const status = asset.status || "Unknown";
    const room = asset.current_room || asset.room || "Unknown";
    const floor = asset.floor || 1;
    const battery = (asset.battery !== null && asset.battery !== undefined) ? asset.battery + '%' : "Unknown";

    document.getElementById('info-name').innerText = name;
    document.getElementById('info-status').innerText = status.charAt(0).toUpperCase() + status.slice(1);
    document.getElementById('info-location').innerText = room;
    document.getElementById('info-floor').innerText = floor;
    document.getElementById('info-time').innerText = getTimeAgo(asset.timestamp);
    document.getElementById('info-battery').innerText = battery;

    closeModal('modal-search');
    openModal('modal-asset-info');
}

function locateAssetOnMap() {
    const asset = masterRegistry[currentlySelectedAssetId];
    if (!asset) return;

    if (parseInt(asset.floor) !== currentFloor) changeFloor(parseInt(asset.floor));

    const xPx = (asset.x_coord || asset.x) * METERS_TO_PX;
    const yPx = (asset.y_coord || asset.y) * METERS_TO_PX;
    
    scale = 1.5;
    posX = (viewport.clientWidth / 2) - (xPx * scale);
    posY = (viewport.clientHeight / 2) - (yPx * scale);
    updateTransform();
    checkSmartZoom(); 

    document.querySelectorAll('.asset').forEach(d => d.classList.remove('located'));
    const dot = document.getElementById(currentlySelectedAssetId);
    if (dot) dot.classList.add('located');

    closeModal('modal-asset-info');
}

function openBlankSupport() {
    document.getElementById('support-asset-name').innerText = 'None';
    document.getElementById('support-asset-mac').value = '';
    
    document.querySelectorAll('input[name="ticket-issue"]').forEach(cb => cb.checked = false);
    document.getElementById('support-other-text').value = '';
    document.getElementById('support-other-text').disabled = true;
    document.getElementById('support-description').value = '';

    openModal('modal-support');
}

function openAssetSupport() {
    const asset = masterRegistry[currentlySelectedAssetId];
    if (!asset) return;

    const name = asset.asset_name || assetNamesCache[currentlySelectedAssetId] || currentlySelectedAssetId.split(':').pop();

    document.getElementById('support-asset-name').innerText = name;
    document.getElementById('support-asset-mac').value = currentlySelectedAssetId;

    document.querySelectorAll('input[name="ticket-issue"]').forEach(cb => cb.checked = false);
    document.getElementById('support-description').value = '';
    document.getElementById('support-other-text').value = '';
    document.getElementById('support-other-text').disabled = true;

    closeModal('modal-asset-info');
    openModal('modal-support');
}

function openSearchForSupport() {
    closeModal('modal-support');
    const searchContainer = document.getElementById('search-container');
    if (searchContainer) {
        searchContainer.classList.add('is-open');
        document.getElementById('search-input').focus(); 
    }
}

function submitSupportTicket() {
    const macId = document.getElementById('support-asset-mac').value;
    if (!macId) {
        alert("General Support Ticket ready to send (No asset selected).");
    } else {
        alert(`Ticket ready to send for Asset: ${macId}.`);
    }
    closeModal('modal-support');
}

// The Other Box in Support Ticket to enter Other issues
function toggleOtherInput() {
    const cb = document.getElementById('cb-other');
    const textInput = document.getElementById('support-other-text');
    textInput.disabled = !cb.checked;
    if (!cb.checked) {
        textInput.value = ''; 
    } else {
        textInput.focus(); 
    }
}

// Data Fetching & Setup
fetch('/api/hubs')
    .then(res => res.json())
    .then(data => renderHubs(data.hubs));

fetch('/api/assets')
    .then(res => res.json())
    .then(data => data.assets.forEach(updateAsset));

fetch('/api/users')
    .then(res => res.json())
    .then(data => data.users.forEach(updateUser));

socket.on('location_update', data => {
    if (data.type === 'user') {
        updateUser(data);
    } else {
        updateAsset(data);
    }
});

checkSmartZoom();
if (window.innerWidth <= 768) toggleSidebar();