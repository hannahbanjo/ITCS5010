# Homework Solution
The author(s) acknowledges the use of Claude in the preparation or completion of this assignment. Claude was used in the following way(s) in this assignment: debugging, code generation.

## Answer
2026 accuracy on completed games (254 games): 65.0%

## Sample Code
```
# get 2026 data 
raw_2026 = []
data_2026 = betting_api.get_lines(year=2026)
for game in data_2026:
    if game.home_conference not in P4_CONFERENCES or game.away_conference not in P4_CONFERENCES:
        continue
    for line in game.lines:
        raw_2026.append({
            'game_id': game.id,
            'season': game.season,
            'week': game.week,
            'home_team': game.home_team,
            'away_team': game.away_team,
            'home_score': game.home_score,
            'away_score': game.away_score,
            'home_conference': game.home_conference,
            'away_conference': game.away_conference,
            'provider': line.provider,
            'spread': line.spread,
            'over_under': line.over_under,
        })

df_2026 = (
    pd.DataFrame(raw_2026)
    .groupby(['game_id', 'season', 'week', 'home_team', 'away_team',
              'home_score', 'away_score', 'home_conference', 'away_conference'])
    .agg(spread=('spread', 'median'), over_under=('over_under', 'median'))
    .reset_index()
)
df_2026['actual_margin'] = df_2026['home_score'] - df_2026['away_score']
df_2026['covered'] = df_2026['actual_margin'] + df_2026['spread'] > 0

# get sp+ ratings
sp_2026 = ratings_api.get_sp(year=2026)
sp_2026_df = pd.DataFrame([{
    'season': 2026, 'team': r.team,
    'sp_rating': r.rating, 'sp_offense': r.offense.rating, 'sp_defense': r.defense.rating
} for r in sp_2026])

df_2026 = df_2026.merge(
    sp_2026_df.rename(columns={'team': 'home_team', 'sp_rating': 'home_sp',
                                'sp_offense': 'home_sp_off', 'sp_defense': 'home_sp_def'}),
    on=['season', 'home_team'], how='left'
).merge(
    sp_2026_df.rename(columns={'team': 'away_team', 'sp_rating': 'away_sp',
                                'sp_offense': 'away_sp_off', 'sp_defense': 'away_sp_def'}),
    on=['season', 'away_team'], how='left'
)
df_2026['sp_diff'] = df_2026['home_sp'] - df_2026['away_sp']

# get 2026 elo
elo_2026_rows = []
for week in range(1, 17):
    try:
        data = ratings_api.get_elo(year=2026, week=week)
        for r in data:
            if r.elo:
                elo_2026_rows.append({'season': 2026, 'week': week, 'team': r.team, 'elo': r.elo})
    except Exception:
        break
elo_2026_df = pd.DataFrame(elo_2026_rows)
elo_prev_2026 = elo_2026_df.copy()
elo_prev_2026['week'] = elo_prev_2026['week'] + 1

df_2026 = df_2026.merge(
    elo_prev_2026.rename(columns={'team': 'home_team', 'elo': 'home_elo'})[['season','week','home_team','home_elo']],
    on=['season','week','home_team'], how='left'
).merge(
    elo_prev_2026.rename(columns={'team': 'away_team', 'elo': 'away_elo'})[['season','week','away_team','away_elo']],
    on=['season','week','away_team'], how='left'
)
df_2026['elo_diff'] = df_2026['home_elo'] - df_2026['away_elo']

# get rolling win percentages
home_r = df_2026[['game_id','season','week','home_team','actual_margin']].copy()
home_r.columns = ['game_id','season','week','team','margin']
home_r['won'] = home_r['margin'] > 0
away_r = df_2026[['game_id','season','week','away_team','actual_margin']].copy()
away_r.columns = ['game_id','season','week','team','margin']
away_r['won'] = away_r['margin'] < 0
rec_2026 = pd.concat([home_r, away_r]).sort_values(['team','season','week'])
rec_2026['cum_wins']  = rec_2026.groupby(['team','season'])['won'].cumsum().shift(1).fillna(0)
rec_2026['cum_games'] = rec_2026.groupby(['team','season']).cumcount()
rec_2026['win_pct']   = rec_2026.apply(
    lambda r: r['cum_wins'] / r['cum_games'] if r['cum_games'] > 0 else 0.5, axis=1
)
df_2026 = df_2026.merge(
    rec_2026[['game_id','team','win_pct']].rename(columns={'team':'home_team','win_pct':'home_win_pct'}),
    on=['game_id','home_team'], how='left'
).merge(
    rec_2026[['game_id','team','win_pct']].rename(columns={'team':'away_team','win_pct':'away_win_pct'}),
    on=['game_id','away_team'], how='left'
)
df_2026['win_pct_diff'] = df_2026['home_win_pct'] - df_2026['away_win_pct']
df_2026['is_conf_game'] = (df_2026['home_conference'] == df_2026['away_conference']).astype(int)

# predict
pred_df = df_2026.dropna(subset=['home_sp', 'away_sp', 'home_elo', 'away_elo',
                                  'home_win_pct', 'away_win_pct']).copy()
X_2026 = pred_df[FEATURES].values
pred_df['cover_prob'] = model.predict_proba(X_2026)[:, 1]
pred_df['prediction'] = pred_df['cover_prob'].apply(
    lambda p: 'Home Covers' if p >= 0.5 else 'Away Covers'
)
pred_df['confidence'] = (pred_df['cover_prob'] - 0.5).abs()

# accuracy on games completed thus far
completed = pred_df.dropna(subset=['home_score', 'away_score'])
acc_2026 = accuracy_score(completed['covered'].astype(int),
                           (completed['cover_prob'] >= 0.5).astype(int))
print(f'2026 P4 games fetched: {len(df_2026)}')
print(f'2026 accuracy on completed games ({len(completed)} games): {acc_2026:.1%}')
print(f'Breakeven for profitability: 52.4%')
```