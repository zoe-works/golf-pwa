import { haversineMeters, metersToYardsRounded } from './distance.js';
import { GeolocationTracker } from './geolocation.js';

let map;
let userMarker;
let userHeading = 0;
let tapMarker;
let tapLine;
let holeTargets = {}; // Stores coordinates { green_center: [lng, lat], ... }
let currentHoleLayers = L.layerGroup();

const COURSE_METADATA = {
    'data/prime_city.json': { lat: 14.141, lng: 100.951, name: 'Prime City & Golf' },
    'data/bangsai.json': { lat: 14.212, lng: 100.463, name: 'Bangsai Country Club' }
};

async function init() {
    // 1. Initialize Leaflet Map
    map = L.map('map').setView([14.141, 100.951], 16);

    // Add Google Maps Hybrid tiles (Satellite + Labels)
    L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        attribution: 'Map data &copy; <a href="https://www.google.com/maps">Google</a>'
    }).addTo(map);

    currentHoleLayers.addTo(map);

    // 2. Map click listener for distance tool
    map.on('click', (e) => {
        if (!lastPos) return;
        const clickedLatLng = e.latlng;
        const userLatLng = [lastPos.lat, lastPos.lng];
        const userCoords = [lastPos.lng, lastPos.lat];
        const targetCoords = [clickedLatLng.lng, clickedLatLng.lat];

        const meters = haversineMeters(userCoords, targetCoords);
        const yards = metersToYardsRounded(meters);

        if (!tapMarker) {
            tapMarker = L.marker(clickedLatLng, {
                icon: L.divIcon({
                    className: 'tap-marker-icon',
                    iconSize: [12, 12],
                    iconAnchor: [6, 6]
                })
            }).addTo(map);
        } else {
            tapMarker.setLatLng(clickedLatLng);
        }

        tapMarker.bindTooltip(`<div class="tap-distance-label">${yards} yd</div>`, {
            permanent: true,
            direction: 'top',
            className: 'tap-tooltip'
        }).openTooltip();

        if (!tapLine) {
            tapLine = L.polyline([userLatLng, clickedLatLng], {
                color: '#ff5722',
                weight: 2,
                dashArray: '5, 10'
            }).addTo(map);
        } else {
            tapLine.setLatLngs([userLatLng, clickedLatLng]);
        }
    });

    // 3. Setup UI event listeners
    document.getElementById('btn-start').addEventListener('click', toggleTracking);

    document.getElementById('btn-recenter').addEventListener('click', () => {
        if (lastPos) {
            map.setView([lastPos.lat, lastPos.lng], 17);
        } else {
            toggleTracking();
        }
    });

    const courseSelector = document.getElementById('course-selector');
    const holeSelector = document.getElementById('hole-selector');

    courseSelector.addEventListener('change', async () => {
        await loadCourse(courseSelector.value);
    });

    holeSelector.addEventListener('change', () => {
        displayHole(holeSelector.value);
    });

    // Edit map toggle
    const btnEditToggle = document.getElementById('btn-edit-toggle');
    const btnExportData = document.getElementById('btn-export-data');
    const btnImportData = document.getElementById('btn-import-data');
    const importFileInput = document.getElementById('import-file-input');
    const btnResetData = document.getElementById('btn-reset-data');

    btnEditToggle.addEventListener('click', () => {
        isEditMode = !isEditMode;
        if (isEditMode) {
            btnEditToggle.classList.add('active');
            btnEditToggle.innerText = 'Done Editing';
            btnExportData.style.display = 'block';
            btnImportData.style.display = 'block';
            btnResetData.style.display = 'block';
            document.getElementById('app').classList.add('editing');
        } else {
            btnEditToggle.classList.remove('active');
            btnEditToggle.innerText = 'Edit Map';
            btnExportData.style.display = 'none';
            btnImportData.style.display = 'none';
            btnResetData.style.display = 'none';
            document.getElementById('app').classList.remove('editing');
        }
        // Force redraw of current hole to apply draggable markers
        if (holeSelector.value) {
            displayHole(holeSelector.value);
        }
    });

    // Import data logic
    btnImportData.addEventListener('click', () => {
        importFileInput.click();
    });

    importFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                // Basic validation
                if (importedData.type === "FeatureCollection" && importedData.features) {
                    courseData = importedData;
                    saveCourseData();
                    alert("データをインポートして保存しました！");

                    // Reload current hole
                    if (holeSelector.value) {
                        displayHole(holeSelector.value);
                    }
                } else {
                    alert("無効なデータ形式です。");
                }
            } catch (error) {
                console.error("Error parsing imported JSON:", error);
                alert("ファイルの読み込みに失敗しました。");
            }
        };
        reader.readAsText(file);

        // Reset input so the same file can be selected again if needed
        importFileInput.value = '';
    });

    // Export / Share modified data
    btnExportData.addEventListener('click', async () => {
        if (!courseData) return;
        const jsonString = JSON.stringify(courseData, null, 2);
        const fileName = currentCourseUrl.split('/').pop() || "course_data.json";

        // Try Web Share API for mobile devices (iOS Safari)
        if (navigator.share && navigator.canShare) {
            const file = new File([jsonString], fileName, { type: 'application/json' });
            if (navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({
                        files: [file],
                        title: 'Golf Course Data',
                        text: 'Updated green coordinates'
                    });
                    return; // Successfully shared
                } catch (err) {
                    console.log("Share cancelled or failed", err);
                    // Fall through to regular download
                }
            }
        }

        // Fallback for desktop or non-supported browsers
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonString);
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", fileName);
        document.body.appendChild(downloadAnchorNode); // required for firefox
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    });

    // Reset local data to defaults
    btnResetData.addEventListener('click', async () => {
        if (confirm("デフォルトのマップデータに戻しますか？ローカルの編集内容は消去されます。")) {
            localStorage.removeItem(`golf-course-${currentCourseUrl}`);
            await loadCourse(currentCourseUrl);

            // Turn off edit mode
            isEditMode = false;
            btnEditToggle.classList.remove('active');
            btnEditToggle.innerText = 'Edit Map';
            btnExportData.style.display = 'none';
            btnResetData.style.display = 'none';
            document.getElementById('app').classList.remove('editing');
        }
    });

    // 3. Initial Load - Try auto-detecting nearest course
    let initialCourse = courseSelector.value;

    if ("geolocation" in navigator) {
        updateGpsStatus('connecting', 'Finding nearest course...');
        try {
            const pos = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
            });
            const nearest = findNearestCourse(pos.coords.latitude, pos.coords.longitude);
            if (nearest) {
                console.log(`Auto-selected nearest course: ${nearest}`);
                courseSelector.value = nearest;
                initialCourse = nearest;
            }
        } catch (err) {
            console.log("Auto-select failed or timed out, using default.", err);
        }
    }

    await loadCourse(initialCourse);
}

function findNearestCourse(userLat, userLng) {
    let nearestUrl = null;
    let minDist = Infinity;

    for (const [url, meta] of Object.entries(COURSE_METADATA)) {
        const dist = haversineMeters([userLng, userLat], [meta.lng, meta.lat]);
        if (dist < minDist) {
            minDist = dist;
            nearestUrl = url;
        }
    }
    // Only auto-select if within 50km
    return minDist < 50000 ? nearestUrl : null;
}

let courseData = null;
let currentCourseUrl = null;
let isEditMode = false;

async function loadCourse(url) {
    try {
        currentCourseUrl = url;

        // Check local storage first
        const savedData = localStorage.getItem(`golf-course-${url}`);
        if (savedData) {
            courseData = JSON.parse(savedData);
            console.log("Loaded course from local storage");
        } else {
            const response = await fetch(url);
            courseData = await response.json();
        }

        // Populate hole selector
        const holeSelector = document.getElementById('hole-selector');
        holeSelector.innerHTML = '';

        // Extract unique hole numbers
        const holes = [...new Set(courseData.features.map(f => f.properties.hole))];
        holes.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));

        holes.forEach(hole => {
            const opt = document.createElement('option');
            opt.value = hole;
            opt.innerText = String(hole).match(/^[A-Z]-/) ? hole : `Hole ${hole}`;
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

function saveCourseData() {
    if (courseData && currentCourseUrl) {
        localStorage.setItem(`golf-course-${currentCourseUrl}`, JSON.stringify(courseData));
        console.log(`Saved modified data for ${currentCourseUrl} to local storage.`);
    }
}

function displayHole(holeNumber) {
    currentHoleLayers.clearLayers();
    holeTargets = {};

    const holeFeatures = courseData.features.filter(f => String(f.properties.hole) === String(holeNumber));

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

            if (kind.startsWith('green')) {
                // If edit mode is on, create a draggable marker with a custom divIcon
                if (isEditMode) {
                    const icon = L.divIcon({
                        className: 'editable-marker',
                        html: `<div style="width: 16px; height: 16px; background: #f44336; border: 2px solid white; border-radius: 50%;"></div>`,
                        iconSize: [16, 16],
                        iconAnchor: [8, 8]
                    });

                    const marker = L.marker(latlng, {
                        icon: icon,
                        draggable: true
                    }).bindPopup(feature.properties.label || kind);

                    marker.on('dragend', function (event) {
                        const newPos = event.target.getLatLng();
                        // Update feature coordinates [lng, lat]
                        feature.geometry.coordinates = [newPos.lng, newPos.lat];
                        // Update holeTargets for immediate distance recalc
                        holeTargets[kind] = [newPos.lng, newPos.lat];
                        // Save to local storage
                        saveCourseData();
                        // Recalculate distances if we have a user position
                        if (lastPos) updateLocationUI(lastPos);
                    });

                    return marker;
                } else {
                    // Normal display mode
                    return L.circleMarker(latlng, {
                        radius: 6,
                        fillColor: '#43a047',
                        color: '#fff',
                        weight: 1,
                        opacity: 1,
                        fillOpacity: 0.8
                    }).bindPopup(feature.properties.label || kind);
                }
            } else if (kind.startsWith('hazard')) {
                return L.circleMarker(latlng, {
                    radius: 6,
                    fillColor: '#f9a825',
                    color: '#fff',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                }).bindPopup(feature.properties.label || kind);
            }

            // Fallback
            return L.circleMarker(latlng);
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
let lastPos = null;
let isFirstFix = true;

function toggleTracking() {
    const btn = document.getElementById('btn-start');

    if (tracker) {
        // STOP
        tracker.stop();
        tracker = null;
        if (btn) btn.innerText = "Start Location Tracking";
        updateGpsStatus('disconnected', 'Tracking stopped');
    } else {
        // START
        if (btn) {
            btn.innerText = "Stop Location Tracking";
        }

        tracker = new GeolocationTracker(
            (pos) => updateLocationUI(pos),
            (err) => handleLocationError(err)
        );
        tracker.start();
        updateGpsStatus('connecting', 'Connecting...');
        initCompass();
    }
}

function updateLocationUI(pos) {
    lastPos = pos;
    const latlng = [pos.lat, pos.lng];
    const userCoords = [pos.lng, pos.lat]; // [lng, lat] for Haversine

    // 1. Update Map Marker
    if (!userMarker) {
        const userIcon = L.divIcon({
            className: 'user-marker-container',
            html: `
                <div id="user-heading-cone" class="user-heading-cone" style="transform: rotate(${userHeading}deg)"></div>
                <div class="user-dot"></div>
            `,
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });

        userMarker = L.marker(latlng, {
            icon: userIcon,
            zIndexOffset: 1000
        }).addTo(map).bindPopup("You");
    } else {
        userMarker.setLatLng(latlng);
        // Update rotation if element exists
        const cone = document.getElementById('user-heading-cone');
        if (cone) {
            cone.style.transform = `rotate(${userHeading}deg)`;
        }
    }

    // Update tap line if it exists
    if (tapLine) {
        tapLine.setLatLngs([latlng, tapLine.getLatLngs()[1]]);
    }

    // 2. Center Map on first fix
    if (isFirstFix) {
        map.setView(latlng, 17);
        isFirstFix = false;
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

// Orientation / Compass handling
function initCompass() {
    if (window.DeviceOrientationEvent) {
        // Special handling for iOS 13+
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission()
                .then(permissionState => {
                    if (permissionState === 'granted') {
                        window.addEventListener('deviceorientation', handleOrientation);
                    }
                })
                .catch(console.error);
        } else {
            window.addEventListener('deviceorientation', handleOrientation);
        }
    }
}

function handleOrientation(event) {
    // alpha is the compass direction
    let compass = event.webkitCompassHeading || event.alpha;
    if (compass !== null && compass !== undefined) {
        // adjust for absolute vs relative if needed? webkitCompassHeading is already absolute.
        userHeading = compass;
        const cone = document.getElementById('user-heading-cone');
        if (cone) {
            cone.style.transform = `rotate(${userHeading}deg)`;
        }
    }
}

function handleLocationError(err) {
    console.warn("Location error:", err);
    updateGpsStatus('disconnected', `Error: ${err.message}`);
    const btn = document.getElementById('btn-start');
    if (btn) {
        btn.innerText = "Start Location Tracking";
        btn.disabled = false;
    }
    tracker = null;
}

function updateGpsStatus(state, msg) {
    const el = document.getElementById('gps-status');
    el.innerHTML = `<span class="dot ${state}"></span> ${msg}`;
}

// Boot up
document.addEventListener('DOMContentLoaded', init);

