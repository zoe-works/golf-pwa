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

const APP_VERSION = '1.1.0';

async function init() {
    // 1. Initialize Leaflet Map with Rotation
    map = L.map('map', {
        zoomControl: false,
        rotate: true,
        touchRotate: true,
        rotateControl: false,
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
                if (!tracker) toggleTracking();
            } else if (targetId === 'view-history') {
                if (typeof window.renderHistoryList === 'function') window.renderHistoryList();
            } else if (targetId === 'view-settings') {
                document.getElementById('settings-menu').classList.remove('hidden');
                document.getElementById('settings-clubs-page').classList.add('hidden');
                document.getElementById('settings-groups-page').classList.add('hidden');
                if (typeof window.renderSettingsUI === 'function') {
                    window.renderSettingsUI();
                    if (typeof renderCompanionGroupsList === 'function') renderCompanionGroupsList();
                }
            }
        });
    });

    // Settings Sub-menu Navigation
    document.getElementById('btn-menu-clubs')?.addEventListener('click', () => {
        document.getElementById('settings-menu').classList.add('hidden');
        document.getElementById('settings-clubs-page').classList.remove('hidden');
    });
    document.getElementById('btn-menu-groups')?.addEventListener('click', () => {
        document.getElementById('settings-menu').classList.add('hidden');
        document.getElementById('settings-groups-page').classList.remove('hidden');
    });
    document.getElementById('btn-back-clubs')?.addEventListener('click', () => {
        document.getElementById('settings-clubs-page').classList.add('hidden');
        document.getElementById('settings-menu').classList.remove('hidden');
    });
    document.getElementById('btn-back-groups')?.addEventListener('click', () => {
        document.getElementById('settings-groups-page').classList.add('hidden');
        document.getElementById('settings-menu').classList.remove('hidden');
    });

    const recenterBtn = document.getElementById('btn-recenter');
    const compassBtn = document.getElementById('btn-compass');

    recenterBtn.addEventListener('click', () => {
        // Essential for iOS: Request permission on user gesture
        initCompass();

        // Toggle mode
        if (isHeadingUp) {
            isHeadingUp = false;
        } else {
            isHeadingUp = true;
            // Bearing logic removed per user request (Fixed Orientation)
        }
        updateCompassUI();

        // Also recenter if position is available
        if (lastPos) {
            map.setView([lastPos.lat, lastPos.lng], 17);
        } else if (!tracker) {
            toggleTracking();
        }
    });

    // (btn-compass listener removed as it was integrated into btn-recenter)

    function updateCompassUI() {
        if (isHeadingUp) {
            recenterBtn.classList.add('active');
            recenterBtn.classList.remove('is-fixed');
        } else {
            recenterBtn.classList.remove('active');
            recenterBtn.classList.add('is-fixed');
            map.setBearing(0);
        }
    }

    // Initialize UI
    updateCompassUI();

    // Explicitly hide round UI on start (it will be shown by restoration logic later if needed)
    document.getElementById('hole-status').style.display = 'none';
    document.getElementById('hole-selector').style.display = 'none';
    document.getElementById('btn-record-shot').style.display = 'none';
    document.getElementById('edit-controls').style.display = 'flex';

    // Disable auto-recentering if user manually interacts with the map
    map.on('dragstart zoomstart rotatestart', () => {
        if (isHeadingUp) {
            isHeadingUp = false;
            updateCompassUI();
        }
    });

    const holeSelector = document.getElementById('hole-selector');

    document.getElementById('btn-start-round').addEventListener('click', () => {
        // Essential for iOS: Request permission on user gesture
        initCompass();
        if (!tracker) toggleTracking();

        openStartRoundModal();
    });

    holeSelector.addEventListener('change', () => {
        displayHole(holeSelector.value);
    });

    // --- START ROUND UI MODAL ---

    function populateHalfSelectors(courseUrl) {
        const firstHalf = document.getElementById('modal-first-half');
        const secondHalf = document.getElementById('modal-second-half');
        firstHalf.innerHTML = '';
        secondHalf.innerHTML = '';

        if (courseUrl.includes('bangsai')) {
            // 27 holes
            const opts = [
                { val: 'A', text: 'Course A' },
                { val: 'B', text: 'Course B' },
                { val: 'C', text: 'Course C' }
            ];
            opts.forEach(opt => {
                const optEl1 = document.createElement('option');
                optEl1.value = opt.val;
                optEl1.innerText = opt.text;
                firstHalf.appendChild(optEl1);

                const optEl2 = document.createElement('option');
                optEl2.value = opt.val;
                optEl2.innerText = opt.text;
                secondHalf.appendChild(optEl2);
            });
            firstHalf.value = 'A';
            secondHalf.value = 'B';
        } else if (courseUrl.includes('lakewood')) {
            const opts = [
                { val: 'LAKE', text: 'LAKE Course' },
                { val: 'WOOD', text: 'WOOD Course' },
                { val: 'ROCK', text: 'ROCK Course' }
            ];
            opts.forEach(opt => {
                const optEl1 = document.createElement('option');
                optEl1.value = opt.val;
                optEl1.innerText = opt.text;
                firstHalf.appendChild(optEl1);

                const optEl2 = document.createElement('option');
                optEl2.value = opt.val;
                optEl2.innerText = opt.text;
                secondHalf.appendChild(optEl2);
            });
            firstHalf.value = 'LAKE';
            secondHalf.value = 'WOOD';
        } else {
            // Standard 18 holes
            const opts = [
                { val: 'OUT', text: 'OUT (Holes 1-9)' },
                { val: 'IN', text: 'IN (Holes 10-18)' }
            ];
            opts.forEach(opt => {
                const optEl1 = document.createElement('option');
                optEl1.value = opt.val;
                optEl1.innerText = opt.text;
                firstHalf.appendChild(optEl1);

                const optEl2 = document.createElement('option');
                optEl2.value = opt.val;
                optEl2.innerText = opt.text;
                secondHalf.appendChild(optEl2);
            });
            firstHalf.value = 'OUT';
            secondHalf.value = 'IN';
        }
    }

    async function openStartRoundModal() {
        const startBtn = document.getElementById('btn-start-round');

        // If round is already in progress, ask to cancel
        if (startBtn.classList.contains('in-round')) {
            if (confirm("Cancel this round? Unsaved data will be lost.")) {
                // Reset UI to default state
                startBtn.innerText = 'Start Round';
                startBtn.classList.remove('in-round');

                document.getElementById('hole-status').style.display = 'none';
                document.getElementById('btn-record-shot').style.display = 'none';

                // Clear UI hole info
                document.getElementById('ui-current-hole').innerText = '-';
                document.getElementById('ui-current-par').innerText = '-';

                // Reset hole selector
                const hs = document.getElementById('hole-selector');
                hs.innerHTML = '';
                hs.value = '';
                hs.style.display = 'none';

                // Clear distance display
                holeTargets = {};
                currentHoleLayers.clearLayers();
                ['dist-green-center', 'dist-green-front', 'dist-green-back', 'dist-hazard-front', 'dist-hazard-back'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.innerText = '-- yd';
                });

                // CRITICAL: Clear internal state and storage
                scorecard.roundData = scorecard.createNewRound();
                localStorage.removeItem('golf_pwa_round_data');

                alert("Round has been cancelled.");
            }
            return; // Don't open the start modal
        }

        // Request permissions if not already active
        if (!tracker) {
            toggleTracking();
        }

        const modalSelect = document.getElementById('modal-course-select');

        // Auto-select based on lastPos if available
        if (lastPos) {
            const nearest = findNearestCourse(lastPos.lat, lastPos.lng);
            if (nearest) {
                modalSelect.value = nearest;
            }
        }

        populateHalfSelectors(modalSelect.value);

        // Populate Companion Groups
        const compSelect = document.getElementById('modal-companion-group');
        compSelect.innerHTML = '<option value="">-- Select Group --</option>';
        const groups = getCompanionGroups();
        groups.forEach((g, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.innerText = g.name;
            compSelect.appendChild(opt);
        });
        document.getElementById('start-player-1').value = '';
        document.getElementById('start-player-2').value = '';
        document.getElementById('start-player-3').value = '';
        document.getElementById('start-player-4').value = '';
        document.getElementById('start-player-5').value = '';

        const startRadio = document.querySelector('input[name="start-me"][value="0"]');
        if (startRadio) startRadio.checked = true;

        document.getElementById('start-round-modal').classList.remove('hidden');
    }

    document.getElementById('modal-companion-group').addEventListener('change', (e) => {
        const val = e.target.value;
        const p1 = document.getElementById('start-player-1');
        const p2 = document.getElementById('start-player-2');
        const p3 = document.getElementById('start-player-3');
        const p4 = document.getElementById('start-player-4');
        const p5 = document.getElementById('start-player-5');
        p1.value = ''; p2.value = ''; p3.value = ''; p4.value = ''; p5.value = '';

        if (val !== '') {
            const groups = getCompanionGroups();
            const group = groups[val];
            if (group) {
                if (group.players[0]) p1.value = group.players[0];
                if (group.players[1]) p2.value = group.players[1];
                if (group.players[2]) p3.value = group.players[2];
                if (group.players[3]) p4.value = group.players[3];
                if (group.players[4]) p5.value = group.players[4];

                // Set radio button to the group's main player, mapped by their index
                const startMeRadio = document.querySelector(`input[name="start-me"][value="${group.mainPlayerIndex || 0}"]`);
                if (startMeRadio) startMeRadio.checked = true;
            }
        }
    });

    document.getElementById('modal-course-select').addEventListener('change', (e) => {
        populateHalfSelectors(e.target.value);
    });

    document.getElementById('modal-first-half').addEventListener('change', (e) => {
        const first = e.target.value;
        const secondHalf = document.getElementById('modal-second-half');

        // Automatic assignment mapping to minimize user input
        const autoMap = {
            'OUT': 'IN',
            'IN': 'OUT',
            'A': 'B',
            'B': 'C',
            'C': 'A',
            'LAKE': 'WOOD',
            'WOOD': 'ROCK',
            'ROCK': 'LAKE'
        };

        if (autoMap[first]) {
            secondHalf.value = autoMap[first];
        }
    });

    document.getElementById('btn-cancel-start').addEventListener('click', () => {
        document.getElementById('start-round-modal').classList.add('hidden');
    });

    document.getElementById('btn-confirm-start').addEventListener('click', async () => {
        const courseUrl = document.getElementById('modal-course-select').value;
        const firstHalf = document.getElementById('modal-first-half').value;
        const secondHalf = document.getElementById('modal-second-half').value;

        // Build sequence
        let sequence = [];
        if (courseUrl.includes('bangsai') || courseUrl.includes('lakewood')) {
            for (let i = 1; i <= 9; i++) sequence.push(`${firstHalf}-${i}`);
            for (let i = 1; i <= 9; i++) sequence.push(`${secondHalf}-${i}`);
        } else {
            const addOut = () => { for (let i = 1; i <= 9; i++) sequence.push(i); };
            const addIn = () => { for (let i = 10; i <= 18; i++) sequence.push(i); };

            if (firstHalf === 'OUT') addOut(); else addIn();
            if (secondHalf === 'OUT') addOut(); else addIn();
        }

        const startBtn = document.getElementById('btn-start-round');
        startBtn.innerText = 'Round In Progress';
        startBtn.classList.add('in-round');

        await loadCourse(courseUrl, sequence);

        const courseName = document.getElementById('modal-course-select').options[document.getElementById('modal-course-select').selectedIndex].text;

        // Collect companions
        const p1 = document.getElementById('start-player-1').value.trim();
        const p2 = document.getElementById('start-player-2').value.trim();
        const p3 = document.getElementById('start-player-3').value.trim();
        const p4 = document.getElementById('start-player-4').value.trim();
        const p5 = document.getElementById('start-player-5').value.trim();

        const startPlayerRadio = document.querySelector('input[name="start-me"]:checked');
        const meIndex = startPlayerRadio ? parseInt(startPlayerRadio.value, 10) : -1;

        const allCompanions = [p1, p2, p3, p4, p5];
        const companions = allCompanions.filter((p, i) => p !== '' && i !== meIndex);

        scorecard.startNewRound(courseName, sequence, companions);

        // Ensure club selector is ready for the new round
        renderClubSelector();

        const holeSelector = document.getElementById('hole-selector');
        holeSelector.style.display = 'block';
        holeSelector.value = sequence[0];
        displayHole(sequence[0]);

        document.getElementById('start-round-modal').classList.add('hidden');
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

    // Penalty selection (Mutually Exclusive / Radio style)
    document.querySelectorAll('.penalty-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const thisPenalty = e.currentTarget.dataset.penalty;

            if (tempShotData.penalties.includes(thisPenalty)) {
                // Deselect
                tempShotData.penalties = [];
            } else {
                // Select (Clear others first)
                tempShotData.penalties = [thisPenalty];
            }

            // Update UI for all penalty buttons
            document.querySelectorAll('.penalty-btn').forEach(b => {
                if (tempShotData.penalties.includes(b.dataset.penalty)) {
                    b.classList.add('selected');
                } else {
                    b.classList.remove('selected');
                }
            });
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
        const hasClub = !!tempShotData.club;
        const hasPenalty = tempShotData.penalties && tempShotData.penalties.length > 0;

        if (!hasClub && !hasPenalty) {
            alert("Please select a club or penalty.");
            return;
        }
        saveShotAndCloseModal();
    });

    document.getElementById('btn-cancel-shot').addEventListener('click', () => {
        document.getElementById('club-modal').classList.add('hidden');
    });

    // Helper to decide if we should auto-save on navigation
    function shouldAutoSaveCurrentShot() {
        const hasClub = !!tempShotData.club;
        const hasPenalty = tempShotData.penalties && tempShotData.penalties.length > 0;
        const hd = scorecard.getHoleData();
        const isExistingShot = hd && hd.shots && hd.shots.find(s => s.shot_num === currentEditingShotNum);
        return hasClub || hasPenalty || isExistingShot;
    }

    // Shot Navigation
    document.getElementById('btn-shot-prev').addEventListener('click', () => {
        if (currentEditingShotNum > 1) {
            if (shouldAutoSaveCurrentShot()) {
                saveCurrentTempShot(); // Auto-save before moving
            }
            showShotModal(currentEditingShotNum - 1);
        }
    });
    document.getElementById('btn-shot-next').addEventListener('click', () => {
        // Can move to next shot if it exists OR if we are on the current latest shot 
        // (to implicitly create or just view the next "potential" shot)
        if (shouldAutoSaveCurrentShot()) {
            saveCurrentTempShot(); // Auto-save before moving
        }
        showShotModal(currentEditingShotNum + 1);
    });

    // Hole Completion
    document.getElementById('btn-finish-hole').addEventListener('click', showHoleModal);

    document.getElementById('btn-score-plus').addEventListener('click', () => updateStepper('hole-score-count', 1));
    document.getElementById('btn-score-minus').addEventListener('click', () => updateStepper('hole-score-count', -1));
    document.getElementById('btn-putt-plus').addEventListener('click', () => {
        updateStepper('putt-count', 1);
        updateStepper('hole-score-count', 1);
    });
    document.getElementById('btn-putt-minus').addEventListener('click', () => {
        const el = document.getElementById('putt-count');
        if (parseInt(el.innerText, 10) > 0) {
            updateStepper('putt-count', -1);
            updateStepper('hole-score-count', -1);
        }
    });
    document.getElementById('btn-pen-plus').addEventListener('click', () => {
        updateStepper('pen-count', 1);
        updateStepper('hole-score-count', 1);
    });
    document.getElementById('btn-pen-minus').addEventListener('click', () => {
        const el = document.getElementById('pen-count');
        if (parseInt(el.innerText, 10) > 0) {
            updateStepper('pen-count', -1);
            updateStepper('hole-score-count', -1);
        }
    });

    document.getElementById('btn-cancel-hole').addEventListener('click', () => {
        document.getElementById('hole-modal').classList.add('hidden');
    });

    document.getElementById('btn-save-hole').addEventListener('click', finalizeHole);

    // Scorecard Summary
    document.getElementById('btn-close-scorecard').addEventListener('click', () => {
        document.getElementById('scorecard-modal').classList.add('hidden');
    });

    // Save Round logic moved to showScorecardModal's internal onclick handler to prevent duplicate event triggers
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
                    alert("Data imported and saved!");

                    // Reload current hole
                    if (holeSelector.value) {
                        displayHole(holeSelector.value);
                    }
                } else {
                    alert("Invalid data format.");
                }
            } catch (error) {
                console.error("Error parsing imported JSON:", error);
                alert("Failed to read file.");
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
        if (confirm("Reset to default map data? Local edits will be lost.")) {
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

    // Initialize to default state (we won't auto-load course now since Start Round does it)
    if (!scorecard.roundData.holeSequence || scorecard.roundData.holeSequence.length === 0) {
        // Just load something so map isn't blank
        await loadCourse('data/prime_city.json');

        // Auto-start GPS tracking (Play Mode default behavior)
        if (!tracker) {
            setTimeout(() => toggleTracking(), 500);
        }
    } else {
        // If restoring an ongoing round...
        // Find which course JSON matches the stored course name
        let targetUrl = 'data/prime_city.json';
        for (const [url, meta] of Object.entries(COURSE_METADATA)) {
            if (scorecard.roundData.course_name && scorecard.roundData.course_name.includes(meta.name)) {
                targetUrl = url;
                break;
            }
        }
        const startBtn = document.getElementById('btn-start-round');
        startBtn.innerText = 'Round In Progress';
        startBtn.classList.add('in-round');
        document.getElementById('hole-selector').style.display = 'block';

        // Switch to Play view automatically if restoring
        document.querySelectorAll('.view-section').forEach(s => s.classList.add('hidden'));
        document.getElementById('view-play').classList.remove('hidden');
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-view="play"]').classList.add('active');

        await loadCourse(targetUrl, scorecard.roundData.holeSequence, scorecard.currentHole);

        // Draw existing shots for the current hole
        drawShotTracks();

        if (!tracker) {
            setTimeout(() => toggleTracking(), 500);
        }

        // Default to follow mode if restoring
        isHeadingUp = true;
        updateCompassUI();
    }

    // Ensure club selector is populated correctly at startup
    renderClubSelector();
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
    // Show Prev if not Shot 1
    if (shotNum > 1) {
        document.getElementById('btn-shot-prev').classList.remove('visibility-hidden');
    } else {
        document.getElementById('btn-shot-prev').classList.add('visibility-hidden');
    }

    // Show Next if we are not on the absolute latest "next" shot
    if (shotNum < scorecard.currentShotNum) {
        document.getElementById('btn-shot-next').classList.remove('visibility-hidden');
    } else {
        document.getElementById('btn-shot-next').classList.add('visibility-hidden');
    }

    document.getElementById('club-modal').classList.remove('hidden');
}

/**
 * Saves current tempShotData to the scorecard without closing the modal.
 */
function saveCurrentTempShot() {
    // For new shots, use current GPS if available. For old shots, pass null.
    const userCoords = (currentEditingShotNum === scorecard.currentShotNum && lastPos) ? [lastPos.lng, lastPos.lat] : null;

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

    // Calculate extra increment for penalties
    let extraIncrement = 0;
    const activePenaltyBtn = document.querySelector('.penalty-btn.selected');
    if (activePenaltyBtn) {
        extraIncrement = parseInt(activePenaltyBtn.dataset.increment) || 0;
    }

    // Save shot
    scorecard.saveShot(
        currentEditingShotNum,
        finalClubStr,
        tempShotData.score,
        tempShotData.memo,
        userCoords,
        extraIncrement
    );

    drawShotTracks();

    // Update live shot count on the main UI
    const hd = scorecard.getHoleData();
    const sc = hd && hd.shots ? hd.shots.length : 0;
    const shotCountEl = document.getElementById('ui-shot-count');
    if (shotCountEl) shotCountEl.innerText = sc;
}

function saveShotAndCloseModal() {
    saveCurrentTempShot();
    document.getElementById('club-modal').classList.add('hidden');
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

function showHoleModal() {
    document.getElementById('hole-modal-num').innerText = scorecard.currentHole;

    // Auto-calculate putts, penalties, and memo from shots
    const holeData = scorecard.getHoleData();
    let autoPutts = 0;
    let autoPens = 0;
    let aggregatedMemo = [];

    // Build shot details HTML
    const shotDetailsEl = document.getElementById('hole-shot-details');
    let shotHtml = '';

    if (holeData && holeData.shots && holeData.shots.length > 0) {
        shotHtml = '<div style="font-size: 13px; color: #555; border: 1px solid #eee; border-radius: 8px; padding: 8px;">';
        shotHtml += '<div style="font-weight: 600; margin-bottom: 6px; color: #333;">Shots Recorded:</div>';
        holeData.shots.forEach(s => {
            if (s.club) {
                // 'PT' shots are no longer auto-counted as putts per user request
                if (s.club.includes('Playing-4') || s.club.includes('OB-Forward')) {
                    autoPens += 2;
                } else if (s.club.includes('OB')) {
                    autoPens += 1;
                } else if (s.club.includes('Penalty') || s.club.includes('Pena')) {
                    autoPens += 1;
                }
            }
            if (s.memo) aggregatedMemo.push(`[S${s.shot_num}] ${s.memo}`);

            const clubLabel = s.club || '—';
            const memoLabel = s.memo ? ` · ${s.memo}` : '';
            shotHtml += `<div style="padding: 3px 0; border-bottom: 1px solid #f5f5f5;">
                <span style="font-weight: 600; color: #1e88e5;">S${s.shot_num}</span>
                <span style="margin-left: 6px;">${clubLabel}</span>
                <span style="color: #999;">${memoLabel}</span>
            </div>`;
        });
        shotHtml += '</div>';
    } else {
        shotHtml = '<div style="font-size: 13px; color: #999; text-align: center; padding: 8px;">No shots recorded for this hole.</div>';
    }
    shotDetailsEl.innerHTML = shotHtml;

    const autoScore = holeData ? holeData.shots.length + autoPutts + autoPens : 0;
    document.getElementById('hole-score-count').innerText = autoScore.toString();
    document.getElementById('putt-count').innerText = autoPutts.toString();
    document.getElementById('pen-count').innerText = autoPens.toString();
    document.getElementById('hole-memo').value = aggregatedMemo.join('\n');

    // Dynamic Companion Scores
    const compContainer = document.getElementById('companion-scores-container');
    compContainer.innerHTML = '';
    const companions = scorecard.roundData.companions || [];

    if (companions.length > 0) {
        companions.forEach((compName, idx) => {
            const compScore = (holeData && holeData.companionScores && holeData.companionScores[compName]) || 0;
            const html = `
                <div class="input-group">
                    <label>${compName} Score</label>
                    <div class="stepper">
                        <button type="button" class="stepper-btn comp-btn-minus" data-idx="${idx}">-</button>
                        <span id="comp-score-${idx}" class="stepper-val comp-score-val">${compScore}</span>
                        <button type="button" class="stepper-btn comp-btn-plus" data-idx="${idx}">+</button>
                    </div>
                </div>
            `;
            compContainer.innerHTML += html;
        });

        // Add event listeners for new companion steppers
        compContainer.querySelectorAll('.comp-btn-minus').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = e.target.dataset.idx;
                updateStepper(`comp-score-${idx}`, -1);
            });
        });
        compContainer.querySelectorAll('.comp-btn-plus').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = e.target.dataset.idx;
                updateStepper(`comp-score-${idx}`, 1);
            });
        });
    }

    // Update Save button text based on whether it's the last hole
    const holeSelector = document.getElementById('hole-selector');
    const options = Array.from(holeSelector.options).map(o => o.value);
    const currentIndex = options.indexOf(scorecard.currentHole.toString());
    const saveBtn = document.getElementById('btn-save-hole');

    if (currentIndex !== -1 && currentIndex === options.length - 1) {
        saveBtn.innerText = 'Round Finish';
    } else {
        saveBtn.innerText = 'Next hole';
    }

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
    const score = parseInt(document.getElementById('hole-score-count').innerText, 10);
    const putts = parseInt(document.getElementById('putt-count').innerText, 10);
    const pens = parseInt(document.getElementById('pen-count').innerText, 10);
    const memo = document.getElementById('hole-memo').value;

    // Collect companion scores
    const companions = scorecard.roundData.companions || [];
    const compScores = {};
    companions.forEach((compName, idx) => {
        const spanEl = document.getElementById(`comp-score-${idx}`);
        if (spanEl) {
            compScores[compName] = parseInt(spanEl.innerText, 10) || 0;
        }
    });

    // Override hole_score with manually set value
    scorecard.finishHole(putts, pens, memo, compScores);
    const holeData = scorecard.getHoleData();
    if (holeData) holeData.hole_score = score;
    scorecard.saveRoundData();
    document.getElementById('hole-modal').classList.add('hidden');

    const holeSelector = document.getElementById('hole-selector');
    const options = Array.from(holeSelector.options).map(o => o.value);
    const currentIndex = options.indexOf(scorecard.currentHole.toString());

    if (currentIndex !== -1 && currentIndex < options.length - 1) {
        // Advance to next hole in sequence
        const nextHoleVal = options[currentIndex + 1];
        holeSelector.value = nextHoleVal;
        holeSelector.dispatchEvent(new Event('change'));
    } else {
        // End of round reached
        showScorecardModal();
    }
}

function showScorecardModal(historyRoundData = null) {
    if (!historyRoundData || historyRoundData.type) {
        scorecard.updateSummary(); // Ensure totals are fresh for ongoing round
    }

    const rd = (historyRoundData && !historyRoundData.type) ? historyRoundData : scorecard.roundData;
    const isReadonly = (historyRoundData && !historyRoundData.type);

    const body = document.getElementById('scorecard-body');

    document.getElementById('btn-save-round').style.display = 'block';

    const companions = rd.companions || [];
    let compHeaders = '';
    companions.forEach(c => {
        compHeaders += `<th>${c}</th>`;
    });

    let html = `
        <table class="score-table" style="font-size: 12px;">
            <thead>
                <tr>
                    <th>Hole</th><th>Par</th><th>Score</th><th>Putts</th><th>Pena</th>${compHeaders}
                </tr>
            </thead>
            <tbody>
    `;

    const sequence = rd.holeSequence || Array.from({ length: 18 }, (_, i) => i + 1);

    // Tally companion totals
    const compTotals = {};
    companions.forEach(c => compTotals[c] = 0);

    for (const hNum of sequence) {
        const h = rd.holes[hNum];
        if (h && h.hole_score > 0) {
            let compCells = '';
            companions.forEach(c => {
                const s = (h.companionScores && h.companionScores[c]) ? h.companionScores[c] : 0;
                compTotals[c] += s;
                compCells += `<td>${s > 0 ? s : '-'}</td>`;
            });

            html += `
                <tr data-hole="${hNum}">
                    <td>${hNum}</td>
                    <td>${h.par}</td>
                    <td><input type="number" class="edit-score" value="${h.hole_score}" min="1" max="20" style="width: 40px; text-align: center; border: 1px solid #ccc; border-radius: 4px; padding: 4px;"></td>
                    <td><input type="number" class="edit-putts" value="${h.putts}" min="0" max="10" style="width: 35px; text-align: center; border: 1px solid #ccc; border-radius: 4px; padding: 4px;"></td>
                    <td><input type="number" class="edit-pens" value="${h.penalties}" min="0" max="10" style="width: 35px; text-align: center; border: 1px solid #ccc; border-radius: 4px; padding: 4px;"></td>
                    ${compCells}
                </tr>
            `;
        }
    }

    let compTotalsHtml = '';
    if (companions.length > 0) {
        compTotalsHtml = `<div style="margin-top: 10px; font-size: 13px;"><strong>Companions:</strong> `;
        const t = [];
        companions.forEach(c => {
            t.push(`${c}: ${compTotals[c]}`);
        });
        compTotalsHtml += t.join(' | ') + `</div>`;
    }

    html += `
            </tbody>
        </table>
        <div style="margin-top: 15px; text-align: center;">
            <strong>Total Score: ${rd.summary.total_score}</strong><br>
            <span style="font-size: 12px; color: #555;">(Putts: ${rd.summary.total_putts} | Pen: ${rd.summary.total_penalties})</span>
            ${compTotalsHtml}
        </div>
    `;

    body.innerHTML = html;
    document.getElementById('scorecard-modal').classList.remove('hidden');

    // Action button logic (Update History or Save Round)
    const saveBtn = document.getElementById('btn-save-round');
    saveBtn.innerText = isReadonly ? 'Update History' : 'Save Results';
    saveBtn.onclick = () => {
        const rows = body.querySelectorAll('tbody tr');
        rows.forEach(row => {
            const hNum = row.dataset.hole;
            const scoreInp = row.querySelector('.edit-score');
            const puttsInp = row.querySelector('.edit-putts');
            const pensInp = row.querySelector('.edit-pens');

            if (scoreInp && rd.holes[hNum]) {
                rd.holes[hNum].hole_score = parseInt(scoreInp.value, 10);
                rd.holes[hNum].putts = parseInt(puttsInp.value, 10);
                rd.holes[hNum].penalties = parseInt(pensInp.value, 10);
            }
        });

        if (isReadonly) {
            // Update historical record
            const updatedSummary = calculateSummary(rd);
            rd.summary = updatedSummary;
            scorecard.updateHistoryRound(rd);
            alert('History updated!');
            window.renderHistoryList();
            document.getElementById('scorecard-modal').classList.add('hidden');
        } else {
            // Standard save for ongoing round
            scorecard.saveRoundData();
            const courseName = scorecard.roundData.course_name || (COURSE_METADATA[currentCourseUrl] || {}).name || "Unknown Course";
            scorecard.saveRoundToHistory(courseName);

            document.getElementById('scorecard-modal').classList.add('hidden');
            alert('Round results saved successfully to your history!');

            // Reset Start Round Button
            const startBtn = document.getElementById('btn-start-round');
            startBtn.innerText = 'Start Round';
            startBtn.classList.remove('in-round');

            // Reset hole selector
            const hs = document.getElementById('hole-selector');
            hs.innerHTML = '';
            hs.value = '';

            // Hide hole status and record shot button
            document.getElementById('hole-status').style.display = 'none';
            document.getElementById('btn-record-shot').style.display = 'none';

            // Switch to History View
            const historyBtn = document.querySelector('.nav-btn[data-target="view-history"]');
            if (historyBtn) historyBtn.click();
        }
    };
}

function calculateSummary(rd) {
    let totalScore = 0, totalPutts = 0, totalPenalties = 0;
    const sequence = rd.holeSequence || Array.from({ length: 18 }, (_, i) => i + 1);
    for (const hNum of sequence) {
        if (rd.holes[hNum]) {
            totalScore += (rd.holes[hNum].hole_score || 0);
            totalPutts += (rd.holes[hNum].putts || 0);
            totalPenalties += (rd.holes[hNum].penalties || 0);
        }
    }
    return {
        total_score: totalScore,
        total_putts: totalPutts,
        total_penalties: totalPenalties
    };
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

async function loadCourse(url, holeSequence = null, targetHole = null) {
    try {
        currentCourseUrl = url;

        // Check local storage first
        const savedData = localStorage.getItem(`golf-course-${url}`);
        if (savedData) {
            courseData = JSON.parse(savedData);
            console.log("Loaded course from local storage");
        } else {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch course data: ${response.status} ${response.statusText}`);
            }
            courseData = await response.json();
            console.log("Fetched course from network");
        }

        if (holeSequence && holeSequence.length > 0) {
            const holeSelector = document.getElementById('hole-selector');
            holeSelector.innerHTML = '';
            holeSequence.forEach(hNum => {
                const opt = document.createElement('option');
                opt.value = hNum;
                opt.innerText = String(hNum).match(/^[A-Z]+-/) ? hNum : `Hole ${hNum}`;
                holeSelector.appendChild(opt);
            });

            // Set the target hole
            const activeHole = targetHole || holeSequence[0];
            holeSelector.value = activeHole;

            renderClubSelector();
            displayHole(activeHole);
        }
    } catch (error) {
        console.error("Error loading course data:", error);
        alert(`Failed to load course: ${error.message}`);
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
    document.getElementById('ui-current-hole').innerText = String(holeNumber).match(/^[A-Z]+-/) ? holeNumber : `Hole ${holeNumber}`;
    document.getElementById('ui-current-par').innerText = holePar;

    const isRoundActive = document.getElementById('btn-start-round').classList.contains('in-round');

    document.getElementById('hole-status').style.display = isRoundActive ? 'flex' : 'none';
    document.getElementById('btn-record-shot').style.display = isRoundActive ? 'flex' : 'none';
    document.getElementById('edit-controls').style.display = 'flex';

    // Show live shot count in hole status
    if (isRoundActive) {
        const holeData = scorecard.getHoleData();
        const shotCount = holeData && holeData.shots ? holeData.shots.length : 0;
        document.getElementById('ui-shot-count').innerText = shotCount;
        document.getElementById('shot-count-display').style.display = 'inline';
    } else {
        document.getElementById('shot-count-display').style.display = 'none';
    }

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

    // Toggle distance panel row visibility based on available targets
    const distRowMap = {
        'green_front': 'row-green-front',
        'green_back': 'row-green-back',
        'hazard_front': 'row-hazard-front',
        'hazard_back': 'row-hazard-back',
    };
    for (const [kind, rowId] of Object.entries(distRowMap)) {
        const row = document.getElementById(rowId);
        if (row) row.style.display = holeTargets[kind] ? 'flex' : 'none';
    }

    let bounds = geoJsonLayer.getBounds();
    // If we have a current position, include it in the bounds so both user and pin are visible
    if (typeof lastPos !== 'undefined' && lastPos) {
        bounds.extend([lastPos.lat, lastPos.lng]);
    }

    if (bounds.isValid()) {
        refreshMapView();
    }
}

function refreshMapView() {
    if (!map) return;

    let bounds = L.latLngBounds();
    let hasPoint = false;

    // 1. Include user position
    if (lastPos) {
        bounds.extend([lastPos.lat, lastPos.lng]);
        hasPoint = true;
    }

    // 2. Include green center
    if (holeTargets && holeTargets['green_center']) {
        const pinCoords = holeTargets['green_center'];
        bounds.extend([pinCoords[1], pinCoords[0]]);
        hasPoint = true;
    }

    if (!hasPoint) return;

    // Fixed orientation: North-up
    map.setBearing(0);

    // Padding requirements:
    // User at bottom-center: need large bottom padding.
    // Recenter button is at bottom: 85px + 56px = 141px.
    // Green below Edit Map button: Edit Map is at top-right.
    // Top padding should be enough to stay below the top bar and edit controls.

    // 113px bottom padding to align with Recenter button center
    const options = {
        paddingTopLeft: [50, 100],
        paddingBottomRight: [50, 113],
        maxZoom: 18,
        animate: true
    };

    map.fitBounds(bounds, options);
}

// Global tracker instance
let tracker = null;
let lastPos = null;
let isFirstFix = true;

function toggleTracking() {
    const fabShot = document.getElementById('btn-record-shot');

    if (tracker) {
        // STOP
        tracker.stop();
        tracker = null;
        fabShot.style.display = 'none';
        updateGpsStatus('disconnected', 'Tracking stopped');
    } else {
        // START
        const isRoundActive = document.getElementById('btn-start-round').classList.contains('in-round');
        if (isRoundActive) {
            fabShot.style.display = 'flex';
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
    // Early return for filtered GPS fixes
    if (pos.status === 'low_accuracy') {
        updateGpsStatus('connecting', `Low Accuracy (±${Math.round(pos.accuracy)}m)`);
        return;
    } else if (pos.status === 'unstable') {
        updateGpsStatus('connecting', `Unstable Signal (Speed Jump)`);
        return;
    }

    lastPos = pos;
    const latlng = [pos.lat, pos.lng];
    const userCoords = [pos.lng, pos.lat]; // [lng, lat] for Haversine

    // 1. Update Map Marker
    if (!userMarker) {
        const userIcon = L.divIcon({
            className: 'user-marker-container',
            html: `
                <div id="user-heading-cone" class="user-heading-cone" style="transform: rotate(${userHeading !== null ? userHeading : 0}deg)"></div>
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
            cone.style.transform = `rotate(${userHeading !== null ? userHeading : 0}deg)`;
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
        refreshMapView();
        isFirstFix = false;
    } else if (isHeadingUp) {
        // HeadingUp mode in this app means "Follow User"
        // We always refresh map view to keep both User and Green in frame with padding
        refreshMapView();
    }

    // 2. Calculate Distances (only during active round)
    const isRoundActive = document.getElementById('btn-start-round').classList.contains('in-round');
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
            if (isRoundActive && holeTargets[kind]) {
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
            // Android often needs 'deviceorientationabsolute' for North-aligned alpha
            if ('ondeviceorientationabsolute' in window) {
                window.addEventListener('deviceorientationabsolute', handleOrientation);
            } else {
                window.addEventListener('deviceorientation', handleOrientation);
            }
        }
    }
}

function handleOrientation(event) {
    // webkitCompassHeading is iOS-specific and absolute
    // alpha is standard, but on Android it's only absolute if using deviceorientationabsolute
    let compass = event.webkitCompassHeading || event.alpha;

    // On some Android devices, alpha is absolute but needs to be normalized or inverted
    if (event.absolute === true || event.webkitCompassHeading !== undefined) {
        if (compass !== null && compass !== undefined) {
            userHeading = compass;

            // Removed map.setBearing(compass) to prevent unwanted rotations
            // Fixed orientation: North-up

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
const STANDARD_CLUBS = [
    'Dr', '2w', '3w', '4w', '5w', '6w', '7w', '8w', '9w',
    '1U', '2U', '3U', '4U', '5U', '6U', '7U', '8U', '9U',
    '1I', '2I', '3I', '4I', '5I', '6I', '7I', '8I', '9I',
    'PW', 'SW', 'LW', '50°', '52°', '54°', '56°', '58°', '60°', 'PT'
];
const DEFAULT_CLUBS = ['Dr', '3w', '4U', '5I', '6I', '7I', '8I', '9I', 'PW', 'SW', 'PT'];

function getSavedClubs() {
    const saved = localStorage.getItem('golf-pwa-clubs');
    if (saved) {
        let clubs = JSON.parse(saved);
        clubs = clubs.filter(c => STANDARD_CLUBS.includes(c));
        if (clubs.length > 0) return clubs;
    }
    return DEFAULT_CLUBS;
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
        btn.onclick = () => {
            if (!btn.classList.contains('selected')) {
                const currentCount = grid.querySelectorAll('.club-btn.selected').length;
                if (currentCount >= 14) {
                    alert('You can select up to 14 clubs.');
                    return;
                }
            }
            btn.classList.toggle('selected');
        };
        grid.appendChild(btn);
    });
};

document.getElementById('btn-save-settings').addEventListener('click', () => {
    const grid = document.getElementById('settings-club-grid');
    const selectedBtns = grid.querySelectorAll('.club-btn.selected');

    if (selectedBtns.length > 14) {
        alert('You can select up to 14 clubs.');
        return;
    }

    const newClubs = Array.from(selectedBtns).map(btn => btn.dataset.club);

    // Sort them according to STANDARD_CLUBS order
    newClubs.sort((a, b) => STANDARD_CLUBS.indexOf(a) - STANDARD_CLUBS.indexOf(b));

    saveClubs(newClubs);
    alert('Settings saved!');
});

// --- COMPANION GROUPS SETTINGS ---
function getCompanionGroups() {
    const saved = localStorage.getItem('golf-pwa-companion-groups');
    return saved ? JSON.parse(saved) : [];
}

function saveCompanionGroups(groups) {
    localStorage.setItem('golf-pwa-companion-groups', JSON.stringify(groups));
    renderCompanionGroupsList();
}

function renderCompanionGroupsList() {
    const listEl = document.getElementById('settings-groups-list');
    if (!listEl) return;

    const groups = getCompanionGroups();
    listEl.innerHTML = '';

    groups.forEach((group, index) => {
        const li = document.createElement('li');
        li.style.cssText = 'background: #fff; padding: 16px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); margin-bottom: 15px; display: flex; flex-direction: column; gap: 12px; border: 1px solid #f0f0f0;';

        const headerDiv = document.createElement('div');
        headerDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f5f5f5; padding-bottom: 8px;';
        headerDiv.innerHTML = `<strong style="font-size: 16px; color: #333;">${group.name}</strong><span style="font-size: 12px; color: #999;">${group.players.length} Players</span>`;

        const playersDiv = document.createElement('div');
        playersDiv.style.cssText = 'font-size: 13px; color: #666; display: flex; flex-wrap: wrap; gap: 6px;';
        group.players.forEach((p, i) => {
            const isMe = (i === (group.mainPlayerIndex || 0));
            playersDiv.innerHTML += `<span style="background: ${isMe ? '#ffecb3' : '#e3f2fd'}; color: ${isMe ? '#f57c00' : '#1e88e5'}; padding: 4px 10px; border-radius: 16px; font-weight: 500;">${p} ${isMe ? '(Me)' : ''}</span>`;
        });

        const actionsDiv = document.createElement('div');
        actionsDiv.style.cssText = 'display: flex; gap: 10px; margin-top: 5px;';

        const loadBtn = document.createElement('button');
        loadBtn.style.cssText = 'flex: 1; color: #1e88e5; border: 1px solid #1e88e5; background: transparent; padding: 10px; font-weight: 600; border-radius: 8px; cursor: pointer; transition: all 0.2s; font-size: 14px;';
        loadBtn.innerText = 'Edit Group';
        loadBtn.onclick = () => {
            document.getElementById('settings-group-name').value = group.name;
            document.getElementById('settings-player-1').value = group.players[0] || '';
            document.getElementById('settings-player-2').value = group.players[1] || '';
            document.getElementById('settings-player-3').value = group.players[2] || '';
            document.getElementById('settings-player-4').value = group.players[3] || '';
            document.getElementById('settings-player-5').value = group.players[4] || '';
            const radio = document.querySelector(`input[name="settings-me"][value="${group.mainPlayerIndex || 0}"]`);
            if (radio) radio.checked = true;
        };

        const delBtn = document.createElement('button');
        delBtn.style.cssText = 'flex: 1; color: #d32f2f; background: #ffebee; border: none; padding: 10px; font-weight: 600; border-radius: 8px; cursor: pointer; transition: all 0.2s; font-size: 14px;';
        delBtn.innerText = 'Delete';
        delBtn.onclick = () => {
            if (confirm('Delete this group?')) {
                const newGroups = [...groups];
                newGroups.splice(index, 1);
                saveCompanionGroups(newGroups);
            }
        };

        actionsDiv.appendChild(loadBtn);
        actionsDiv.appendChild(delBtn);

        li.appendChild(headerDiv);
        li.appendChild(playersDiv);
        li.appendChild(actionsDiv);

        listEl.appendChild(li);
    });
}

const btnAddCompanion = document.getElementById('btn-add-companion-group');
if (btnAddCompanion) {
    btnAddCompanion.addEventListener('click', () => {
        const nameInput = document.getElementById('settings-group-name').value.trim();
        const p1 = document.getElementById('settings-player-1').value.trim();
        const p2 = document.getElementById('settings-player-2').value.trim();
        const p3 = document.getElementById('settings-player-3').value.trim();
        const p4 = document.getElementById('settings-player-4').value.trim();
        const p5 = document.getElementById('settings-player-5').value.trim();

        if (!nameInput) {
            alert('Please enter a Group Name.');
            return;
        }

        const players = [p1, p2, p3, p4, p5].filter(p => p !== '');
        if (players.length === 0) {
            alert('Please enter at least one player name.');
            return;
        }

        const mainPlayerRadio = document.querySelector('input[name="settings-me"]:checked');
        let mainIndex = mainPlayerRadio ? parseInt(mainPlayerRadio.value, 10) : 0;

        // Adjust mainIndex if the selected radio button corresponds to an empty input
        // Since players array only contains non-empty inputs, we need to map the radio button index to the players array index
        let actualPlayerCount = 0;
        let finalMainIndex = 0;
        const allInputs = [p1, p2, p3, p4, p5];
        for (let i = 0; i < allInputs.length; i++) {
            if (allInputs[i] !== '') {
                if (i === mainIndex) {
                    finalMainIndex = actualPlayerCount;
                }
                actualPlayerCount++;
            }
        }

        const newGroup = { name: nameInput, players: players, mainPlayerIndex: finalMainIndex };
        const groups = getCompanionGroups();

        // Check if group exists
        const existingIndex = groups.findIndex(g => g.name === nameInput);
        if (existingIndex >= 0) {
            groups[existingIndex] = newGroup;
        } else {
            groups.push(newGroup);
        }

        saveCompanionGroups(groups);
        document.getElementById('btn-clear-companion-inputs').click();
    });
}

const btnClearCompanion = document.getElementById('btn-clear-companion-inputs');
if (btnClearCompanion) {
    btnClearCompanion.addEventListener('click', () => {
        document.getElementById('settings-group-name').value = '';
        document.getElementById('settings-player-1').value = '';
        document.getElementById('settings-player-2').value = '';
        document.getElementById('settings-player-3').value = '';
        document.getElementById('settings-player-4').value = '';
        document.getElementById('settings-player-5').value = '';
        const radio = document.querySelector('input[name="settings-me"][value="0"]');
        if (radio) radio.checked = true;
    });
}

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

    bestEl.parentElement.innerHTML = `<span class="stat-label">Best</span><span id="stat-best-score">${scorecard.getBestScore()}</span>`;
    avgEl.parentElement.innerHTML = `<span class="stat-label">Avg</span><span id="stat-avg-score">${scorecard.getAverageScore()}</span>`;

    // Re-get elements after innerHTML update
    const newBestEl = document.getElementById('stat-best-score');
    const newAvgEl = document.getElementById('stat-avg-score');

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

        const compText = (round.companions && round.companions.length > 0) ? `<div style="font-size: 11px; color: #888; margin-top: 2px;">With: ${round.companions.join(', ')}</div>` : '';
        const infoDiv = document.createElement('div');
        infoDiv.className = 'history-info';
        infoDiv.innerHTML = `
            <div class="history-date">${dateStr}</div>
            <div class="history-course">${round.course_name || 'Golf Course'}</div>
            ${compText}
        `;

        const scoreDiv = document.createElement('div');
        scoreDiv.className = 'history-score-badge';
        scoreDiv.innerHTML = `
            <span class="history-score-val">${round.summary.total_score || '--'}</span>
            <span class="history-score-label">Score</span>
        `;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'history-delete-btn';
        deleteBtn.innerHTML = 'Delete';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm('Delete this round?')) {
                scorecard.deleteRoundFromHistory(round.round_id);
                window.renderHistoryList();
            }
        };

        const itemContent = document.createElement('div');
        itemContent.className = 'history-item-content';
        itemContent.appendChild(infoDiv);
        itemContent.appendChild(scoreDiv);

        li.appendChild(itemContent);
        li.appendChild(deleteBtn);

        // Swipe logic
        let startX = 0;
        let currentX = 0;
        let isSwiping = false;

        li.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            currentX = startX; // Reset currentX on tap!
            isSwiping = true;
            itemContent.style.transition = 'none';
        }, { passive: true });

        li.addEventListener('touchmove', (e) => {
            if (!isSwiping) return;
            currentX = e.touches[0].clientX;
            const diff = Math.min(0, currentX - startX);
            if (diff < -5) {
                itemContent.style.transform = `translateX(${diff}px)`;
            }
        }, { passive: true });

        li.addEventListener('touchend', () => {
            isSwiping = false;
            itemContent.style.transition = 'transform 0.3s ease';
            const diff = currentX - startX;
            if (diff < -70) {
                li.classList.add('swiped');
                itemContent.style.transform = `translateX(-80px)`;
            } else {
                li.classList.remove('swiped');
                itemContent.style.transform = `translateX(0)`;
            }
        });

        itemContent.addEventListener('click', () => {
            if (li.classList.contains('swiped')) {
                li.classList.remove('swiped');
                itemContent.style.transform = `translateX(0)`;
            } else {
                showScorecardModal(round);
            }
        });

        listEl.appendChild(li);
    });
};

// Boot up
document.addEventListener('DOMContentLoaded', init);
