"""Dump education entries of the latest resume."""
import json
import sqlite3

conn = sqlite3.connect("data/dev.db")
row = conn.execute(
    "select parsed_data, parse_input_tokens, parse_output_tokens, parsed_data_version "
    "from resumes order by created_at desc limit 1",
).fetchone()
data = json.loads(row[0])
print("version:", row[3], "in:", row[1], "out:", row[2])
print()
print("basic_info.parse_warnings:", data["basic_info"].get("parse_warnings"))
print()
print("=== education ===")
for e in data["education"]:
    print(json.dumps(e, ensure_ascii=False, indent=2))
    print()
