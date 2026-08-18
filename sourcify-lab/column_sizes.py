#!/usr/bin/env python3
"""
sourcify-lab / column_sizes.py -- per-COLUMN byte sizes for every Sourcify table,
read from Parquet footers only. No dataset download, no third-party library.

Why this exists: deciding what can live inside an Arkiv entity and what has to stay
content-addressed off-chain is a question about *field sizes*, not table sizes. The
Parquet footer carries, for every column chunk, `num_values`,
`total_uncompressed_size` and `total_compressed_size`. Summing those per column
gives the real average bytes per value, and the heaviest row group bounds the tail.

Reuses the Thrift compact decoder from exact_rows.py.

Run:  python column_sizes.py            (writes column-sizes.json)

Caveat: averages are exact; the "heaviest block" figure is the worst row-group
average, which is a lower bound on the true single-object maximum, not the maximum
itself. Parquet statistics store min/max *values*, not value lengths, so an exact
per-object maximum cannot be derived from footers alone.
"""
import json, struct, importlib.util, os, concurrent.futures as cf
from collections import defaultdict

_spec = importlib.util.spec_from_file_location(
    "exact_rows", os.path.join(os.path.dirname(os.path.abspath(__file__)), "exact_rows.py"))
ER = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ER)
TC, _get, OBJ = ER.TC, ER._get, ER.OBJ

WORKERS = 12


class Reader(TC):
    """Walks FileMetaData -> row_groups -> columns -> meta_data."""

    def read_str(self):
        n = self.varint()
        s = self.b[self.i:self.i + n]
        self.i += n
        return s.decode("utf8", "replace")

    def column_meta(self):
        """ColumnMetaData: 3=path_in_schema list<string>, 5=num_values, 6=uncompressed, 7=compressed"""
        fid = 0
        path, nv, unc, comp = None, 0, 0, 0
        while True:
            h = self.u8()
            if h == 0:
                return path, nv, unc, comp
            t = h & 0x0F
            fid = self.zigzag() if (h >> 4) == 0 else fid + (h >> 4)
            if fid == 3 and t == TC.LIST:
                hh = self.u8()
                size = hh >> 4
                if size == 15:
                    size = self.varint()
                path = ".".join(self.read_str() for _ in range(size))
            elif fid == 5:
                nv = self.zigzag()
            elif fid == 6:
                unc = self.zigzag()
            elif fid == 7:
                comp = self.zigzag()
            else:
                self.skip(t)

    def column_chunk(self):
        """ColumnChunk: field 3 = meta_data (ColumnMetaData struct)"""
        fid = 0
        out = None
        while True:
            h = self.u8()
            if h == 0:
                return out
            t = h & 0x0F
            fid = self.zigzag() if (h >> 4) == 0 else fid + (h >> 4)
            if fid == 3 and t == TC.STRUCT:
                out = self.column_meta()
            else:
                self.skip(t)

    def row_group(self):
        """RowGroup: 1 = columns list<ColumnChunk>, 3 = num_rows"""
        fid = 0
        cols, nrows = [], 0
        while True:
            h = self.u8()
            if h == 0:
                return cols, nrows
            t = h & 0x0F
            fid = self.zigzag() if (h >> 4) == 0 else fid + (h >> 4)
            if fid == 1 and t == TC.LIST:
                hh = self.u8()
                size = hh >> 4
                if size == 15:
                    size = self.varint()
                for _ in range(size):
                    cols.append(self.column_chunk())
            elif fid == 3:
                nrows = self.zigzag()
            else:
                self.skip(t)

    def row_groups(self):
        """FileMetaData field 4 = list<RowGroup>"""
        fid = 0
        while True:
            h = self.u8()
            if h == 0:
                return []
            t = h & 0x0F
            fid = self.zigzag() if (h >> 4) == 0 else fid + (h >> 4)
            if fid == 4 and t == TC.LIST:
                hh = self.u8()
                size = hh >> 4
                if size == 15:
                    size = self.varint()
                return [self.row_group() for _ in range(size)]
            self.skip(t)


def file_columns(name):
    tail, crange = _get(OBJ + name, "-8")
    total = int(crange.split("/")[1])
    flen = struct.unpack("<I", tail[:4])[0]
    footer, _ = _get(OBJ + name, f"{total - 8 - flen}-{total - 9}")
    return Reader(footer).row_groups()


def main():
    names = ER.list_objects()
    print(f"reading column metadata from {len(names):,} Parquet footers\n")

    acc = defaultdict(lambda: defaultdict(lambda: [0, 0, 0, 0.0]))  # table -> col -> [nv, unc, comp, worst_avg]
    failed = 0
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(file_columns, n): n for n in names}
        done = 0
        for f in cf.as_completed(futs):
            table = futs[f].split("/")[1]
            try:
                for cols, nrows in f.result():
                    for c in cols:
                        if not c:
                            continue
                        path, nv, unc, comp = c
                        e = acc[table][path]
                        e[0] += nv; e[1] += unc; e[2] += comp
                        if nv:
                            e[3] = max(e[3], unc / nv)
            except Exception:                            # noqa: BLE001
                failed += 1
            done += 1
            if done % 500 == 0:
                print(f"  {done:,}/{len(names):,}")

    out = {}
    print(f"\n{'TABLE.COLUMN':<52}{'AVG B/VAL':>11}{'HEAVIEST BLK':>14}{'TOTAL GB':>10}{'ZSTD x':>8}")
    for table in sorted(acc, key=lambda t: -sum(v[1] for v in acc[t].values())):
        cols = acc[table]
        tot = sum(v[1] for v in cols.values())
        out[table] = {"uncompressed_bytes": tot, "columns": {}}
        print(f"\n-- {table}  (uncompressed {tot/1e9:.1f} GB)")
        for col, (nv, unc, comp, worst) in sorted(cols.items(), key=lambda kv: -kv[1][1]):
            avg = unc / nv if nv else 0
            ratio = unc / comp if comp else 0
            out[table]["columns"][col] = {"num_values": nv, "uncompressed_bytes": unc,
                                          "compressed_bytes": comp, "avg_bytes_per_value": round(avg, 1),
                                          "heaviest_rowgroup_avg_bytes": round(worst, 1)}
            print(f"   {col:<49}{avg:>11,.0f}{worst:>14,.0f}{unc/1e9:>10.2f}{ratio:>8.1f}")

    with open("column-sizes.json", "w") as fh:
        json.dump(out, fh, indent=2)
    print(f"\nwrote column-sizes.json  (failed files: {failed})")


if __name__ == "__main__":
    main()
