"""Download every photo, video and video wish from the wedding app.

Run after the wedding, before downgrading Supabase:
    pip install requests
    python download_all.py https://YOURPROJECT.supabase.co YOUR_SERVICE_ROLE_KEY

The service role key is in Supabase > Project Settings > API Keys (legacy "service_role").
Keep it private: never put it in config.js or on the website.
Files are saved into ./wedding-download/<bucket>/...
"""
import os
import sys

import requests


def list_all(base, headers, bucket, prefix=""):
    out, offset = [], 0
    while True:
        r = requests.post(
            f"{base}/storage/v1/object/list/{bucket}",
            headers=headers,
            json={"prefix": prefix, "limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"}},
            timeout=60,
        )
        r.raise_for_status()
        items = r.json()
        for it in items:
            path = f"{prefix}{it['name']}"
            if it.get("id") is None:  # a folder
                out += list_all(base, headers, bucket, path + "/")
            else:
                out.append(path)
        if len(items) < 1000:
            return out
        offset += 1000


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    base, key = sys.argv[1].rstrip("/"), sys.argv[2]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    for bucket in ("media", "wishes"):
        files = [f for f in list_all(base, headers, bucket) if not f.endswith("_t.jpg")]
        print(f"{bucket}: {len(files)} files")
        for i, path in enumerate(files, 1):
            dest = os.path.join("wedding-download", bucket, path)
            if os.path.exists(dest):
                continue
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with requests.get(f"{base}/storage/v1/object/{bucket}/{path}", headers=headers, stream=True, timeout=600) as r:
                r.raise_for_status()
                with open(dest + ".part", "wb") as fh:
                    for chunk in r.iter_content(1 << 20):
                        fh.write(chunk)
            os.replace(dest + ".part", dest)
            print(f"  {i}/{len(files)} {path}")
    print("Done. Everything is in ./wedding-download")


if __name__ == "__main__":
    main()
