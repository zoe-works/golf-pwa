import { haversineMeters, metersToYardsRounded } from './distance.js';
import { GeolocationTracker } from './geolocation.js';

let map;
let userMarker;
let holeTargets = {}; // Stores coordinates { green_center: [lng, lat], ... }
let currentHoleLayers = L.layerGroup();

async function init() {
    // 1. Initialize Leaflet Map
    map = L.map('map').setView([14.141, 100.951], 16);

    // Add standard OSM tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    currentHoleLayers.addTo(map);

    // 2. Setup UI event listeners
    document.getElementById('btn-start').addEventListener('click', startTracking);

    const courseSelector = document.getElementById('course-selector');
    const holeSelector = document.getElementById('hole-selector');

    courseSelector.addEventListener('change', async () => {
        await loadCourse(courseSelector.value);
    });

    holeSelector.addEventListener('change', () => {
        const selectedHole = parseInt(holeSelector.value);
        displayHole(selectedHole);
    });

    // 3. Initial Load
    await loadCourse(courseSelector.value);
}

let courseData = null;

async function loadCourse(url) {
    try {
        const response = await fetch(url);
        const data = await response.json();
        courseData = data;

        // Populate hole selector
        const holeSelector = document.getElementById('hole-selector');
        holeSelector.innerHTML = '';

        // Extract unique hole numbers
        const holes = [...new Set(data.features.map(f => f.properties.hole))].sort((a, b) => a - b);

        holes.forEach(hole => {
            const opt = document.createElement('option');
            opt.value = hole;
            opt.innerText = `Hole ${hole}`;
            holeSelector.appendChild(opt);
        });

        // Display first hole
        if (holes.length > 0) {
            displayHole(holes[0]);
        }
    } catch (error) {
        console.error("Error loading course data", error);
    }
}

function displayHole(holeNumber) {
    currentHoleLayers.clearLayers();
    holeTargets = {};

    const holeFeatures = courseData.features.filter(f => f.properties.hole === holeNumber);

    // Custom style for the hole path
    const holeStyle = {
        color: '#43a047',
        weight: 4,
        opacity: 0.8
    };

    const geoJsonLayer = L.geoJSON(holeFeatures, {
        style: function (feature) {
            if (feature.properties.kind === 'hole_path') return holeStyle;
        },
        pointToLayer: function (feature, latlng) {
            const kind = feature.properties.kind;
            holeTargets[kind] = feature.geometry.coordinates;

            let color = '#333';
            let radius = 6;
            if (kind.startsWith('green')) color = '#43a047';
            if (kind.startsWith('hazard')) color = '#f9a825';

            return L.circleMarker(latlng, {
                radius: radius,
                fillColor: color,
                color: '#fff',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            }).bindPopup(feature.properties.label || kind);
        }
    });

    currentHoleLayers.addLayer(geoJsonLayer);

    // Zoom to fit the hole
    if (geoJsonLayer.getBounds().isValid()) {
        map.fitBounds(geoJsonLayer.getBounds(), { padding: [50, 50] });
    }
}

// Global tracker instance
let tracker = null;

function startTracking() {
    const btn = document.getElementById('btn-start');
    btn.innerText = "Tracking location...";
    btn.disabled = true;

    tracker = new GeolocationTracker(
        (pos) => updateLocationUI(pos),
        (err) => handleLocationError(err)
    );
    tracker.start();

    updateGpsStatus('connecting', 'Connecting...');
}

function updateLocationUI(pos) {
    const latlng = [pos.lat, pos.lng];
    const userCoords = [pos.lng, pos.lat]; // [lng, lat] for Haversine

    // 1. Update Map Marker
    if (!userMarker) {
        userMarker = L.circleMarker(latlng, {
            radius: 8,
            fillColor: '#1e88e5',
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
        }).addTo(map).bindPopup("You");
    } else {
        userMarker.setLatLng(latlng);
    }

    // 2. Calculate Distances
    const distMap = {
        'green_center': 'dist-green-center',
        'green_front': 'dist-green-front',
        'green_back': 'dist-green-back',
        'hazard_front': 'dist-hazard-front',
        'hazard_back': 'dist-hazard-back',
    };

    const accuracyPrefix = pos.accuracy > 20 ? '± ' : '';

    for (const [kind, elemId] of Object.entries(distMap)) {
        const el = document.getElementById(elemId);
        if (el) {
            if (holeTargets[kind]) {
                const targetCoords = holeTargets[kind]; // [lng, lat]
                const meters = haversineMeters(userCoords, targetCoords);
                const yards = metersToYardsRounded(meters);
                el.innerText = `${accuracyPrefix}${yards} yd`;
            } else {
                el.innerText = "-- yd";
            }
        }
    }

    // 3. Update Status
    updateGpsStatus('connected', `GPS: ±${Math.round(pos.accuracy)}m`);
}

function handleLocationError(err) {
    console.warn("Location error:", err);
    updateGpsStatus('disconnected', `Error: ${err.message}`);
    const btn = document.getElementById('btn-start');
    btn.innerText = "Retry Tracking";
    btn.disabled = false;
}

function updateGpsStatus(state, msg) {
    const el = document.getElementById('gps-status');
    el.innerHTML = `<span class="dot ${state}"></span> ${msg}`;
}

// Boot up
document.addEventListener('DOMContentLoaded', init);

