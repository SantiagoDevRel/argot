#!/usr/bin/env python3
"""
sourcify-lab / exact_rows.py — EXACT row counts for every table in Sourcify's
public Parquet export, without downloading the dataset and without any
third-party library.

How: each Parquet file ends with [footer_bytes][uint32 footer_len]["PAR1"].
The footer is a Thrift *compact protocol* FileMetaData struct whose field 3 is
`num_rows`. We HTTP-Range the last 8 bytes to learn the footer length, Range
the footer itself (tens of KB), and decode just enough Thrift to read field 3.

Two range requests per file, ~2,700 files, nothing else transferred. Total
traffic is a few hundred MB of footers at most, versus 170 GB for the dataset.

Why this matters: the file NAMES encode an export row counter, not live rows,
and the two disagree (see README). num_rows in the footer is ground truth for
what the export actually contains.

Run:  python exact_rows.py            (writes exact-row-counts.json)
"""
import json, struct, urllib.request, urllib.error, concurrent.futures as cf
from collections import defaultdict

BUCKET = "sourcify-production-parquet-export"
LIST = f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o"
OBJ = f"https://storage.googleapis.com/{BUCKET}/"
WORKERS = 12
RETRIES = 3


# ---------------------------------------------------------------- thrift compact
class TC:
    """Minimal Thrift compact-protocol reader: enough to walk a struct and skip
    any field type until we reach the one we want."""

    STOP, TRUE, FALSE, BYTE, I16, I32, I64, DOUBLE, BINARY, LIST, SET, MAP, STRUCT = range(13)

    def __init__(self, buf):
        self.b = buf
        self.i = 0

    def u8(self):
        v = self.b[self.i]
        self.i += 1
        return v

    def varint(self):
        shift = res = 0
        while True:
            byte = self.u8()
            res |= (byte & 0x7F) << shift
            if not byte & 0x80:
                return res
            shift += 7

    def zigzag(self):
        n = self.varint()
        return (n >> 1) ^ -(n & 1)

    def skip(self, t):
        if t in (TC.TRUE, TC.FALSE):
            return
        if t == TC.BYTE:
            self.i += 1
        elif t in (TC.I16, TC.I32, TC.I64):
            self.zigzag()
        elif t == TC.DOUBLE:
            self.i += 8
        elif t == TC.BINARY:
            # NB: `self.i += self.varint()` is wrong -- augmented assignment reads
            # self.i before varint() advances it, swallowing one byte.
            n = self.varint()
            self.i += n
        elif t in (TC.LIST, TC.SET):
            h = self.u8()
            size, et = h >> 4, h & 0x0F
            if size == 15:
                size = self.varint()
            for _ in range(size):
                self.skip(et)
        elif t == TC.MAP:
            size = self.varint()
            if size:
                h = self.u8()
                kt, vt = h >> 4, h & 0x0F
                for _ in range(size):
                    self.skip(kt)
                    self.skip(vt)
        elif t == TC.STRUCT:
            self.struct_skip()
        else:
            raise ValueError(f"unknown thrift type {t}")

    def struct_skip(self):
        fid = 0
        while True:
            h = self.u8()
            if h == 0:
                return
            t = h & 0x0F
            delta = h >> 4
            fid = self.zigzag() if delta == 0 else fid + delta
            self.skip(t)

    def num_rows(self):
        """Walk the top-level FileMetaData struct and return field 3 (i64 num_rows)."""
        fid = 0
        while True:
            h = self.u8()
            if h == 0:
                raise ValueError("num_rows (field 3) not found in footer")
            t = h & 0x0F
            delta = h >> 4
            fid = self.zigzag() if delta == 0 else fid + delta
            if fid == 3:
                return self.zigzag()
            self.skip(t)


# ---------------------------------------------------------------- http
def _get(url, rng):
    req = urllib.request.Request(url, headers={"Range": f"bytes={rng}"})
    last = None
    for _ in range(RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read(), r.headers.get("Content-Range")
        except Exception as e:                      # noqa: BLE001 - transient GCS errors
            last = e
    raise last


def file_rows(name):
    tail, crange = _get(OBJ + name, "-8")
    if tail[4:] != b"PAR1":
        raise ValueError(f"{name}: not a parquet file")
    total = int(crange.split("/")[1])
    flen = struct.unpack("<I", tail[:4])[0]
    start = total - 8 - flen
    footer, _ = _get(OBJ + name, f"{start}-{total - 9}")
    return TC(footer).num_rows()


def list_objects():
    names, token = [], ""
    while True:
        url = f"{LIST}?prefix=v2/&fields=items(name),nextPageToken&maxResults=1000"
        if token:
            url += f"&pageToken={token}"
        with urllib.request.urlopen(url, timeout=60) as r:
            page = json.load(r)
        names += [o["name"] for o in page.get("items", []) if o["name"].endswith(".parquet")]
        token = page.get("nextPageToken")
        if not token:
            return names


# ---------------------------------------------------------------- main
def main():
    names = list_objects()
    print(f"parquet files: {len(names):,}  — reading footers with {WORKERS} workers\n")

    rows = defaultdict(int)
    files = defaultdict(int)
    failed = []
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(file_rows, n): n for n in names}
        done = 0
        for f in cf.as_completed(futs):
            n = futs[f]
            table = n.split("/")[1]
            try:
                rows[table] += f.result()
                files[table] += 1
            except Exception as e:                  # noqa: BLE001
                failed.append((n, str(e)[:70]))
            done += 1
            if done % 400 == 0:
                print(f"  {done:,}/{len(names):,}")

    print(f"\n{'TABLE':<32}{'EXACT ROWS':>16}{'FILES':>8}")
    for t in sorted(rows, key=lambda k: -rows[k]):
        print(f"{t:<32}{rows[t]:>16,}{files[t]:>8}")
    if failed:
        print(f"\n!! {len(failed)} file(s) failed:")
        for n, e in failed[:5]:
            print("   ", n, e)

    out = {"source": f"gs://{BUCKET}/v2 parquet footers (num_rows)",
           "files_read": sum(files.values()), "failed": len(failed),
           "rows": dict(sorted(rows.items(), key=lambda kv: -kv[1]))}
    with open("exact-row-counts.json", "w") as fh:
        json.dump(out, fh, indent=2)
    print("\nwrote exact-row-counts.json")


if __name__ == "__main__":
    main()
