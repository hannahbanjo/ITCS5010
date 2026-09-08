"""
Script that is run one time to:
1. fetch training data (2020-2024)
2. train logistic regression model
3. fetch 2025 data (testing data)
4. upload results to Supabase
5. data is used in website to display win probabilities for 2025 games\
"""

import os
import time
import requests
import numpy as np
import pandas as pd
import statsmodels.api as sm
from sklearn.preprocessing import StandardScaler
from supabase import create_client
from dotenv import load_dotenv
import sportsdataverse as sdv

load_dotenv()

CFBD_API_KEY = os.getenv("CFBD_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")       
SUPABASE_KEY = os.getenv("SUPABASE_KEY")       

headers = {"Authorization": f"Bearer {CFBD_API_KEY}"}

# --- Gathering data ---
def fetch_game_stats(seasons, weeks=range(1, 16)):
    # fetch team-level box score stats for FBS games
    # returns a dataframe with one row per team per game
    raw_stats_list = []

    for yr in seasons:
        for wk in weeks:
            url = (
                f"https://api.collegefootballdata.com/games/teams"
                f"?year={yr}&week={wk}&seasonType=regular&division=fbs"
            )
            try:
                response = requests.get(url, headers=headers, timeout=30)
                if response.status_code != 200:
                    continue
                #ç delay to avoid rate-limiting
                time.sleep(0.5)

                data = response.json()
                for game in data:
                    game_id = game.get("id")
                    teams = game.get("teams", [])
                    if len(teams) != 2:
                        continue

                    for idx, team_data in enumerate(teams):
                        opp_data = teams[1 - idx]

                        # Helper: dig a stat out of the nested stats list
                        def get_stat(t_data, stat_name):
                            for s in t_data.get("stats", []):
                                if s.get("category") == stat_name:
                                    return s.get("stat")
                            return None

                        row = {
                            "game_id": game_id,
                            "season": str(yr),
                            "week_num": wk,
                            "team": team_data.get("school"),
                            "opponent": opp_data.get("school"),
                            "home_away": "home" if team_data.get("homeAway") == "home" else "away",
                            "points": team_data.get("points"),
                            "points_allowed": opp_data.get("points"),
                            "total_yards": get_stat(team_data, "totalYards"),
                            "total_yards_allowed": get_stat(opp_data, "totalYards"),
                            "net_passing_yards": get_stat(team_data, "netPassingYards"),
                            "net_passing_yards_allowed": get_stat(opp_data, "netPassingYards"),
                            "rushing_yards": get_stat(team_data, "rushingYards"),
                            "rushing_yards_allowed": get_stat(opp_data, "rushingYards"),
                            "turnovers": get_stat(team_data, "turnovers"),
                            "turnovers_allowed": get_stat(opp_data, "turnovers"),
                            "first_downs": get_stat(team_data, "firstDowns"),
                            "first_downs_allowed": get_stat(opp_data, "firstDowns"),
                            "third_down_eff": get_stat(team_data, "thirdDownEff"),
                            "third_down_eff_allowed": get_stat(opp_data, "thirdDownEff"),
                            "total_penalties_yards": get_stat(team_data, "totalPenaltiesYards"),
                            "total_penalties_yards_allowed": get_stat(opp_data, "totalPenaltiesYards"),
                            "possession_time": get_stat(team_data, "possessionTime"),
                            "possession_time_allowed": get_stat(opp_data, "possessionTime"),
                        }
                        raw_stats_list.append(row)
            except Exception as e:
                print(f"Error fetching {yr} week {wk}: {e}")
                continue

    return pd.DataFrame(raw_stats_list)


# --- Feature engineering ---

# convert possession time string "MM:SS" to seconds
def parse_time_sec(time_str):
    if pd.isna(time_str):
        return 1800.0
    parts = str(time_str).split(":")
    if len(parts) == 2:
        return float(parts[0]) * 60 + float(parts[1])
    return 1800.0

#  convert "made-attempts" string like "8-13" into a number
def parse_split_eff(eff_str, pos=0):
    if pd.isna(eff_str):
        return 0.0
    parts = str(eff_str).split("-")
    if len(parts) == 2:
        try:
            return float(parts[pos])
        except ValueError:
            return 0.0
    return 0.0

# begin with raw team-level stats and compute features
# returns dataframe with one row per game rather than row per team
def engineer_features(raw_df):

    df = raw_df.copy()

    # drop missing scores and convert to float
    # drop ties 
    df = df.dropna(subset=["points", "points_allowed"])
    df["points"] = df["points"].astype(float)
    df["points_allowed"] = df["points_allowed"].astype(float)
    df = df[df["points"] != df["points_allowed"]]

    # defining target variable, 1 if team won, 0 if lost
    df["win"] = (df["points"] > df["points_allowed"]).astype(int)

    # split third down efficiency strings ("8-13") into made and attempted
    # pos=0 gives made, pos=1 gives attempted
    df["td_comp"] = df["third_down_eff"].apply(lambda x: parse_split_eff(x, 0))
    df["td_att"] = df["third_down_eff"].apply(lambda x: parse_split_eff(x, 1))
    df["td_comp_opp"] = df["third_down_eff_allowed"].apply(lambda x: parse_split_eff(x, 0))
    df["td_att_opp"] = df["third_down_eff_allowed"].apply(lambda x: parse_split_eff(x, 1))

    # split penality yards strings ("45-60") into yards and attempts
    # pos=0 gives yards, pos=1 gives attempts
    df["pen_yds"] = df["total_penalties_yards"].apply(lambda x: parse_split_eff(x, 1))
    df["pen_yds_opp"] = df["total_penalties_yards_allowed"].apply(lambda x: parse_split_eff(x, 1))

    # convert possession times strings into seconds
    df["top_sec"] = df["possession_time"].apply(parse_time_sec)
    df["top_sec_opp"] = df["possession_time_allowed"].apply(parse_time_sec)

    # compute third down conversion percentages (made / attempted)
    df["third_down_pct"] = np.where(df["td_att"] > 0, df["td_comp"] / df["td_att"], 0.0)
    df["third_down_pct_opp"] = np.where(df["td_att_opp"] > 0, df["td_comp_opp"] / df["td_att_opp"], 0.0)

    # convert columns to numeric, filling missing values with 0.0
    num_cols = [
        "turnovers", "turnovers_allowed", "net_passing_yards",
        "net_passing_yards_allowed", "rushing_yards", "rushing_yards_allowed",
        "first_downs", "first_downs_allowed",
    ]
    for col in num_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)

    # compute differentials — each is (team value) minus (opponent value)
    df["turnover_margin"] = df["turnovers_allowed"] - df["turnovers"]
    df["pass_yards_diff"] = df["net_passing_yards"] - df["net_passing_yards_allowed"]
    df["rush_yards_diff"] = df["rushing_yards"] - df["rushing_yards_allowed"]
    df["first_downs_diff"] = df["first_downs"] - df["first_downs_allowed"]
    df["third_down_pct_diff"] = df["third_down_pct"] - df["third_down_pct_opp"]
    df["penalty_yards_diff"] = df["pen_yds"] - df["pen_yds_opp"]
    df["top_seconds_diff"] = df["top_sec"] - df["top_sec_opp"]
    df["is_home"] = (df["home_away"].str.lower() == "home").astype(int)

    # select every second row to avoid double counting each game (since each game has two rows)
    df = df.iloc[1::2].reset_index(drop=True)

    return df


# features logistic regression mode will use
DIFF_PREDICTORS = [
    "is_home", "turnover_margin", "pass_yards_diff", "rush_yards_diff",
    "first_downs_diff", "third_down_pct_diff", "penalty_yards_diff",
    "top_seconds_diff",
]


# --- Training the model ---
# using 2020-2024 data to train
print("Fetching 2020-2024 training data from CFBD API...")
train_raw = fetch_game_stats(seasons=range(2020, 2025))
print(f"  Fetched {len(train_raw)} raw rows")

# apply feature engineering
train_df = engineer_features(train_raw)
train_df = train_df.dropna(subset=["win"] + DIFF_PREDICTORS)
print(f"  {len(train_df)} games after feature engineering")

# train
X_train = train_df[DIFF_PREDICTORS]
y_train = train_df["win"]

# scale the training data to have mean=0 and std=1 for each feature 
scaler = StandardScaler()
X_train_scaled = pd.DataFrame(
    scaler.fit_transform(X_train),
    columns=DIFF_PREDICTORS,
    index=X_train.index,
)

# sm.add_constant adds a column of 1s for the intercept term
X_train_sm = sm.add_constant(X_train_scaled)

# fit logistic regression model
model = sm.Logit(y_train, X_train_sm).fit(disp=False)
print("\nModel trained. Coefficients:")
print(model.params.to_string())


# --- Testing the model on 2025 data ---
print("\nFetching 2025 game data from CFBD API...")
data_2025_raw = fetch_game_stats(seasons=[2025])
print(f"  Fetched {len(data_2025_raw)} raw rows")

data_2025 = engineer_features(data_2025_raw)
data_2025 = data_2025.dropna(subset=DIFF_PREDICTORS)
print(f"  {len(data_2025)} games after feature engineering")

X_2025 = data_2025[DIFF_PREDICTORS]

# Scale using the training scaler 
X_2025_scaled = pd.DataFrame(
    scaler.transform(X_2025),
    columns=DIFF_PREDICTORS,
    index=X_2025.index,
)
X_2025_sm = sm.add_constant(X_2025_scaled)

# model.predict() returns the probability of win (class=1) for each game
data_2025["win_prob"] = model.predict(X_2025_sm)


# --- Fetch game metadata (team names) using sportsdataverse ---
# the /games/teams endpoint doesn't return school names reliably,
# so we use sportsdataverse which has home_team and away_team columns
# (same approach as HW2 notebook)
print("\nFetching game metadata (team names) from sportsdataverse...")
schedule_polars = sdv.cfb.load_cfb_schedule(seasons=[2025], return_as_pandas=False)
schedule_df = schedule_polars.to_pandas(use_pyarrow_extension_array=False)
game_meta = {}
for _, row in schedule_df.iterrows():
    game_meta[int(row["game_id"])] = {
        "home_team": row["home_team"],
        "away_team": row["away_team"],
    }
print(f"  Got metadata for {len(game_meta)} games")


# --- fetch team colors to color code chart ---
print("\nFetching team colors...")
resp = requests.get(
    "https://api.collegefootballdata.com/teams?division=fbs",
    headers=headers,
    timeout=10,
)
team_colors = {}
if resp.status_code == 200:
    for t in resp.json():
        team_colors[t["school"]] = t.get("color", "333333")
        if team_colors[t["school"]] and not team_colors[t["school"]].startswith("#"):
            team_colors[t["school"]] = "#" + team_colors[t["school"]]

print(f"  Got colors for {len(team_colors)} teams")


# --- Build rows for Supabase ---
# Use game_meta to get team names (since /games/teams doesn't have them)
print("\nBuilding Supabase rows...")
rows = []
for _, game in data_2025.iterrows():
    gid = int(game["game_id"])
    meta = game_meta.get(gid)
    if not meta:
        continue  # skip games we don't have metadata for

    home_team = meta["home_team"]
    away_team = meta["away_team"]

    # Determine win prob from home team's perspective
    if game["home_away"] == "home":
        home_score = int(game["points"])
        away_score = int(game["points_allowed"])
        home_win_prob = round(float(game["win_prob"]), 4)
    else:
        home_score = int(game["points_allowed"])
        away_score = int(game["points"])
        home_win_prob = round(1.0 - float(game["win_prob"]), 4)

    rows.append({
        "game_id": gid,
        "season": 2025,
        "week": int(game["week_num"]),
        "home_team": home_team,
        "away_team": away_team,
        "home_score": home_score,
        "away_score": away_score,
        "home_win_prob": home_win_prob,
        "away_win_prob": round(1.0 - home_win_prob, 4),
        "home_color": team_colors.get(home_team, "#333333"),
        "away_color": team_colors.get(away_team, "#333333"),
    })

print(f"  {len(rows)} games ready to upload")


# --- upload to supabase ---
print("\nUploading to Supabase...")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# upload in batches of 100 to avoid hitting request size limits
batch_size = 100
for i in range(0, len(rows), batch_size):
    batch = rows[i : i + batch_size]
    supabase.table("cfb_win_probs").upsert(batch).execute()
    print(f"  Uploaded batch {i // batch_size + 1} ({len(batch)} rows)")

print(f"\nDone! {len(rows)} games uploaded to Supabase.")
