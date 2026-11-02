#!/usr/bin/env python3
import base64, json, pathlib
root = pathlib.Path(__file__).resolve().parent
data = json.loads((root/"png.b64.json").read_text())
for rel, b64 in data.items():
    out = root.parent / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(base64.b64decode(b64))
    print("wrote", out)
