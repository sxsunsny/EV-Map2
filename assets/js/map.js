document.addEventListener('DOMContentLoaded', async () => {
  const spots = await loadTouristSpots();
  initMap(spots);
});

let map;
let markers = [];
let userLocationMarker = null;
let userLatLng = null;
let routingControl = null;
let currentNavTarget = null;
let allSpots = [];
let tourRouteLayer = null;
let currentDetailSpot = null;

/** ลำดับเส้นทางรถ EV ตามแผนที่ (1→2→3→…→16→4→5→1) */
const EV_ROUTE_ORDER = [1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 4, 5, 1];
const EV_ROUTE_STOPS = EV_ROUTE_ORDER.slice(0, -1);

// ──────────────────────────────────────────────────────────────────────────────
// Map Init
// ──────────────────────────────────────────────────────────────────────────────
function initMap(spots) {
  allSpots = spots;

  map = L.map('map', {
    zoomControl: false,
    dragging: false,
    touchZoom: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    tap: false
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  tourRouteLayer = L.layerGroup().addTo(map);
  addMarkers(spots);
  drawEvTourRoute(spots);
  fitMapToAllSpots(false);

  map.on('popupclose', () => fitMapToAllSpots(true));

  setupSpotDetailOverlay();

  window.addEventListener('resize', () => {
    map.invalidateSize();
    fitMapToAllSpots(false);
  });

  // Start watching GPS continuously
  startGPSTracking();

  // Language change
  window.addEventListener('languageChanged', () => {
    map.closePopup();
    if (currentDetailSpot) openSpotDetail(currentDetailSpot);
  });

  // URL param: ?spot=3
  const urlParams = new URLSearchParams(window.location.search);
  const spotParam = urlParams.get('spot');
  if (spotParam) {
    const spotId = parseInt(spotParam);
    const spot = spots.find(s => s.id === spotId);
    if (spot) {
      const idx = spots.findIndex(s => s.id === spotId);
      if (idx !== -1 && markers[idx]) {
        setTimeout(() => openSpotDetail(spot), 400);
      }
    }
  }

  setupPanelControls();

  requestAnimationFrame(() => {
    map.invalidateSize();
    fitMapToAllSpots(false);
  });
}

function fitMapToAllSpots(animated = true) {
  if (!map || !allSpots.length) return;

  const points = allSpots
    .filter(s => s.latitude != null && s.longitude != null)
    .map(s => [s.latitude, s.longitude]);

  if (points.length === 0) return;

  const bounds = L.latLngBounds(points);
  map.fitBounds(bounds, {
    padding: [48, 48],
    maxZoom: 15,
    animate: animated
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// GPS Live Tracking
// ──────────────────────────────────────────────────────────────────────────────
function startGPSTracking() {
  if (!("geolocation" in navigator)) return;

  navigator.geolocation.watchPosition(
    (pos) => {
      userLatLng = [pos.coords.latitude, pos.coords.longitude];
      updateUserDot(userLatLng);
    },
    () => { /* silent fail – user denied or unavailable */ },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
}

function updateUserDot(latlng) {
  const dotHtml = `
    <div style="
      width:18px; height:18px; border-radius:50%;
      background:#1d6edb; border:3px solid white;
      box-shadow:0 0 0 0 rgba(29,110,219,0.5);
      animation: pulse-ring 1.8s infinite ease-out;
    "></div>`;

  if (!userLocationMarker) {
    const icon = L.divIcon({ html: dotHtml, iconSize:[18,18], iconAnchor:[9,9], className:'' });
    userLocationMarker = L.marker(latlng, { icon, zIndexOffset: 999 }).addTo(map);
  } else {
    userLocationMarker.setLatLng(latlng);
  }

  // Update distance in panel if navigating
  if (currentNavTarget) updateDistanceInfo();
}

// ──────────────────────────────────────────────────────────────────────────────
// Markers
// ──────────────────────────────────────────────────────────────────────────────
function createNumberedIcon(number, isFirst) {
  const bg     = isFirst ? '#e74c3c' : '#2ecc71';
  const border = isFirst ? '#c0392b' : '#27ae60';
  const size   = number >= 10 ? '10' : '12';

  return L.divIcon({
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
        <path d="M18 0 C8 0 0 8 0 18 C0 30 18 44 18 44 C18 44 36 30 36 18 C36 8 28 0 18 0 Z"
              fill="${bg}" stroke="${border}" stroke-width="2"/>
        <circle cx="18" cy="17" r="12" fill="white" fill-opacity="0.95"/>
        <text x="18" y="22" text-anchor="middle"
              font-family="Arial,sans-serif" font-size="${size}"
              font-weight="bold" fill="${bg}">${number}</text>
      </svg>`,
    iconSize: [36, 44],
    iconAnchor: [18, 44],
    popupAnchor: [0, -46],
    className: ''
  });
}

function addMarkers(spots) {
  spots.forEach(spot => {
    const icon   = createNumberedIcon(spot.id, spot.id === 1);
    const marker = L.marker([spot.latitude, spot.longitude], { icon }).addTo(map);
    marker.on('click', () => openSpotDetail(spot));
    markers.push(marker);
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Spot Detail Overlay (glassmorphism popup)
// ──────────────────────────────────────────────────────────────────────────────
function setupSpotDetailOverlay() {
  const overlay = document.getElementById('spotDetailOverlay');
  const closeBtn = document.getElementById('spotDetailClose');
  const navBtn = document.getElementById('spotDetailNavBtn');

  closeBtn?.addEventListener('click', closeSpotDetail);
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) closeSpotDetail();
  });

  navBtn?.addEventListener('click', () => {
    if (currentDetailSpot) {
      closeSpotDetail();
      startNavigation(currentDetailSpot.id);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentDetailSpot) closeSpotDetail();
  });
}

function matchLandmarkToSpot(landmarkName) {
  if (!landmarkName) return null;
  const key = landmarkName.replace(/\s/g, '').toLowerCase();

  return allSpots.find(spot => {
    const names = [spot.name_th, spot.name_en, spot.name_cn].filter(Boolean);
    return names.some(name => {
      const n = name.replace(/\s/g, '').toLowerCase();
      return n.includes(key) || key.includes(n) ||
        landmarkName.includes(name) || name.includes(landmarkName);
    });
  }) || null;
}

function pickLandmarkForSection(spot, section) {
  const landmarks = spot.nearby_landmarks || [];
  const distinct = landmarks.filter(lm => {
    const matched = matchLandmarkToSpot(lm);
    return !matched || matched.id !== spot.id;
  });

  if (section === 'nearby') {
    return distinct[0] || landmarks[0];
  }

  const pastPick = distinct.find(lm =>
    /เก่า|โรงภาพยนต์|อดีต|ประวัติ|rama|cinema|old/i.test(lm)
  );
  return pastPick || distinct[1] || distinct[distinct.length - 1] || landmarks[1] || landmarks[0];
}

function buildLocationCard(landmarkName, onClickSpotId) {
  if (!landmarkName) {
    return `<p class="spot-location-card-empty">—</p>`;
  }

  const matched = matchLandmarkToSpot(landmarkName);
  const label = matched
    ? (matched[`name_${currentLang}`] || matched.name_th)
    : landmarkName;
  const img = matched?.image || 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&q=80&w=400';
  const clickAttr = onClickSpotId != null
    ? `onclick="openSpotDetailById(${onClickSpotId})"`
    : (matched ? `onclick="openSpotDetailById(${matched.id})"` : '');

  return `
    <div class="spot-location-card" ${clickAttr}>
      <div class="spot-location-card-inner">
        <img src="${img}" alt="${label}" class="spot-location-card-img" loading="lazy">
        <span class="spot-location-card-label">${label}</span>
      </div>
    </div>`;
}

function getSpotTag(spot) {
  if (spot.id === 1) return 'DOWNTOWN';
  return `#${spot.id}`;
}

window.openSpotDetailById = function(spotId) {
  const spot = allSpots.find(s => s.id === spotId);
  if (spot) openSpotDetail(spot);
};

function openSpotDetail(spot) {
  if (!spot) return;

  const overlay = document.getElementById('spotDetailOverlay');
  if (!overlay) return;

  currentDetailSpot = spot;
  map.closePopup();

  const name        = spot[`name_${currentLang}`]        || spot.name_th;
  const description = spot[`description_${currentLang}`] || spot.description_th || spot.description || '';
  const history     = spot[`history_${currentLang}`]     || spot.history_th     || spot.history || '';
  const callout     = history || description;

  const titleEl     = document.getElementById('spotDetailTitle');
  const tagEl       = document.getElementById('spotDetailTag');
  const calloutEl   = document.getElementById('spotDetailCallout');
  const descEl      = document.getElementById('spotDetailDescription');
  const evContainer = document.getElementById('spotDetailEvTimes');
  const nearbyCard  = document.getElementById('spotNearbyCard');
  const pastCard    = document.getElementById('spotPastCard');
  const videoWrap   = document.getElementById('spotDetailVideoWrap');

  if (!titleEl || !descEl || !evContainer || !nearbyCard || !pastCard) return;

  titleEl.textContent = name;
  if (tagEl) tagEl.textContent = getSpotTag(spot);
  descEl.textContent = description;

  // ── Video player (replaces image) ──────────────────────────────────────────
  if (videoWrap) {
    const videoSrc = spot.video || '';  // expects spot.video path e.g. "vid/spot1.mp4"
    videoWrap.innerHTML = `
      <div style="position:relative; width:100%; border-radius:12px; overflow:hidden; background:#000;">
        <video
          id="spotDetailVideo"
          src="${videoSrc}"
          style="width:100%; display:block; max-height:260px; object-fit:cover;"
          autoplay muted loop playsinline
          poster="${spot.image || ''}"
        ></video>
        <!-- Mascot bottom-left corner -->
        <img
          src="./pic/mascot-guide.png"
          alt=""
          draggable="false"
          style="
            position:absolute;
            bottom: 0; left: 0;
            width: 80px; height: auto;
            pointer-events: none;
            filter: drop-shadow(2px 4px 8px rgba(0,0,0,0.4));
            z-index: 5;
          ">
        <span id="spotDetailTag2" style="
          position:absolute; top:10px; right:10px;
          background:#7A2882; color:white;
          font-size:11px; font-weight:800;
          padding:3px 10px; border-radius:999px;
          letter-spacing:0.05em;
        ">${getSpotTag(spot)}</span>
      </div>`;
  }

  evContainer.innerHTML = (spot.ev_time || [])
    .map(t => `<span class="time-badge">${t}</span>`)
    .join('');

  nearbyCard.innerHTML = buildLocationCard(pickLandmarkForSection(spot, 'nearby'));
  pastCard.innerHTML   = buildLocationCard(pickLandmarkForSection(spot, 'past'));

  if (typeof applyTranslations === 'function') applyTranslations();

  if (calloutEl) {
    calloutEl.textContent = callout.length > 120 ? callout.slice(0, 120) + '…' : callout;
  }

  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeSpotDetail() {
  currentDetailSpot = null;
  const overlay = document.getElementById('spotDetailOverlay');
  overlay?.classList.remove('active');
  overlay?.setAttribute('aria-hidden', 'true');
  fitMapToAllSpots(true);
}

/** @deprecated use openSpotDetail */
function openPopup(spot, marker) {
  openSpotDetail(spot);
}

// ──────────────────────────────────────────────────────────────────────────────
// Navigation Panel
// ──────────────────────────────────────────────────────────────────────────────
function setupPanelControls() {
  document.getElementById('closePanelBtn').addEventListener('click', closePanel);

  document.getElementById('openGoogleMapsBtn').addEventListener('click', () => {
    if (!currentNavTarget) return;
    const { latitude: lat, longitude: lng } = currentNavTarget;
    const origin = userLatLng ? `${userLatLng[0]},${userLatLng[1]}` : '';
    const url = origin
      ? `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${lat},${lng}&travelmode=walking`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank');
  });

  document.getElementById('nextStopBtn').addEventListener('click', () => {
    if (!currentNavTarget) return;
    const curIdx = EV_ROUTE_STOPS.indexOf(currentNavTarget.id);
    const nextId = EV_ROUTE_STOPS[(curIdx + 1) % EV_ROUTE_STOPS.length];
    startNavigation(nextId);
  });

  document.getElementById('startTourBtn')?.addEventListener('click', () => {
    if (!userLatLng) {
      Swal.fire({
        icon: 'info',
        title: 'เปิด GPS ก่อน',
        text: 'อนุญาตตำแหน่งเพื่อเริ่มนำทางตามเส้นทาง EV',
        confirmButtonText: 'ตกลง',
        confirmButtonColor: '#7A2882'
      });
      return;
    }
    startEvTour();
  });
}

function getSpotCoords(id) {
  const s = allSpots.find(sp => sp.id === id);
  return s ? [s.latitude, s.longitude] : null;
}

function getSuggestedNextStopId() {
  if (!userLatLng) return EV_ROUTE_STOPS[0];

  const user = L.latLng(userLatLng[0], userLatLng[1]);
  let nearestIdx = 0;
  let minDist = Infinity;

  EV_ROUTE_STOPS.forEach((id, idx) => {
    const c = getSpotCoords(id);
    if (!c) return;
    const d = user.distanceTo(L.latLng(c[0], c[1]));
    if (d < minDist) {
      minDist = d;
      nearestIdx = idx;
    }
  });

  if (minDist < 80) {
    return EV_ROUTE_STOPS[(nearestIdx + 1) % EV_ROUTE_STOPS.length];
  }
  return EV_ROUTE_STOPS[nearestIdx];
}

function startEvTour() {
  startNavigation(getSuggestedNextStopId());
}

function getRouteStepLabel(spotId) {
  const idx = EV_ROUTE_STOPS.indexOf(spotId);
  if (idx === -1) return 'นำทางไปยัง...';
  return `เส้นทาง EV · สถานี ${idx + 1}/${EV_ROUTE_STOPS.length}`;
}

window.startNavigation = function(spotId) {
  const spot = allSpots.find(s => s.id === spotId);
  if (!spot) return;

  currentNavTarget = spot;
  closeSpotDetail();

  // Show panel
  const panel = document.getElementById('gpsPanel');
  panel.classList.remove('hidden-panel');

  // Update destination badge & name
  const isFirst = spot.id === 1;
  const bg = isFirst ? '#e74c3c' : '#2ecc71';
  const border = isFirst ? '#c0392b' : '#27ae60';
  document.getElementById('destBadge').textContent = spot.id;
  document.getElementById('destBadge').style.background = bg;
  document.getElementById('destBadge').style.borderColor = border;
  document.getElementById('destName').textContent =
    spot[`name_${currentLang}`] || spot.name_th;
  document.getElementById('gpsPanelTitle').textContent = getRouteStepLabel(spot.id);

  const nextIdx = EV_ROUTE_STOPS.indexOf(spot.id);
  if (nextIdx !== -1 && nextIdx < EV_ROUTE_STOPS.length - 1) {
    const nextSpot = allSpots.find(s => s.id === EV_ROUTE_STOPS[nextIdx + 1]);
    const nextName = nextSpot ? (nextSpot[`name_${currentLang}`] || nextSpot.name_th) : '';
    document.getElementById('navStepsContainer').innerHTML = `
      <p class="text-xs text-gray-500 dark:text-gray-400 py-1">
        <i class="fas fa-arrow-right text-primary mr-1"></i>
        ถัดไป: <strong class="text-gray-800 dark:text-gray-200">#${EV_ROUTE_STOPS[nextIdx + 1]} ${nextName}</strong>
      </p>
      <p class="text-xs text-gray-400 text-center py-2">กำลังโหลดเส้นทางจาก GPS...</p>`;
  }

  // Draw routing line
  drawRoutingLine(spot);
  updateDistanceInfo();
};

function drawRoutingLine(spot) {
  // Remove old routing
  if (routingControl) {
    try { map.removeControl(routingControl); } catch(e) {}
    routingControl = null;
  }

  const destLatLng = L.latLng(spot.latitude, spot.longitude);

  // If user location known, route from user → dest
  if (userLatLng) {
    const fromLatLng = L.latLng(userLatLng[0], userLatLng[1]);

    routingControl = L.Routing.control({
      waypoints: [fromLatLng, destLatLng],
      router: L.Routing.osrmv1({
        serviceUrl: 'https://router.project-osrm.org/route/v1',
        profile: 'foot'   // walking
      }),
      lineOptions: {
        styles: [
          { color: '#1a1a1a', weight: 7, opacity: 0.35 },
          { color: '#1d6edb', weight: 5, opacity: 0.95 },
          { color: '#93c5fd', weight: 2, opacity: 0.9, dashArray: '6 8' }
        ]
      },
      addWaypoints: false,
      draggableWaypoints: false,
      fitSelectedRoutes: false,
      showAlternatives: false,
      createMarker: () => null   // don't add default start/end markers
    }).addTo(map);

    // Extract steps when route is found
    routingControl.on('routesfound', (e) => {
      const route = e.routes[0];
      renderNavSteps(route.instructions, route.summary);
    });

    routingControl.on('routingerror', () => {
      renderNavStepsFallback(spot);
    });

  } else {
    // No GPS — just draw straight line + show instructions fallback
    renderNavStepsFallback(spot);
  }
}

function updateDistanceInfo() {
  if (!currentNavTarget || !userLatLng) {
    document.getElementById('destDist').innerHTML =
      '<i class="fas fa-info-circle mr-1"></i>เปิด GPS เพื่อดูระยะทาง';
    return;
  }
  const dest = L.latLng(currentNavTarget.latitude, currentNavTarget.longitude);
  const user = L.latLng(userLatLng[0], userLatLng[1]);
  const meters = user.distanceTo(dest);
  const dist = meters < 1000
    ? `${Math.round(meters)} ม.`
    : `${(meters / 1000).toFixed(1)} กม.`;
  const minutes = Math.round(meters / 80); // ~80m/min walking
  document.getElementById('destDist').innerHTML =
    `<i class="fas fa-walking mr-1"></i>${dist} · ประมาณ ${minutes} นาที`;
}

function renderNavSteps(instructions, summary) {
  const container = document.getElementById('navStepsContainer');
  if (!instructions || instructions.length === 0) {
    renderNavStepsFallback(currentNavTarget);
    return;
  }

  // Direction icon mapping
  const dirIcon = (type) => {
    const map2 = {
      Straight:    'fa-arrow-up',
      SlightRight: 'fa-arrow-right',
      SlightLeft:  'fa-arrow-left',
      Right:       'fa-turn-right',
      Left:        'fa-turn-left',
      SharpRight:  'fa-arrow-turn-right',
      SharpLeft:   'fa-arrow-turn-left',
      Roundabout:  'fa-circle-right',
      DestinationReached: 'fa-flag-checkered',
      WaypointReached: 'fa-map-pin',
      Head:        'fa-arrow-up'
    };
    return map2[type] || 'fa-arrow-up';
  };

  const distStr = summary.totalDistance < 1000
    ? `${Math.round(summary.totalDistance)} ม.`
    : `${(summary.totalDistance/1000).toFixed(1)} กม.`;
  const timeStr = `${Math.round(summary.totalTime / 60)} นาที`;

  container.innerHTML = `
    <div class="flex gap-3 mb-2 text-xs text-gray-500 dark:text-gray-400">
      <span><i class="fas fa-route mr-1 text-blue-500"></i>${distStr}</span>
      <span><i class="fas fa-clock mr-1 text-green-500"></i>${timeStr}</span>
    </div>
    ${instructions.slice(0, 7).map((step, i) => `
      <div class="nav-step" style="animation-delay:${i * 0.04}s">
        <div class="w-7 h-7 rounded-full bg-blue-50 dark:bg-blue-900 flex-shrink-0 flex items-center justify-center">
          <i class="fas ${dirIcon(step.type)} text-blue-600 dark:text-blue-300 text-xs"></i>
        </div>
        <span class="text-xs leading-tight">${step.text}</span>
      </div>
    `).join('')}
  `;
}

function renderNavStepsFallback(spot) {
  const name = spot[`name_${currentLang}`] || spot.name_th;
  document.getElementById('navStepsContainer').innerHTML = `
    <div class="text-center py-3">
      <i class="fas fa-map-pin text-primary text-2xl mb-2"></i>
      <p class="text-xs text-gray-500 dark:text-gray-400">กดปุ่ม <strong>Google Maps</strong><br>เพื่อเปิดเส้นทางแบบเต็มรูปแบบ</p>
      <p class="mt-2 text-xs font-semibold text-gray-700 dark:text-gray-200">🏁 ${name}</p>
    </div>`;
}

function closePanel() {
  document.getElementById('gpsPanel').classList.add('hidden-panel');
  currentNavTarget = null;
  if (routingControl) {
    try { map.removeControl(routingControl); } catch(e) {}
    routingControl = null;
  }
  fitMapToAllSpots(true);
}

// ──────────────────────────────────────────────────────────────────────────────
// Current Location Button
// ──────────────────────────────────────────────────────────────────────────────
document.getElementById('currentLocationBtn')?.addEventListener('click', () => {
  if (!("geolocation" in navigator)) {
    Swal.fire({ icon: 'error', title: 'ไม่รองรับ GPS', text: 'เบราว์เซอร์ไม่รองรับ Geolocation' });
    return;
  }
  navigator.geolocation.getCurrentPosition((pos) => {
    userLatLng = [pos.coords.latitude, pos.coords.longitude];
    updateUserDot(userLatLng);
  }, () => {
    Swal.fire({ icon: 'warning', title: 'ไม่พบตำแหน่ง', text: 'กรุณาอนุญาตการเข้าถึง GPS' });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Find Nearest Stop Button
// ──────────────────────────────────────────────────────────────────────────────
document.getElementById('nearestStopBtn')?.addEventListener('click', () => {
  if (!userLatLng) {
    Swal.fire({
      icon: 'info',
      title: 'เปิด GPS ก่อน',
      text: 'กดปุ่ม GPS ก่อนเพื่อระบุตำแหน่งของคุณ',
      confirmButtonText: 'ตกลง',
      confirmButtonColor: '#7A2882'
    });
    return;
  }

  const user = L.latLng(userLatLng[0], userLatLng[1]);
  let nearest = null;
  let minDist = Infinity;

  allSpots.forEach(spot => {
    const d = user.distanceTo(L.latLng(spot.latitude, spot.longitude));
    if (d < minDist) { minDist = d; nearest = spot; }
  });

  if (!nearest) return;

  const distStr = minDist < 1000
    ? `${Math.round(minDist)} ม.`
    : `${(minDist / 1000).toFixed(1)} กม.`;

  Swal.fire({
    icon: 'success',
    title: `🚌 สถานีใกล้ที่สุด: #${nearest.id}`,
    text: `${nearest[`name_${currentLang}`] || nearest.name_th} — ห่าง ${distStr}`,
    confirmButtonText: 'นำทางไปเลย!',
    showCancelButton: true,
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#7A2882'
  }).then(result => {
    if (result.isConfirmed) startNavigation(nearest.id);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// EV tour route (OSRM foot path + direction arrows)
// ──────────────────────────────────────────────────────────────────────────────
async function drawEvTourRoute(spots) {
  if (!tourRouteLayer) return;
  tourRouteLayer.clearLayers();

  const waypointLatLngs = EV_ROUTE_ORDER.map(id => getSpotCoords(id)).filter(Boolean);
  if (waypointLatLngs.length < 2) return;

  let pathLatLngs = waypointLatLngs;

  try {
    const coordStr = EV_ROUTE_ORDER
      .map(id => {
        const s = spots.find(sp => sp.id === id);
        return s ? `${s.longitude},${s.latitude}` : null;
      })
      .filter(Boolean)
      .join(';');

    const res = await fetch(
      `https://router.project-osrm.org/route/v1/foot/${coordStr}?overview=full&geometries=geojson`
    );
    const data = await res.json();

    if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
      pathLatLngs = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
    }
  } catch (e) {
    console.warn('OSRM tour route fallback to straight segments', e);
  }

  renderTourRouteLines(pathLatLngs);
  placeRouteDirectionArrows(pathLatLngs);
}

function renderTourRouteLines(latlngs) {
  const lineOpts = {
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false,
    className: 'leaflet-ev-route-shadow'
  };

  L.polyline(latlngs, { ...lineOpts, color: '#ffffff', weight: 10, opacity: 0.55 }).addTo(tourRouteLayer);
  L.polyline(latlngs, { ...lineOpts, color: '#1a1a1a', weight: 7, opacity: 0.92 }).addTo(tourRouteLayer);
  L.polyline(latlngs, { ...lineOpts, color: '#7A2882', weight: 4, opacity: 0.85 }).addTo(tourRouteLayer);
}

function placeRouteDirectionArrows(latlngs) {
  if (latlngs.length < 2) return;

  const total = latlngs.length;
  const step = Math.max(2, Math.floor(total / 20));

  for (let i = step; i < total - 1; i += step) {
    const from = latlngs[i - 1];
    const to = latlngs[i];
    const midLat = (from[0] + to[0]) / 2;
    const midLng = (from[1] + to[1]) / 2;
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]) * (180 / Math.PI);

    const arrowIcon = L.divIcon({
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 18 18"
               style="transform:rotate(${angle}deg);display:block;">
               <polygon points="9,0 18,18 9,12 0,18" fill="#e74c3c" stroke="white" stroke-width="1.2"/>
             </svg>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      className: ''
    });

    L.marker([midLat, midLng], {
      icon: arrowIcon,
      interactive: false,
      zIndexOffset: 200
    }).addTo(tourRouteLayer);
  }
}

window.navigate = function(lat, lng) {
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
};

function openPopup(spot, marker) {
  const name = spot[`name_${currentLang}`] || spot.name_th;
  const description = spot[`description_${currentLang}`] || spot.description_th || spot.description;
  const history = spot[`history_${currentLang}`] || spot.history_th || spot.history;

  // Ensure panel exists in DOM
  let panel = document.getElementById('spotDetailPanel');
  const isMobile = window.innerWidth < 768;

  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'spotDetailPanel';
    document.body.appendChild(panel);

    // Dark mode support
    const applyTheme = () => {
      const isDark = document.documentElement.classList.contains('dark');
      panel.style.background = isDark ? '#1f2937' : 'white';
      panel.style.color = isDark ? '#f9fafb' : '#111827';
    };
    applyTheme();
    new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  // bottom always 0 — padding-bottom pushes content above the nav bar
  panel.style.cssText = `
    position: fixed;
    bottom: 0; left: 0; right: 0;
    z-index: 60;
    max-height: 60vh;
    overflow-y: auto;
    background: white;
    border-radius: 1.25rem 1.25rem 0 0;
    box-shadow: 0 -8px 32px rgba(0,0,0,0.18);
    transform: translateY(100%);
    transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
    padding-bottom: ${isMobile ? '64px' : '0px'};
  `;

  // Translation labels with fallbacks
  const labelDetail = { th: 'รายละเอียดสถานที่', en: 'Spot Detail', cn: '地点详情' };
  const labelHistory = { th: 'ประวัติความเป็นมา', en: 'History', cn: '历史背景' };
  const labelNearby = { th: 'สถานที่ใกล้เคียง', en: 'Nearby Places', cn: '附近地点' };
  const labelEvTime = { th: 'เวลารถ EV ผ่าน', en: 'EV Passing Times', cn: '电动车经过时间' };
  const labelNavigate = { th: 'นำทางไปสถานีนี้', en: 'Navigate Here', cn: '导航至此' };
  const lang = currentLang || 'th';

  panel.innerHTML = `
    <div style="display:flex;justify-content:center;padding:12px 0 4px;">
      <div style="width:40px;height:4px;border-radius:99px;background:#d1d5db;"></div>
    </div>

    <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:4px 16px 12px;">
      <div style="flex:1;padding-right:8px;">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#7A2882;margin:0 0 4px;">${labelDetail[lang]}</p>
        <h2 style="font-size:20px;font-weight:800;margin:0;color:inherit;">${name}</h2>
      </div>
      <button id="closeSpotPanel"
        style="width:32px;height:32px;border-radius:50%;background:#f3f4f6;border:none;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px;color:#6b7280;">
        ✕
      </button>
    </div>

    <div style="padding:0 16px 16px;display:flex;flex-direction:column;gap:14px;font-size:14px;">

      ${spot.image ? `
      <div style="width: 100%; height: 200px; border-radius: 12px; overflow: hidden; margin-bottom: 4px; background-color: #f3f4f6; display: flex; justify-content: center; align-items: center;">
        <img src="${spot.image}" alt="${name}" style="width: 100%; height: 100%; object-fit: contain;">
      </div>
      ` : ''}

      <div>
        <p style="font-weight:700;margin:0 0 4px;color:inherit;">${labelHistory[lang]}</p>
        <p style="color:#6b7280;line-height:1.6;margin:0;">${history || description}</p>
      </div>

      <div>
        <p style="font-weight:700;margin:0 0 4px;color:inherit;">
          <i class="fas fa-map-marker-alt" style="color:#7A2882;margin-right:4px;"></i>${labelNearby[lang]}
        </p>
        <p style="color:#6b7280;margin:0;">${spot.nearby_landmarks ? spot.nearby_landmarks.join(', ') : '—'}</p>
      </div>

      ${spot.ev_time && spot.ev_time.length ? `
      <div>
        <p style="font-weight:700;margin:0 0 8px;color:inherit;">
          <i class="fas fa-bus" style="color:#7A2882;margin-right:4px;"></i>${labelEvTime[lang]}
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${spot.ev_time.map(t => `<span style="background:#f3e8ff;color:#7A2882;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;">${t}</span>`).join('')}
        </div>
      </div>` : ''}

      <button onclick="startNavigation(${spot.id})"
        style="width:100%; padding:12px; border-radius:12px; border:none; cursor:pointer;
               background:linear-gradient(135deg,#7A2882,#1d6edb); color:white;
               font-weight:700; font-size:14px; margin-top:4px;">
        <i class="fas fa-route" style="margin-right:6px;"></i>
        ${labelNavigate[lang]}
      </button>
    </div>
  `;

  // Slide up
  requestAnimationFrame(() => {
    panel.style.transform = 'translateY(0)';
  });

  // Lock body scroll so only panel scrolls
  document.body.style.overflow = 'hidden';

  // Close button
  document.getElementById('closeSpotPanel').addEventListener('click', closeSpotPanel);

  // Scroll map to center on marker
  map.panTo([spot.latitude, spot.longitude], { animate: true });
}
