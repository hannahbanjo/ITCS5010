// ── tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        tab.classList.add("active");
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
    });
});

document.querySelectorAll(".sub-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".sub-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".sub-panel").forEach(p => p.classList.remove("active"));
        tab.classList.add("active");
        document.getElementById(`subtab-${tab.dataset.subtab}`).classList.add("active");
    });
});

// public credentials — safe to expose in frontend code
const SUPABASE_URL = "https://ealiyznkkjteaxpstokp.supabase.co";
const SUPABASE_KEY = "sb_publishable_2FB_Im9SrfoOCaKZTZCI2A_Gqz_A6aQ";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let allRatings = [];
let allPerf = [];
let allCorr = [];

let brierChart = null;
let logLossChart = null;
let repeatChart = null;
let corrChart = null;

const seasonSelect = document.getElementById("season-select");
const modelSelect  = document.getElementById("model-select");

// ── fetch all data on load ────────────────────────────────────────────────────
async function loadAll() {
    const [ratingsRes, perfRes, corrRes] = await Promise.all([
        db.from("team_ratings").select("*"),
        db.from("model_performance").select("*"),
        db.from("awp_gc_correlations").select("*"),
    ]);

    if (ratingsRes.error) console.error("team_ratings error:", ratingsRes.error);
    if (perfRes.error)    console.error("model_performance error:", perfRes.error);
    if (corrRes.error)    console.error("awp_gc_correlations error:", corrRes.error);

    allRatings = ratingsRes.data || [];
    allPerf    = perfRes.data    || [];
    allCorr    = corrRes.data    || [];

    renderRankings();
    renderPerformance();
    renderRepeatability();
    renderCorrelations();
}

// ── Part 1: rankings ──────────────────────────────────────────────────────────
function renderRankings() {
    const season = parseInt(seasonSelect.value);
    const model  = modelSelect.value;

    const filtered = allRatings
        .filter(r => r.season === season && r[model] != null)
        .sort((a, b) => b[model] - a[model]);

    const top10    = filtered.slice(0, 10);
    const bottom10 = filtered.slice(-10).reverse();

    fillTable("top-table",    top10,    model, 1);
    fillTable("bottom-table", bottom10, model, filtered.length - 9);
}

function fillTable(tableId, rows, model, startRank) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    tbody.innerHTML = "";
    rows.forEach((r, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${startRank + i}</td>
            <td>${r.team}</td>
            <td>${r[model].toFixed(3)}</td>
        `;
        tbody.appendChild(tr);
    });
}

seasonSelect.addEventListener("change", renderRankings);
modelSelect.addEventListener("change",  renderRankings);

// ── Part 2: predictive performance ───────────────────────────────────────────
function renderPerformance() {
    const seasons = ["2021","2022","2023","2024","2025"];
    const models  = ["SRS", "Adj AWP", "Adj GC"];
    const colors  = { "SRS": "#1b2a4a", "Adj AWP": "#c4884d", "Adj GC": "#5b8fd4" };

    const perfBySeason = allPerf.filter(r => r.season !== "all");

    const brierDatasets = models.map(m => ({
        label: m,
        data: seasons.map(s => {
            const row = perfBySeason.find(r => r.season === s && r.model === m);
            return row ? +row.brier.toFixed(4) : null;
        }),
        backgroundColor: colors[m],
        borderRadius: 3,
    }));

    const logDatasets = models.map(m => ({
        label: m,
        data: seasons.map(s => {
            const row = perfBySeason.find(r => r.season === s && r.model === m);
            return row ? +row.log_loss.toFixed(4) : null;
        }),
        backgroundColor: colors[m],
        borderRadius: 3,
    }));

    if (brierChart) brierChart.destroy();
    brierChart = new Chart(document.getElementById("brier-chart"), {
        type: "bar",
        data: { labels: seasons, datasets: brierDatasets },
        options: chartOptions("Brier Score by Model & Season (lower = better)", "Brier Score"),
    });

    if (logLossChart) logLossChart.destroy();
    logLossChart = new Chart(document.getElementById("logloss-chart"), {
        type: "bar",
        data: { labels: seasons, datasets: logDatasets },
        options: chartOptions("Log Loss by Model & Season (lower = better)", "Log Loss"),
    });

    // summary table including "all" row
    const tbody = document.querySelector("#perf-table tbody");
    tbody.innerHTML = "";
    allPerf
        .sort((a, b) => a.season.localeCompare(b.season) || a.model.localeCompare(b.model))
        .forEach(r => {
            const tr = document.createElement("tr");
            if (r.season === "all") tr.classList.add("row-all");
            tr.innerHTML = `
                <td>${r.season === "all" ? "All seasons" : r.season}</td>
                <td>${r.model}</td>
                <td>${r.brier != null ? r.brier.toFixed(4) : "—"}</td>
                <td>${r.log_loss != null ? r.log_loss.toFixed(4) : "—"}</td>
            `;
            tbody.appendChild(tr);
        });
}

// ── Part 3: repeatability ─────────────────────────────────────────────────────
function renderRepeatability() {
    const seasons = ["2021","2022","2023","2024","2025"];
    const models  = ["SRS", "Adj AWP", "Adj GC"];
    const colors  = { "SRS": "#1b2a4a", "Adj AWP": "#c4884d", "Adj GC": "#5b8fd4" };

    const repBySeason = allPerf.filter(r => r.season !== "all" && r.repeatability_r != null);

    const datasets = models.map(m => ({
        label: m,
        data: seasons.map(s => {
            const row = repBySeason.find(r => r.season === s && r.model === m);
            return row ? +row.repeatability_r.toFixed(3) : null;
        }),
        backgroundColor: colors[m],
        borderRadius: 3,
    }));

    if (repeatChart) repeatChart.destroy();
    repeatChart = new Chart(document.getElementById("repeat-chart"), {
        type: "bar",
        data: { labels: seasons, datasets },
        options: chartOptions("Repeatability: First Half vs Second Half Correlation (higher = better)", "Pearson r", 0, 1),
    });

    const tbody = document.querySelector("#repeat-table tbody");
    tbody.innerHTML = "";
    allPerf
        .filter(r => r.repeatability_r != null)
        .sort((a, b) => a.season.localeCompare(b.season) || a.model.localeCompare(b.model))
        .forEach(r => {
            const tr = document.createElement("tr");
            if (r.season === "all") tr.classList.add("row-all");
            tr.innerHTML = `
                <td>${r.season === "all" ? "All seasons" : r.season}</td>
                <td>${r.model}</td>
                <td>${r.repeatability_r.toFixed(3)}</td>
            `;
            tbody.appendChild(tr);
        });
}

// ── Part 4: raw vs adjusted correlation ───────────────────────────────────────
function renderCorrelations() {
    const seasons = ["2021","2022","2023","2024","2025"];
    const models  = ["Adj GC", "Adj AWP"];
    const colors  = { "Adj AWP": "#c4884d", "Adj GC": "#5b8fd4" };

    const bySeason = allCorr.filter(r => r.season !== "all");

    const datasets = models.map(m => ({
        label: m,
        data: seasons.map(s => {
            const row = bySeason.find(r => r.season === s && r.model === m);
            return row ? +row.raw_adj_correlation.toFixed(3) : null;
        }),
        backgroundColor: colors[m],
        borderRadius: 3,
    }));

    if (corrChart) corrChart.destroy();
    corrChart = new Chart(document.getElementById("corr-chart"), {
        type: "bar",
        data: { labels: seasons, datasets },
        options: chartOptions("Raw vs Opponent-Adjusted Correlation by Season", "Pearson r", 0, 1),
    });

    const tbody = document.querySelector("#corr-table tbody");
    tbody.innerHTML = "";
    allCorr
        .sort((a, b) => a.season.localeCompare(b.season) || a.model.localeCompare(b.model))
        .forEach(r => {
            const tr = document.createElement("tr");
            if (r.season === "all") tr.classList.add("row-all");
            tr.innerHTML = `
                <td>${r.season === "all" ? "All seasons" : r.season}</td>
                <td>${r.model}</td>
                <td>${r.raw_adj_correlation.toFixed(3)}</td>
            `;
            tbody.appendChild(tr);
        });
}

// ── shared chart options ──────────────────────────────────────────────────────
function chartOptions(title, yLabel, yMin = undefined, yMax = undefined) {
    return {
        responsive: true,
        plugins: {
            legend: {
                labels: { color: "#1a1a1a", font: { family: "DM Sans", size: 12 } }
            },
            title: {
                display: true,
                text: title,
                color: "#1b2a4a",
                font: { family: "Courier Prime", size: 13, weight: "700" },
                padding: { bottom: 12 }
            }
        },
        scales: {
            x: {
                ticks: { color: "#555", font: { family: "DM Sans" } },
                grid:  { color: "#e8e8e8" }
            },
            y: {
                min: yMin,
                max: yMax,
                ticks: { color: "#555", font: { family: "DM Sans" } },
                grid:  { color: "#e8e8e8" },
                title: { display: true, text: yLabel, color: "#555", font: { family: "DM Sans" } }
            }
        }
    };
}

loadAll();
