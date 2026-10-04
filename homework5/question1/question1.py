# question 1
# ---------------------
# find the modified score on games2.csv
# find the original score on games.csv


# running on server
# ------------------
# run this from inside my homework5 folder
# ssh student 'python3 -' < question1.py > q1_output.txt

import csv
import socket
import os
import datetime

# location of data files in server
data = "/projects/class/itcs5010_u01/SportsTrackingTransformer/data/BigDataBowl_2024"

print("Host:", socket.gethostname())
print("Run at:", datetime.datetime.now())

for name in ["games.csv", "games2.csv"]:
    path = os.path.join(data, name)
    print(f"\n{path}")
    with open(path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            teams = {row['homeTeamAbbr'], row["visitorTeamAbbr"]}
            if row["week"] == "6" and teams == {"LAC", "DEN"}:
                print(row)