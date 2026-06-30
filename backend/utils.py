import re


YAHOO_STATS_MAP = {
    12: "pts",
    15: "reb",
    16: "ast",
    17: "stl",
    18: "blk",
    19: "tov",
    10: "fg3m",
    5: "fg",
    8: "ft"
}


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