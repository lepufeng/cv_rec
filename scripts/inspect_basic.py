"""Quick peek at basic_info of the most recently created resume."""
import json
import sqlite3
import sys

conn = sqlite3.connect("data/dev.db")
row = conn.execute(
    "select id, original_filename, parsed_data from resumes order by created_at desc limit 1",
).fetchone()
if not row:
    sys.exit("no resumes")
rid, fn, raw = row
print("id:", rid)
print("file:", fn)
data = json.loads(raw)
bi = data.get("basic_info", {})
print("basic_info:")
for k in ("name", "phone", "email", "age", "gender", "birth_date", "location", "hometown"):
    print(f"  {k}: {repr(bi.get(k))}")
