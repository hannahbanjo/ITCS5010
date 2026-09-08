// note: these are public credentials, so they are safe to expose in frontend code
const SUPABASE_URL = "https://ealiyznkkjteaxpstokp.supabase.co"; 
const SUPABASE_KEY = "sb_publishable_2FB_Im9SrfoOCaKZTZCI2A_Gqz_A6aQ"; 

// initialize supabase client using public url and key
// named "db" to avoid conflict with the global "supabase" variable created by the CDN script
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// will stpore all game data fetched from supabase
// fetch all games at once on page load
let allGames = [];

// refernce to chart instance, so when a team is selected, old chart is destroyed before new one is created

// bar chart instance for per-game win probability view
let barChartInstance = null;


// load all game data from supabase on page load
// filter in js for each time user selects a team instead of making an api call for each team selection
async function fetchGames() {
    try {
        // supabase caps each request at 1000 rows, so we fetch in two pages
        // to get all ~1600 games
        const { data: page1, error: err1 } = await db
            .from("cfb_win_probs")
            .select("*")
            .range(0, 999);

        if (err1) {
            console.error("Error fetching games (page 1):", err1);
            document.querySelector(".controls label").textContent =
                "Error loading games. Check console for details.";
            return;
        }

        const { data: page2, error: err2 } = await db
            .from("cfb_win_probs")
            .select("*")
            .range(1000, 1999);

        if (err2) {
            console.error("Error fetching games (page 2):", err2);
            document.querySelector(".controls label").textContent =
                "Error loading games. Check console for details.";
            return;
        }

        allGames = [...page1, ...(page2 || [])];
        populateTeamDropdown();
    } catch (err) {
        console.error("Failed to connect to Supabase:", err);
        document.querySelector(".controls label").textContent =
            "Failed to connect to database. Check console for details.";
    }
}

// collects team neams, sorts them, and adds them to the dropdown
function populateTeamDropdown() {
    const teamSet = new Set();
    allGames.forEach((game) => {
        teamSet.add(game.home_team);
        teamSet.add(game.away_team);
    });

    // sort alphabetically and add to the <select> element
    const teams = [...teamSet].sort();
    const select = document.getElementById("team-select");

    teams.forEach((team) => {
        const option = document.createElement("option");
        option.value = team;
        option.textContent = team;
        select.appendChild(option);
    });

    // allows user to search for a team in dropdown instead of scrolling through the entire list
    new TomSelect("#team-select", {
        maxItems: 1,
        // render data when teamm is selected from dropdown
        onChange: (value) => {
            if (value) {
                renderTeamData(value);
            }
        },
    });
}

// search for all games involving the selected team, then render the chart and table
function renderTeamData(teamName) {
    // filter games where this team was either home or away
    const teamGames = allGames
        .filter((g) => g.home_team === teamName || g.away_team === teamName)
        .sort((a, b) => a.week - b.week);

    // for each game, figure out the stats from that team's perspective
    const processed = teamGames.map((g) => {
        const isHome = g.home_team === teamName;
        return {
            week: g.week,
            opponent: isHome ? g.away_team : g.home_team,
            homeAway: isHome ? "Home" : "Away",
            teamScore: isHome ? g.home_score : g.away_score,
            oppScore: isHome ? g.away_score : g.home_score,
            // win probability from this team's perspective
            winProb: isHome ? g.home_win_prob : g.away_win_prob,
            // actually results: 1 = yes, 0 = no
            actualWin: isHome
                ? g.home_score > g.away_score ? 1 : 0
                : g.away_score > g.home_score ? 1 : 0,
            teamColor: isHome ? g.home_color : g.away_color,
            // keep raw game data for the bar chart
            raw: g,
        };
    });

    renderBarChart(teamName, processed);
    renderTable(processed);

    // show the sections that were hidden until a team was selected
    document.getElementById("game-chart-section").classList.remove("hidden");
    document.getElementById("table-section").classList.remove("hidden");
    document.getElementById("model-info").classList.remove("hidden");
}

// render stacked horizontal bar chart showing win probability for every game in the season
function renderBarChart(teamName, games) {
    if (barChartInstance) {
        barChartInstance.destroy();
    }

    document.getElementById("game-chart-title").textContent =
        `${teamName} Game-by-Game Win Probabilities`;

    const ctx = document.getElementById("game-bar-chart").getContext("2d");

    // one label per game row: "Wk 1 vs Opponent"
    const labels = games.map((g) => `Wk ${g.week} vs ${g.opponent}`);

    // selected team's win probability (left portion of each stacked bar)
    const teamProbs = games.map((g) => +(g.winProb * 100).toFixed(1));
    // opponent's win probability (right portion)
    const oppProbs = games.map((g) => +((1 - g.winProb) * 100).toFixed(1));

    // team color for their bars; neutral gray for all opponents
    const teamColor = games.length > 0 ? games[0].teamColor : "#1b2a4a";

    barChartInstance = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    label: teamName,
                    data: teamProbs,
                    backgroundColor: teamColor,
                    borderColor: "#ffffff",
                    borderWidth: 1,
                },
                {
                    label: "Opponent",
                    data: oppProbs,
                    backgroundColor: "#cccccc",
                    borderColor: "#ffffff",
                    borderWidth: 1,
                },
            ],
        },
        options: {
            indexAxis: "y",
            responsive: true,
            scales: {
                x: {
                    stacked: true,
                    min: 0,
                    max: 100,
                    title: { display: true, text: "Win Probability (%)", font: { weight: "bold" } },
                    ticks: { callback: (val) => val + "%" },
                },
                y: {
                    stacked: true,
                    ticks: { font: { size: 12 } },
                },
            },
            plugins: {
                legend: {
                    display: true,
                    position: "bottom",
                    labels: { font: { size: 13, weight: "bold" } },
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const g = games[context.dataIndex];
                            const result = g.actualWin ? "W" : "L";
                            if (context.datasetIndex === 0) {
                                return `${teamName}: ${context.parsed.x}% (${result} ${g.teamScore}-${g.oppScore})`;
                            }
                            return `${g.opponent}: ${context.parsed.x}%`;
                        },
                    },
                },
            },
        },
    });
}


// build table of each game per week
function renderTable(games) {
    const tbody = document.querySelector("#games-table tbody");

    // clear existing rows from previous team selection
    tbody.innerHTML = "";

    games.forEach((g) => {
        const row = document.createElement("tr");
        const result = g.actualWin ? "W" : "L";
        const resultClass = g.actualWin ? "result-win" : "result-loss";

        row.innerHTML = `
            <td>${g.week}</td>
            <td>${g.opponent}</td>
            <td>${g.homeAway}</td>
            <td>${g.teamScore}–${g.oppScore}</td>
            <td>${(g.winProb * 100).toFixed(1)}%</td>
            <td class="${resultClass}">${result}</td>
        `;
        tbody.appendChild(row);
    });
}


// start process
fetchGames();
