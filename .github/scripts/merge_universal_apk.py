#!/usr/bin/env python3
"""Merge single-ABI Android APKs into one universal APK.

Each input APK was built from the same source by a separate CI runner, so dex,
resources and the manifest are identical and only lib/<abi>/ differs. The output
is the --base APK plus the lib/<abi>/ entries of every other APK.

The output is NOT signed or aligned: the signature block of the base APK is
dropped (it would be invalid anyway), so run zipalign and apksigner afterwards.

usage: merge_universal_apk.py --base arm64.apk --out merged.apk armv7.apk x86.apk x86_64.apk
"""

import argparse
import re
import sys
import zipfile

# v1 signature files; the v2/v3 signing block lives outside the zip entries and is
# dropped automatically when the archive is rewritten
SIGNATURE_RE = re.compile(r"^META-INF/(MANIFEST\.MF|[^/]+\.(SF|RSA|DSA|EC))$", re.IGNORECASE)


def abi_of(name):
    """lib/<abi>/foo.so -> <abi>, anything else -> None"""
    parts = name.split("/")
    if len(parts) > 2 and parts[0] == "lib":
        return parts[1]
    return None


def libs_by_abi(zf):
    result = {}
    for info in zf.infolist():
        abi = abi_of(info.filename)
        if abi and not info.is_dir():
            result.setdefault(abi, []).append(info)
    return result


def copy_entry(out, info, data):
    # keep each entry's compression: resources.arsc has to stay stored, and the .so files
    # keep whatever packaging the build chose
    clone = zipfile.ZipInfo(info.filename, info.date_time)
    clone.compress_type = info.compress_type
    clone.external_attr = info.external_attr
    out.writestr(clone, data)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", required=True, help="APK whose dex/resources/manifest are kept")
    parser.add_argument("--out", required=True, help="merged APK to write (unsigned, unaligned)")
    parser.add_argument("others", nargs="+", help="APKs whose lib/<abi>/ entries are added")
    args = parser.parse_args()

    with zipfile.ZipFile(args.base) as base:
        base_libs = libs_by_abi(base)
        if not base_libs:
            sys.exit(f"error: {args.base} contains no lib/<abi>/ entries")
        base_manifest = base.getinfo("AndroidManifest.xml").CRC

        seen = set()
        abis = {abi: len(infos) for abi, infos in base_libs.items()}

        with zipfile.ZipFile(args.out, "w") as out:
            for info in base.infolist():
                if SIGNATURE_RE.match(info.filename):
                    continue
                copy_entry(out, info, base.read(info.filename))
                seen.add(info.filename)

            for path in args.others:
                with zipfile.ZipFile(path) as other:
                    other_libs = libs_by_abi(other)
                    if not other_libs:
                        sys.exit(f"error: {path} contains no lib/<abi>/ entries")

                    # a different manifest means a different versionCode/versionName/permissions,
                    # which would make the result inconsistent => refuse instead of guessing
                    if other.getinfo("AndroidManifest.xml").CRC != base_manifest:
                        sys.exit(f"error: AndroidManifest.xml of {path} differs from {args.base}; "
                                 "the APKs were not built from the same source/version")

                    clash = set(other_libs) & set(abis)
                    if clash:
                        sys.exit(f"error: {path} has ABI(s) {sorted(clash)} that are already present")

                    for abi, infos in other_libs.items():
                        for info in infos:
                            if info.filename in seen:
                                sys.exit(f"error: duplicate entry {info.filename} from {path}")
                            copy_entry(out, info, other.read(info.filename))
                            seen.add(info.filename)
                        abis[abi] = len(infos)

    print("merged APK written to", args.out)
    for abi in sorted(abis):
        print(f"  lib/{abi}: {abis[abi]} file(s)")


if __name__ == "__main__":
    main()
