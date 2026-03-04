import { haversineMeters, metersToYardsRounded } from './distance.js';
import { GeolocationTracker } from './geolocation.js';
import { ScorecardManager } from './scorecard.js';

let map;
let userMarker;
let userHeading = 0;
let tapMarker;
let tapLine;
let tapLineB; // Segment from Tap to Pin
let pinMarker; // Marker for the pin to help visibility
let isHeadingUp = true; // Default to Heading Up on start
let holeTargets = {}; // Stores coordinates { green_center: [lng, lat], ... }
let currentHoleLayers = L.layerGroup();
let shotLayers = L.layerGroup(); // Layer to hold shot markers and lines

let scorecard = new ScorecardManager();
let currentEditingShotNum = 1;
let tempShotData = { club: null, penalties: [], score: 50, memo: '' };

const COURSE_METADATA = {
    'data/prime_city.json': { lat: 14.141, lng: 100.951, name: 'Prime City & Golf' },
    'data/bangsai.json': { lat: 14.212, lng: 100.463, name: 'Bangsai Country Club' }
};

async function init() {
    // 1. Initialize Leaflet Map with Rotation
    map = L.map('map', {
        zoomControl: false,
        rotate: true,
        touchRotate: true,
        rotateControl: {
            closeOnZeroBearing: false
        },
        attributionControl: false
    }).setView([14.141, 100.951], 16);

    // Add Google Maps Hybrid tiles (Satellite + Labels)
    L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        attribution: 'Map data &copy; <a href="https://www.google.com/maps">Google</a>'
    }).addTo(map);

    currentHoleLayers.addTo(map);
    shotLayers.addTo(map);

    // 2. Map click listener for distance tool (User -> Tap -> Pin)
    map.on('click', (e) => {
        if (!lastPos) return;
        const clickedLatLng = e.latlng;
        const userLatLng = [lastPos.lat, lastPos.lng];
        const userCoords = [lastPos.lng, lastPos.lat];
        const targetCoords = [clickedLatLng.lng, clickedLatLng.lat];

        // Segment A: User -> Tap
        const metersA = haversineMeters(userCoords, targetCoords);
        const yardsA = metersToYardsRounded(metersA);

        // Segment B: Tap -> Pin
        let yardsB = null;
        let pinLatLng = null;
        if (holeTargets['green_center']) {
            const pinCoords = holeTargets['green_center']; // [lng, lat]
            pinLatLng = [pinCoords[1], pinCoords[0]];
            const metersB = haversineMeters(targetCoords, pinCoords);
            yardsB = metersToYardsRounded(metersB);
        }

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

        let tooltipContent = `<div class="tap-distance-label">User→Tap: ${yardsA} yd</div>`;
        if (yardsB !== null) {
            tooltipContent += `<div class="tap-distance-label segment-b">Tap→Pin: ${yardsB} yd</div>`;
        }

        tapMarker.bindTooltip(tooltipContent, {
            permanent: true,
            direction: 'top',
            className: 'tap-tooltip'
        }).openTooltip();

        // Line A: User -> Tap
        if (!tapLine) {
            tapLine = L.polyline([userLatLng, clickedLatLng], {
                color: '#ff5722',
                weight: 2,
                dashArray: '5, 10'
            }).addTo(map);
        } else {
            tapLine.setLatLngs([userLatLng, clickedLatLng]);
        }

        // Line B: Tap -> Pin
        if (pinLatLng) {
            if (!tapLineB) {
                tapLineB = L.polyline([clickedLatLng, pinLatLng], {
                    color: '#ff9800',
                    weight: 2,
                    dashArray: '2, 5'
                }).addTo(map);
            } else {
                tapLineB.setLatLngs([clickedLatLng, pinLatLng]);
            }
        }
    });

    // 3. Setup UI event listeners

    // Bottom Navigation Logic
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = e.currentTarget.getAttribute('data-target');

            // Highlight active button
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');

            // Switch view container
            document.querySelectorAll('.view-section').forEach(view => {
                if (view.id === targetId) {
                    view.classList.remove('hidden');
                    view.classList.add('active');
                } else {
                    view.classList.add('hidden');
                    view.classList.remove('active');
                }
            });

            // Trigger view-specific refreshes
            if (targetId === 'view-play') {
                setTimeout(() => map.invalidateSize(), 50);
                if (!isTracking) toggleTracking();
            } else if (targetId === 'view-history') {
                if (typeof window.renderHistoryList === 'function') window.renderHistoryList();
            } else if (targetId === 'view-settings') {
                if (typeof window.renderSettingsUI === 'function') window.renderSettingsUI();
            }
        });
    });

    document.getElementById('btn-recenter').addEventListener('click', () => {
        if (lastPos) {
            map.setView([lastPos.lat, lastPos.lng], 17);
            // Toggle mode
            if (isHeadingUp) {
                isHeadingUp = false;
                document.getElementById('btn-recenter').classList.remove('active');
            } else {
                isHeadingUp = true;
                document.getElementById('btn-recenter').classList.add('active');
                if (userHeading) map.setBearing(360 - userHeading);
            }
        } else {
            toggleTracking();
        }
    });

    // Disable auto-rotation if user manually rotates the map
    map.on('rotatestart', () => {
        isHeadingUp = false;
        document.getElementById('btn-recenter').classList.remove('active');
    });

    // Intercept clicking on Leaflet's compass control to lock heading instead of reverting to North
    document.addEventListener('click', (e) => {
        if (e.target.closest('.leaflet-control-compass') || e.target.closest('.leaflet-control-rotate')) {
            e.stopPropagation();
            e.preventDefault();
            // Toggle mode
            if (isHeadingUp) {
                isHeadingUp = false; // Disable auto tracking to lock it in place
                document.getElementById('btn-recenter').classList.remove('active');
            } else {
                isHeadingUp = true; // Re-enable auto tracking
                document.getElementById('btn-recenter').classList.add('active');
                if (userHeading) map.setBearing(360 - userHeading);
            }
        }
    }, true); // capture phase

    const courseSelector = document.getElementById('course-selector');
    const holeSelector = document.getElementById('hole-selector');

    courseSelector.addEventListener('change', async () => {
        await loadCourse(courseSelector.value);
    });

    holeSelector.addEventListener('change', () => {
        displayHole(holeSelector.value);
    });

    // --- SCORECARD UI LISTENERS ---

    // FAB Record Shot
    document.getElementById('btn-record-shot').addEventListener('click', () => {
        showShotModal(scorecard.currentShotNum);
    });

    // Club selection using Event Delegation (since buttons are dynamically generated)
    document.getElementById('club-grid-container').addEventListener('click', (e) => {
        if (e.target.classList.contains('club-btn')) {
            document.querySelectorAll('#club-grid-container .club-btn').forEach(b => b.classList.remove('selected'));
            e.target.classList.add('selected');
            tempShotData.club = e.target.dataset.club;
        }
    });

    // Penalty selection (Toggle state autonomously)
    document.querySelectorAll('.penalty-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const thisPenalty = e.target.dataset.penalty;
            if (tempShotData.penalties.includes(thisPenalty)) {
                // Deselect
                tempShotData.penalties = tempShotData.penalties.filter(p => p !== thisPenalty);
                e.target.classList.remove('selected');
            } else {
                // Select
                tempShotData.penalties.push(thisPenalty);
                e.target.classList.add('selected');
            }
        });
    });

    // Score Stepper
    document.getElementById('btn-shot-score-plus').addEventListener('click', () => {
        tempShotData.score = Math.min(100, tempShotData.score + 10);
        document.getElementById('shot-score-val').innerText = tempShotData.score;
    });
    document.getElementById('btn-shot-score-minus').addEventListener('click', () => {
        tempShotData.score = Math.max(0, tempShotData.score - 10);
        document.getElementById('shot-score-val').innerText = tempShotData.score;
    });

    // Memo Input
    document.getElementById('shot-memo-input').addEventListener('input', (e) => {
        tempShotData.memo = e.target.value;
    });

    // Save & Cancel Shot
    document.getElementById('btn-save-shot').addEventListener('click', () => {
        if (!tempShotData.club) {
            alert("Please select a club.");
            return;
        }
        saveShotAndCloseModal();
    });

    document.getElementById('btn-cancel-shot').addEventListener('click', () => {
        document.getElementById('club-modal').classList.add('hidden');
    });

    // Shot Navigation
    document.getElementById('btn-shot-prev').addEventListener('click', () => {
        if (currentEditingShotNum > 1) {
            showShotModal(currentEditingShotNum - 1);
        }
    });
    document.getElementById('btn-shot-next').addEventListener('click', () => {
        if (currentEditingShotNum < scorecard.currentShotNum) {
            showShotModal(currentEditingShotNum + 1);
        }
    });

    // Hole Completion
    document.getElementById('btn-finish-hole').addEventListener('click', showHoleModal);

    document.getElementById('btn-putt-plus').addEventListener('click', () => updateStepper('putt-count', 1));
    document.getElementById('btn-putt-minus').addEventListener('click', () => updateStepper('putt-count', -1));
    document.getElementById('btn-pen-plus').addEventListener('click', () => updateStepper('pen-count', 1));
    document.getElementById('btn-pen-minus').addEventListener('click', () => updateStepper('pen-count', -1));

    document.getElementById('btn-cancel-hole').addEventListener('click', () => {
        document.getElementById('hole-modal').classList.add('hidden');
    });

    document.getElementById('btn-save-hole').addEventListener('click', finalizeHole);

    // Scorecard Summary
    document.getElementById('btn-round-finish').addEventListener('click', showScorecardModal);

    document.getElementById('btn-close-scorecard').addEventListener('click', () => {
        document.getElementById('scorecard-modal').classList.add('hidden');
    });

    document.getElementById('btn-save-round').addEventListener('click', () => {
        const rows = document.querySelectorAll('.score-table tbody tr');
        rows.forEach(row => {
            const hNumStr = row.getAttribute('data-hole');
            if (hNumStr) {
                const hNum = parseInt(hNumStr, 10);
                const editScore = parseInt(row.querySelector('.edit-score').value, 10);
                const editPutts = parseInt(row.querySelector('.edit-putts').value, 10);
                const editPens = parseInt(row.querySelector('.edit-pens').value, 10);

                if (scorecard.roundData.holes[hNum]) {
                    scorecard.roundData.holes[hNum].hole_score = editScore;
                    scorecard.roundData.holes[hNum].putts = editPutts;
                    scorecard.roundData.holes[hNum].penalties = editPens;
                }
            }
        });

        scorecard.saveRoundData();
        const courseSelect = document.getElementById('course-selector');
        const courseName = courseSelect.options[courseSelect.selectedIndex].text;
        scorecard.saveRoundToHistory(courseName);

        document.getElementById('scorecard-modal').classList.add('hidden');
        alert("Round results saved successfully to your history!");
        updateScoreUI();
    });

    document.getElementById('btn-export-ai').addEventListener('click', () => {
        const text = scorecard.generateExportText();
        navigator.clipboard.writeText(text).then(() => {
            alert("Scorecard copied to clipboard! Paste into ChatGPT/Gemini.");
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            alert("Failed to copy. See console.");
        });
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

    // Auto-start GPS tracking (Play Mode default behavior)
    if (!isTracking) {
        // We delay tracking a tiny bit so the map and course load fully first
        setTimeout(() => toggleTracking(), 500);
    }
}

// --- SCORECARD UI LOGIC ---

function showShotModal(shotNum) {
    // Allows testing/viewing modal indoors without GPS.

    currentEditingShotNum = shotNum;
    const holeData = scorecard.getHoleData();
    const existingShot = holeData ? holeData.shots.find(s => s.shot_num === shotNum) : null;

    let baseClub = null;
    let parsedPenalties = [];
    if (existingShot && existingShot.club) {
        let clubStr = existingShot.club;
        if (clubStr.includes('(')) {
            const parts = clubStr.split('(');
            baseClub = parts[0].trim();
            const penStr = parts[1].replace(')', '');
            parsedPenalties = penStr.split(',').map(s => s.trim());
        } else if (clubStr === 'OB' || clubStr === 'Penalty' || clubStr === 'Pena') {
            parsedPenalties = [clubStr];
        } else {
            baseClub = clubStr;
        }
    }

    // Reset/Load temp data
    tempShotData = {
        club: baseClub,
        penalties: parsedPenalties,
        score: existingShot ? existingShot.score : 50,
        memo: existingShot ? existingShot.memo : ''
    };

    // Update UI
    document.getElementById('shot-number-display').innerText = shotNum;
    document.getElementById('shot-score-val').innerText = tempShotData.score;
    document.getElementById('shot-memo-input').value = tempShotData.memo || '';

    // Update Club Selection UI
    document.querySelectorAll('.club-btn').forEach(b => {
        if (b.dataset.club === tempShotData.club) {
            b.classList.add('selected');
        } else {
            b.classList.remove('selected');
        }
    });

    // Update Penalty Selection UI
    document.querySelectorAll('.penalty-btn').forEach(b => {
        if (tempShotData.penalties.includes(b.dataset.penalty)) {
            b.classList.add('selected');
        } else {
            b.classList.remove('selected');
        }
    });

    // Navigation arrows visibility
    document.getElementById('btn-shot-prev').style.visibility = (shotNum > 1) ? 'visible' : 'hidden';
    document.getElementById('btn-shot-next').style.visibility = (shotNum < scorecard.currentShotNum && existingShot) ? 'visible' : 'hidden';

    document.getElementById('club-modal').classList.remove('hidden');
}

function saveShotAndCloseModal() {
    if (!lastPos && currentEditingShotNum === scorecard.currentShotNum) return;

    // For new shots, use current GPS. For old shots, pass null (scorecard.js handles not overwriting coords)
    const userCoords = (currentEditingShotNum === scorecard.currentShotNum) ? [lastPos.lng, lastPos.lat] : null;

    // Auto-calculate distance for the previous shot if exists and we are recording a NEW shot
    if (currentEditingShotNum === scorecard.currentShotNum && scorecard.currentShotNum > 1) {
        const holeData = scorecard.getHoleData();
        const prevShotIndex = scorecard.currentShotNum - 2;
        if (holeData && holeData.shots[prevShotIndex] && !holeData.shots[prevShotIndex].end_coords) {
            const prevCoords = holeData.shots[prevShotIndex].start_coords;
            const distMeters = haversineMeters(prevCoords, userCoords);
            const distYards = metersToYardsRounded(distMeters);
            scorecard.updatePreviousShotDistance(distYards, prevShotIndex);
        }
    }

    let finalClubStr = tempShotData.club || "";
    if (tempShotData.penalties.length > 0) {
        if (finalClubStr) {
            finalClubStr += ` (${tempShotData.penalties.join(', ')})`;
        } else {
            finalClubStr = tempShotData.penalties.join(', ');
        }
    }

    // Save shot
    scorecard.saveShot(
        currentEditingShotNum,
        finalClubStr,
        tempShotData.score,
        tempShotData.memo,
        userCoords
    );

    document.getElementById('club-modal').classList.add('hidden');

    drawShotTracks();
    updateScoreUI();
}

function drawShotTracks() {
    shotLayers.clearLayers();
    const holeData = scorecard.getHoleData();
    if (!holeData || !holeData.shots || holeData.shots.length === 0) return;

    let points = [];

    holeData.shots.forEach((shot, index) => {
        const latlng = [shot.start_coords[1], shot.start_coords[0]];
        points.push(latlng);

        let label = `${shot.shot_num}`;
        let popupText = `Shot ${shot.shot_num}: ${shot.club}`;
        if (shot.distance_yd) popupText += `<br>Distance: ${shot.distance_yd} yd`;
        if (shot.score !== undefined) popupText += `<br>Quality: ${shot.score}/100`;
        if (shot.memo) popupText += `<br>Memo: ${shot.memo}`;

        L.marker(latlng, {
            icon: L.divIcon({
                className: 'shot-marker',
                html: label,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).bindPopup(popupText).addTo(shotLayers);
    });

    if (points.length > 1) {
        L.polyline(points, {
            color: '#2196F3',
            weight: 3,
            dashArray: '4, 6',
            opacity: 0.7
        }).addTo(shotLayers);
    }
}

function updateScoreUI() {
    // Score summary is no longer displayed on the main UI
    // It is shown inside the full Scorecard Modal when the 'Round finish' button is pressed.
}

function showHoleModal() {
    document.getElementById('hole-modal-num').innerText = scorecard.currentHole;

    // Auto-calculate putts, penalties, and memo from shots
    const holeData = scorecard.getHoleData();
    let autoPutts = 0;
    let autoPens = 0;
    let aggregatedMemo = [];

    if (holeData && holeData.shots) {
        holeData.shots.forEach(s => {
            if (s.club) {
                if (s.club.includes('PT')) autoPutts++;
                if (s.club.includes('OB')) autoPens++;
                if (s.club.includes('Penalty') || s.club.includes('Pena')) autoPens++;
            }
            if (s.memo) aggregatedMemo.push(`[S${s.shot_num}] ${s.memo}`);
        });
    }

    document.getElementById('putt-count').innerText = autoPutts.toString();
    document.getElementById('pen-count').innerText = autoPens.toString();
    document.getElementById('hole-memo').value = aggregatedMemo.join('\n');

    document.getElementById('hole-modal').classList.remove('hidden');
}

function updateStepper(id, change) {
    const el = document.getElementById(id);
    let val = parseInt(el.innerText, 10);
    val += change;
    if (val < 0) val = 0;
    el.innerText = val;
}

function finalizeHole() {
    const putts = parseInt(document.getElementById('putt-count').innerText, 10);
    const pens = parseInt(document.getElementById('pen-count').innerText, 10);
    const memo = document.getElementById('hole-memo').value;

    scorecard.finishHole(putts, pens, memo);
    document.getElementById('hole-modal').classList.add('hidden');

    // Auto advance to next hole if possible
    const currentHoleNum = parseInt(scorecard.currentHole, 10);
    const holeSelector = document.getElementById('hole-selector');

    if (currentHoleNum < 18) {
        const nextHoleStr = (currentHoleNum + 1).toString();
        // check if next hole exists in selector
        const options = Array.from(holeSelector.options).map(o => o.value);
        if (options.includes(nextHoleStr)) {
            holeSelector.value = nextHoleStr;
            // trigger change event to reload map and UI
            holeSelector.dispatchEvent(new Event('change'));
        }
    }
}

function showScorecardModal(historyRoundData = null) {
    // If an Event object is passed from an EventListener (like a click), it won't be a valid roundData object
    const rd = (historyRoundData && !historyRoundData.type) ? historyRoundData : scorecard.roundData;
    const isReadonly = (historyRoundData && !historyRoundData.type);

    const body = document.getElementById('scorecard-body');

    document.getElementById('btn-save-round').style.display = isReadonly ? 'none' : 'block';

    let html = `
        <table class="score-table">
            <thead>
                <tr>
                    <th>Hole</th><th>Par</th><th>Score</th><th>Putts</th><th>Pena</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (let i = 1; i <= 18; i++) {
        const h = rd.holes[i];
        if (h && h.hole_score > 0) {
            html += `
                <tr data-hole="${i}">
                    <td>${i}</td>
                    <td>${h.par}</td>
                    <td><input type="number" class="edit-score" value="${h.hole_score}" min="1" max="20" style="width: 45px; text-align: center; border: 1px solid #ccc; border-radius: 4px; padding: 4px;" ${isReadonly ? 'disabled' : ''}></td>
                    <td><input type="number" class="edit-putts" value="${h.putts}" min="0" max="10" style="width: 40px; text-align: center; border: 1px solid #ccc; border-radius: 4px; padding: 4px;" ${isReadonly ? 'disabled' : ''}></td>
                    <td><input type="number" class="edit-pens" value="${h.penalties}" min="0" max="10" style="width: 40px; text-align: center; border: 1px solid #ccc; border-radius: 4px; padding: 4px;" ${isReadonly ? 'disabled' : ''}></td>
                </tr>
            `;
        }
    }

    html += `
            </tbody>
        </table>
        <div style="margin-top: 15px; text-align: center;">
            <strong>Total Score: ${rd.summary.total_score}</strong><br>
            (Putts: ${rd.summary.total_putts} | Pen: ${rd.summary.total_penalties})
        </div>
    `;

    body.innerHTML = html;
    document.getElementById('scorecard-modal').classList.remove('hidden');
}

// --- REST OF APP LOGIC ---

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

    let holePar = 4; // Default
    if (holeFeatures.length > 0 && holeFeatures[0].properties.par) {
        holePar = holeFeatures[0].properties.par;
    }

    // Set score state
    scorecard.setHole(holeNumber, holePar);
    document.getElementById('ui-current-hole').innerText = holeNumber;
    document.getElementById('ui-current-par').innerText = holePar;
    document.getElementById('hole-status').style.display = 'flex';
    document.getElementById('score-summary-bar').style.display = 'flex';
    document.getElementById('btn-record-shot').style.display = 'flex';
    document.getElementById('edit-controls').style.display = 'flex';
    updateScoreUI();
    drawShotTracks(); // Load past shots for this hole

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
                        feature.geometry.coordinates = [newPos.lng, newPos.lat];
                        holeTargets[kind] = [newPos.lng, newPos.lat];
                        saveCourseData();
                        if (lastPos) updateLocationUI(lastPos);
                    });

                    return marker;
                } else {
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

            return L.circleMarker(latlng);
        }
    });

    currentHoleLayers.addLayer(geoJsonLayer);

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
    const fabShot = document.getElementById('btn-record-shot');

    if (tracker) {
        // STOP
        tracker.stop();
        tracker = null;
        if (btn) btn.innerText = "Start Location Tracking";
        fabShot.style.display = 'none';
        updateGpsStatus('disconnected', 'Tracking stopped');
    } else {
        // START
        if (btn) {
            btn.innerText = "Stop Location Tracking";
        }
        fabShot.style.display = 'flex';

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
        const cone = document.getElementById('user-heading-cone');
        if (cone) {
            cone.style.transform = `rotate(${userHeading}deg)`;
        }
    }

    // Update tap lines
    if (tapLine) {
        tapLine.setLatLngs([latlng, tapLine.getLatLngs()[1]]);
        if (tapLineB && holeTargets['green_center']) {
            const tapCoords = [tapLine.getLatLngs()[1].lng, tapLine.getLatLngs()[1].lat];
            const pinCoords = holeTargets['green_center'];
            const yardsA = metersToYardsRounded(haversineMeters(userCoords, tapCoords));
            const yardsB = metersToYardsRounded(haversineMeters(tapCoords, pinCoords));
            tapMarker.getTooltip().setContent(`
                <div class="tap-distance-label">User→Tap: ${yardsA} yd</div>
                <div class="tap-distance-label segment-b">Tap→Pin: ${yardsB} yd</div>
            `);
        }
    }

    if (isFirstFix) {
        map.setView(latlng, 17);
        isFirstFix = false;
    }

    // 2. Calculate Distances and Show Green Mode
    const distMap = {
        'green_center': 'dist-green-center',
        'green_front': 'dist-green-front',
        'green_back': 'dist-green-back',
        'hazard_front': 'dist-hazard-front',
        'hazard_back': 'dist-hazard-back',
    };

    const accuracyPrefix = pos.accuracy > 20 ? '± ' : '';
    let distToGreen = null;

    for (const [kind, elemId] of Object.entries(distMap)) {
        const el = document.getElementById(elemId);
        if (el) {
            if (holeTargets[kind]) {
                const targetCoords = holeTargets[kind];
                const meters = haversineMeters(userCoords, targetCoords);
                const yards = metersToYardsRounded(meters);
                el.innerText = `${accuracyPrefix}${yards} yd`;
                if (kind === 'green_center') distToGreen = yards;
            } else {
                el.innerText = "-- yd";
            }
        }
    }

    // Show score bar when tracking is active.
    const scoreBar = document.getElementById('score-summary-bar');
    scoreBar.style.display = 'flex';

    // 3. Update Status
    updateGpsStatus('connected', `GPS: ±${Math.round(pos.accuracy)}m`);
}

// Orientation / Compass handling
function initCompass() {
    if (window.DeviceOrientationEvent) {
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
    let compass = event.webkitCompassHeading || event.alpha;
    if (compass !== null && compass !== undefined) {
        userHeading = compass;
        if (isHeadingUp && map) {
            map.setBearing(360 - compass);
        }
        const cone = document.getElementById('user-heading-cone');
        if (cone) {
            if (isHeadingUp) {
                cone.style.transform = `rotate(0deg)`;
            } else {
                cone.style.transform = `rotate(${userHeading}deg)`;
            }
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
    document.getElementById('btn-record-shot').style.display = 'none';
    document.getElementById('score-summary-bar').style.display = 'none';
    tracker = null;
}

// --- SETTINGS LOGIC ---
const STANDARD_CLUBS = ['1W', '3W', '5W', '7W', '3U', '4U', '5U', '5I', '6I', '7I', '8I', '9I', 'PW', 'AW', 'SW', 'PT'];
const DEFAULT_CLUBS = ['1W', '3W', '5U', '6I', '7I', '8I', '9I', 'PW', 'AW', 'SW', 'PT'];

function getSavedClubs() {
    const saved = localStorage.getItem('golf-pwa-clubs');
    return saved ? JSON.parse(saved) : DEFAULT_CLUBS;
}

function saveClubs(clubsArray) {
    localStorage.setItem('golf-pwa-clubs', JSON.stringify(clubsArray));
    renderClubSelector(); // Update the shot modal UI
}

window.renderSettingsUI = function () {
    const grid = document.getElementById('settings-club-grid');
    const selectedClubs = getSavedClubs();
    grid.innerHTML = '';

    STANDARD_CLUBS.forEach(club => {
        const isSelected = selectedClubs.includes(club);
        const btn = document.createElement('button');
        btn.className = `club-btn ${isSelected ? 'selected' : ''}`;
        btn.innerText = club;
        btn.dataset.club = club;
        btn.onclick = () => btn.classList.toggle('selected');
        grid.appendChild(btn);
    });
};

document.getElementById('btn-save-settings').addEventListener('click', () => {
    const grid = document.getElementById('settings-club-grid');
    const selectedBtns = grid.querySelectorAll('.club-btn.selected');
    const newClubs = Array.from(selectedBtns).map(btn => btn.dataset.club);

    // Sort them according to STANDARD_CLUBS order
    newClubs.sort((a, b) => STANDARD_CLUBS.indexOf(a) - STANDARD_CLUBS.indexOf(b));

    saveClubs(newClubs);
    alert('Settings saved!');
});

function renderClubSelector() {
    const container = document.getElementById('club-grid-container');
    const clubs = getSavedClubs();
    if (container) {
        container.innerHTML = '';
        clubs.forEach(club => {
            const btn = document.createElement('button');
            btn.className = 'club-btn';
            btn.dataset.club = club;
            btn.innerText = club;
            container.appendChild(btn);
        });
    }
}

function updateGpsStatus(state, msg) {
    const el = document.getElementById('gps-status');
    el.innerHTML = `<span class="dot ${state}"></span> ${msg}`;
}

window.renderHistoryList = function () {
    const listEl = document.getElementById('history-list');
    const bestEl = document.getElementById('stat-best-score');
    const avgEl = document.getElementById('stat-avg-score');

    bestEl.innerText = scorecard.getBestScore();
    avgEl.innerText = scorecard.getAverageScore();

    const history = scorecard.getHistory();
    listEl.innerHTML = '';

    if (history.length === 0) {
        listEl.innerHTML = '<li style="text-align: center; margin-top: 50px; color: #999;">No saved rounds yet. Go play!</li>';
        return;
    }

    history.forEach(round => {
        const d = new Date(round.date);
        const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const li = document.createElement('li');
        li.className = 'history-item';

        const infoDiv = document.createElement('div');
        infoDiv.innerHTML = `
            <div class="history-date">${dateStr}</div>
            <div class="history-course">${round.course_name || 'Golf Course'}</div>
        `;

        const scoreDiv = document.createElement('div');
        scoreDiv.className = 'history-score';
        scoreDiv.innerText = round.summary.total_score || '--';

        li.appendChild(infoDiv);
        li.appendChild(scoreDiv);

        li.addEventListener('click', () => {
            showScorecardModal(round);
        });

        listEl.appendChild(li);
    });
};

// Boot up
document.addEventListener('DOMContentLoaded', init);
