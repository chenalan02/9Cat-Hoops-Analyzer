import re

EMA_STATS = [
    "mu_min",
    "mu_pts",
    "var_pts",
    "mu_reb",
    "var_reb",
    "mu_ast",
    "var_ast",
    "mu_blk",
    "var_blk",
    "mu_stl",
    "var_stl",
    "mu_tov",
    "var_tov",
    "mu_fg3m",
    "var_fg3m",
    "mu_fga",
    "var_fga",
    "mu_fgm",
    "var_fgm",
    "mu_fta",
    "var_fta",
    "mu_ftm",
    "var_ftm",
    "games_played"
]

def clean_player_name(name):
    if name is None:
        return None

    # 1. Map common accented characters to normal ones
    accents = "āīūģķļņćčšžđáéíóúñçåøöäėëüĀĪŪĢĶĻŅĆČŠŽĐÁÉÍÓÚÑÇÅØÖÄĖËÜ"
    normals = "aiugklnccszdaeiouncaooaeeuAIUGKLNCCSZDAEIOUNCAOAAEEU"
    
    # Create a translation table
    trans_table = str.maketrans(accents, normals)
    name = name.translate(trans_table)

    # 2. Suffix removal
    # Using re.IGNORECASE makes it more robust than the Spark version
    suffix_pat = r"\s+(Jr\.?|Sr\.?|III|II|IV|V)$"
    name = re.sub(suffix_pat, "", name, flags=re.IGNORECASE)

    # 3. Non-alphanumeric cleaning
    # Note: the hyphen is placed at the end of the set to avoid being treated as a range
    char_pat = r"[^a-zA-Z0-9 '-]"
    name = re.sub(char_pat, "", name)

    # 4. Trim and return
    return name.strip()