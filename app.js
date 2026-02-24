import { haversineMeters, metersToYardsRounded } from './distance.js';
import { GeolocationTracker } from './geolocation.js';

let map;
let userMarker;
let holeTargets = {}; // Stores coordinates { green_front: [lng, lat], ... }

async function init() {
    // 1. Initialize Leaflet Map
    // Start with a generic center, will adjust when GeoJSON loads
    map = L.map('map').setView([35.670, 139.700], 16);

    // Add standard OSM tiles (Since it's MVP, free without API key)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    // 2. Load Course Data (Hole 7)
    await loadHoleData('data/hole7.geojson');

    // 3. Setup UI event listeners
    document.getElementById('btn-start').addEventListener('click', startTracking);
}

async function loadHoleData(url) {
    try {
        const response = await fetch(url);
        const data = await response.json();

        // Reset targets
        holeTargets = {};

        // Custom style for the hole path
        const holeStyle = {
            color: '#43a047',
            weight: 4,
            opacity: 0.8
        };

        const geoJsonLayer = L.geoJSON(data, {
            style: function (feature) {
                if (feature.properties.kind === 'hole_path') return holeStyle;
            },
            pointToLayer: function (feature, latlng) {
                // Find which target this point represents
                const kind = feature.properties.kind;

                // Store coordinates (GeoJSON is lng,lat but Leaflet prefers lat,lng internally, we store the original lng,lat array for our distance func)
                holeTargets[kind] = feature.geometry.coordinates;

                // Visual markers for targets
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
                }).bindPopup(feature.properties.label);
            }
        }).addTo(map);

        // Zoom to fit the hole
        map.fitBounds(geoJsonLayer.getBounds(), { padding: [20, 20] });

    } catch (error) {
        console.error("Error loading GeoJSON", error);
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
            fillColor: '#1e88e5', // blue point
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
        }).addTo(map).bindPopup("You");
        // map.setView(latlng, 17); // Optional: Pan map to user on first fix
    } else {
        userMarker.setLatLng(latlng);
    }

    // 2. Calculate Distances
    const distMap = {
        'green_front': 'dist-green-front',
        'green_back': 'dist-green-back',
        'hazard_front': 'dist-hazard-front',
        'hazard_back': 'dist-hazard-back',
    };

    for (const [kind, elemId] of Object.entries(distMap)) {
        if (holeTargets[kind]) {
            const targetCoords = holeTargets[kind]; // [lng, lat]
            const meters = haversineMeters(userCoords, targetCoords);
            const yards = metersToYardsRounded(meters);

            const el = document.getElementById(elemId);
            if (el) {
                // Include ± precision based on GPS accuracy. If accuracy > 20m, add "±" for context.
                const accuracyPrefix = pos.accuracy > 20 ? '± ' : '';
                el.innerText = `${accuracyPrefix}${yards} yd`;
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
