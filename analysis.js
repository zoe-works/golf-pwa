/**
 * analysis.js - Handles data aggregation and Chart.js visualizations for Golf PWA
 */

export class AnalysisManager {
    constructor(scorecardManager) {
        this.scorecard = scorecardManager;
        this.currentFilter = 'all'; // 'all' or 'last3'
        this.chart = null;
    }

    init() {
        if (this.initialized) return;
        this.bindEvents();
        this.initialized = true;
    }

    bindEvents() {
        // Filter toggle
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentFilter = e.target.dataset.range;

                // If we are in a detail view, refresh it
                const detailView = document.getElementById('analysis-detail');
                if (!detailView.classList.contains('hidden')) {
                    const currentTitle = document.getElementById('analysis-detail-title').innerText;
                    const viewKey = this.getViewKeyFromTitle(currentTitle);
                    if (viewKey) this.renderAnalysis(viewKey);
                }
            });
        });

        // Dashboard cards
        document.querySelectorAll('.analysis-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const view = e.currentTarget.dataset.view;
                this.showDetail(view);
            });
        });

        // Back button
        document.getElementById('btn-back-analysis')?.addEventListener('click', () => {
            document.getElementById('analysis-dashboard').classList.remove('hidden');
            document.getElementById('analysis-detail').classList.add('hidden');
            if (this.chart) {
                this.chart.destroy();
                this.chart = null;
            }
        });
    }

    getViewKeyFromTitle(title) {
        const map = {
            'Club Distance': 'dist',
            'Score Trend': 'score',
            'Par Analysis': 'par',
            'Club Usage': 'usage',
            'Shot Rating': 'rating',
            'Putting': 'putt'
        };
        return map[title] || null;
    }

    showDetail(view) {
        document.getElementById('analysis-dashboard').classList.add('hidden');
        document.getElementById('analysis-detail').classList.remove('hidden');
        this.renderAnalysis(view);
    }

    getFilteredHistory() {
        let history = this.scorecard.getHistory(); // Returns array of rounds
        if (this.currentFilter === 'last3') {
            return history.slice(0, 3);
        }
        return history;
    }

    renderAnalysis(view) {
        const history = this.getFilteredHistory();
        const ctx = document.getElementById('analysis-chart').getContext('2d');
        const titleEl = document.getElementById('analysis-detail-title');
        const statsEl = document.getElementById('analysis-stats');

        if (this.chart) {
            this.chart.destroy();
        }

        if (history.length === 0) {
            titleEl.innerText = "No Data Available";
            statsEl.innerHTML = '<p style="text-align:center; color:#999;">Play some rounds to see analysis!</p>';
            return;
        }

        let chartConfig = null;

        switch (view) {
            case 'dist':
                chartConfig = this.prepareDistanceChart(history, titleEl, statsEl);
                break;
            case 'score':
                chartConfig = this.prepareScoreChart(history, titleEl, statsEl);
                break;
            case 'par':
                chartConfig = this.prepareParChart(history, titleEl, statsEl);
                break;
            case 'usage':
                chartConfig = this.prepareUsageChart(history, titleEl, statsEl);
                break;
            case 'rating':
                chartConfig = this.prepareRatingChart(history, titleEl, statsEl);
                break;
            case 'putt':
                chartConfig = this.preparePutterChart(history, titleEl, statsEl);
                break;
        }

        if (chartConfig) {
            this.chart = new Chart(ctx, chartConfig);
        }
    }

    prepareDistanceChart(history, titleEl, statsEl) {
        titleEl.innerText = "Club Distance";
        const clubData = {}; // { club: { sum: 0, count: 0 } }

        history.forEach(round => {
            Object.values(round.holes).forEach(hole => {
                if (hole.shots) {
                    hole.shots.forEach(shot => {
                        if (shot.club && shot.distance_yd && shot.distance_yd > 0) {
                            if (!clubData[shot.club]) clubData[shot.club] = { sum: 0, count: 0 };
                            clubData[shot.club].sum += shot.distance_yd;
                            clubData[shot.club].count += 1;
                        }
                    });
                }
            });
        });

        const labels = Object.keys(clubData).sort((a, b) => clubData[b].sum / clubData[b].count - clubData[a].sum / clubData[a].count);
        const data = labels.map(l => Math.round(clubData[l].sum / clubData[l].count));

        statsEl.innerHTML = `<div class="stat-summary-grid">
            <div class="stat-item"><span class="stat-val">${labels.length}</span><span class="stat-label-small">Clubs Tracked</span></div>
            <div class="stat-item"><span class="stat-val">${data[0] || 0}y</span><span class="stat-label-small">Max Average (${labels[0] || '-'})</span></div>
        </div>`;

        return {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Avg Distance (yd)',
                    data: data,
                    backgroundColor: '#1e88e5',
                    borderRadius: 6
                }]
            },
            options: {
                indexAxis: 'y',
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        };
    }

    prepareScoreChart(history, titleEl, statsEl) {
        titleEl.innerText = "Score Trend";
        const sortedHistory = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));
        const labels = sortedHistory.map(r => new Date(r.date).toLocaleDateString([], { month: 'short', day: 'numeric' }));
        const data = sortedHistory.map(r => r.summary.total_score);

        const avg = Math.round(data.reduce((a, b) => a + b, 0) / data.length);
        const best = Math.min(...data);

        statsEl.innerHTML = `<div class="stat-summary-grid">
            <div class="stat-item"><span class="stat-val">${avg}</span><span class="stat-label-small">Avg Score</span></div>
            <div class="stat-item"><span class="stat-val">${best}</span><span class="stat-label-small">Best Score</span></div>
        </div>`;

        return {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Total Score',
                    data: data,
                    borderColor: '#43a047',
                    backgroundColor: 'rgba(67, 160, 71, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 5,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: '#43a047',
                    pointBorderWidth: 2
                }]
            },
            options: {
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: false } }
            }
        };
    }

    prepareParChart(history, titleEl, statsEl) {
        titleEl.innerText = "Par Analysis";
        const parStats = { 3: { sum: 0, count: 0 }, 4: { sum: 0, count: 0 }, 5: { sum: 0, count: 0 } };

        history.forEach(round => {
            Object.values(round.holes).forEach(h => {
                if (h.par && h.hole_score > 0) {
                    if (parStats[h.par]) {
                        parStats[h.par].sum += h.hole_score;
                        parStats[h.par].count += 1;
                    }
                }
            });
        });

        const labels = ['Par 3', 'Par 4', 'Par 5'];
        const data = [3, 4, 5].map(p => parStats[p].count > 0 ? (parStats[p].sum / parStats[p].count).toFixed(1) : 0);

        statsEl.innerHTML = `<div class="stat-summary-grid">
            <div class="stat-item"><span class="stat-val">+${(data[0] - 3).toFixed(1)}</span><span class="stat-label-small">Avg Over (P3)</span></div>
            <div class="stat-item"><span class="stat-val">+${(data[1] - 4).toFixed(1)}</span><span class="stat-label-small">Avg Over (P4)</span></div>
        </div>`;

        return {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Avg Score',
                    data: data,
                    backgroundColor: ['#1e88e5', '#43a047', '#f9a825']
                }]
            },
            options: {
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        };
    }

    prepareUsageChart(history, titleEl, statsEl) {
        titleEl.innerText = "Club Usage";
        const usage = {};
        let totalShots = 0;

        history.forEach(round => {
            Object.values(round.holes).forEach(h => {
                if (h.shots) {
                    h.shots.forEach(s => {
                        if (s.club) {
                            usage[s.club] = (usage[s.club] || 0) + 1;
                            totalShots++;
                        }
                    });
                }
            });
        });

        const labels = Object.keys(usage).sort((a, b) => usage[b] - usage[a]).slice(0, 6);
        const data = labels.map(l => usage[l]);

        statsEl.innerHTML = `<div class="stat-summary-grid">
            <div class="stat-item"><span class="stat-val">${totalShots}</span><span class="stat-label-small">Total Shots</span></div>
            <div class="stat-item"><span class="stat-val">${Math.round(totalShots / history.length)}</span><span class="stat-label-small">Shots/Round</span></div>
        </div>`;

        return {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: ['#1e88e5', '#43a047', '#f9a825', '#f44336', '#9c27b0', '#607d8b']
                }]
            },
            options: {
                maintainAspectRatio: false,
                plugins: { legend: { position: 'right' } }
            }
        };
    }

    prepareRatingChart(history, titleEl, statsEl) {
        titleEl.innerText = "Shot Rating";
        const ratings = {};

        history.forEach(round => {
            Object.values(round.holes).forEach(h => {
                if (h.shots) {
                    h.shots.forEach(s => {
                        if (s.club && s.score) {
                            if (!ratings[s.club]) ratings[s.club] = { sum: 0, count: 0 };
                            ratings[s.club].sum += s.score;
                            ratings[s.club].count += 1;
                        }
                    });
                }
            });
        });

        const labels = Object.keys(ratings).sort((a, b) => ratings[b].sum / ratings[b].count - ratings[a].sum / ratings[a].count);
        const data = labels.map(l => Math.round(ratings[l].sum / ratings[l].count));

        statsEl.innerHTML = `<div class="stat-summary-grid">
             <div class="stat-item"><span class="stat-val">${labels[0] || '-'}</span><span class="stat-label-small">Confidence Club</span></div>
             <div class="stat-item"><span class="stat-val">${data[0] || 0}</span><span class="stat-label-small">Avg Rating</span></div>
        </div>`;

        return {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Avg Rating (0-100)',
                    data: data,
                    backgroundColor: 'rgba(30, 136, 229, 0.7)',
                    borderColor: '#1e88e5',
                    borderWidth: 1
                }]
            },
            options: {
                maintainAspectRatio: false,
                scales: { y: { min: 0, max: 100 } }
            }
        };
    }

    preparePutterChart(history, titleEl, statsEl) {
        titleEl.innerText = "Putting";
        const sortedHistory = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));

        const labels = sortedHistory.map(r => new Date(r.date).toLocaleDateString([], { month: 'short', day: 'numeric' }));
        const avgPutts = [];
        const threePuttRate = [];

        sortedHistory.forEach(round => {
            let roundPutts = 0;
            let threePuttHoles = 0;
            let playedHoles = 0;

            Object.values(round.holes).forEach(h => {
                if (h.hole_score > 0) {
                    roundPutts += (h.putts || 0);
                    if ((h.putts || 0) >= 3) threePuttHoles++;
                    playedHoles++;
                }
            });

            if (playedHoles > 0) {
                // Normalize to 18H if they played fewer (though likely 18 or 9)
                avgPutts.push(parseFloat((roundPutts / playedHoles * 18).toFixed(1)));
                threePuttRate.push(Math.round((threePuttHoles / playedHoles) * 100));
            }
        });

        const avgP = (avgPutts.reduce((a, b) => a + b, 0) / avgPutts.length).toFixed(1);
        const avg3P = Math.round(threePuttRate.reduce((a, b) => a + b, 0) / threePuttRate.length);

        statsEl.innerHTML = `<div class="stat-summary-grid">
            <div class="stat-item"><span class="stat-val">${avgP}</span><span class="stat-label-small">Avg Putts /18H</span></div>
            <div class="stat-item"><span class="stat-val">${avg3P}%</span><span class="stat-label-small">3-Putt Rate</span></div>
        </div>`;

        return {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Putts (18H Eq.)',
                        data: avgPutts,
                        borderColor: '#1e88e5',
                        yAxisID: 'y'
                    },
                    {
                        label: '3-Putt %',
                        data: threePuttRate,
                        borderColor: '#f44336',
                        borderDash: [5, 5],
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                maintainAspectRatio: false,
                scales: {
                    y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Putts' } },
                    y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '%' }, min: 0, max: 100 }
                }
            }
        };
    }
}
