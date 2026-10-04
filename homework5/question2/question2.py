# question 2
# ----------
# find play 2735 from game 2022100210 and create gif of the play

# source code for animation: https://github.com/shammeer-s/nfl-tracks
# The author acknowledges the use of Claude in the completion of this assignment. Claude was used in the following way in this assignment: debugging server setup and python package problems.

import pandas as pd
from nfl import visuals
import glob, socket
import matplotlib
matplotlib.use("Agg")
import pandas as pd
from nfl import visuals
from nfl.config import NFLTracksConfig

# need to install the required packages on my env and on server
# ssh student 'pip install --user nfl_tracks ipython'

# run to get gif
#   ssh student 'python3 -' < question2.py | tee q2_output.txt && scp student:~/play_2022100210_2735.gif .


game = 2022100210
play = 2735

data = "/projects/class/itcs5010_u01/SportsTrackingTransformer/data/BigDataBowl_2024"

games = pd.read_csv(f"{data}/games.csv")
week = games.loc[games['gameId'] == game, "week"].iloc[0]
file = glob.glob(f"{data}/**/tracking_week_{week}.csv", recursive=True)[0]
print("reading", file)
df = pd.read_csv(file)
df = df[(df.gameId == game) & (df.playId == play)].copy()
ball = df[df.club == "football"].sort_values("frameId").iloc[-1]
df["ball_land_x"], df["ball_land_y"] = ball.x, ball.y

teams = [c for c in df.club.unique() if c != "football"]
colors = {teams[0]: "red", teams[1]: "blue", "football": "saddlebrown"}
 
config = NFLTracksConfig(game_col="gameId", play_col="playId", frame_col="frameId",
                         player_id_col="nflId", player_side_col="club")
play = visuals.Play(df, game, play, config=config)
play.animate(save=True, filename=f"play_{game}_{play}.gif", kaggle=False, club_colors=colors)
