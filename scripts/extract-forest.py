"""Extract the forest subset; run from the project with python -I."""
import argparse
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
from urllib.parse import unquote, urlsplit
import zipfile

MODELS = (
    "CommonTree_1", "CommonTree_3", "Pine_1", "Bush_Common",
    "Rock_Medium_1", "Grass_Common_Short", "Fern_1", "Flower_3_Group",
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("staging", type=Path, help="New, empty source directory")
    parser.add_argument("output", type=Path, help="New public forest directory")
    args = parser.parse_args()
    staging, output = args.staging.resolve(), args.output.resolve()
    if staging == output or staging in output.parents or output in staging.parents:
        parser.error("Staging and output must be separate directories")
    for directory in (staging, output):
        if directory.exists():
            parser.error(f"Refusing to overwrite existing directory: {directory}")
        if not directory.parent.is_dir():
            parser.error(f"Parent directory does not exist: {directory.parent}")

    with zipfile.ZipFile(args.archive) as archive:
        members = archive.infolist()
        names = [member.filename for member in members]
        if len(names) != len(set(names)):
            parser.error("Duplicate archive paths")

        def read(name):
            info = archive.getinfo(name)
            if stat.S_ISLNK(info.external_attr >> 16) or info.file_size > 32 * 1024 * 1024:
                raise ValueError(f"Unsafe archive member: {name}")
            return archive.read(info)

        files = {"License_Standard.txt": read("License_Standard.txt")}
        for model in MODELS:
            name = model + ".gltf"
            data = read("glTF/" + name)
            document = json.loads(data)
            if document.get("asset", {}).get("version") != "2.0" or document.get("extensionsRequired"):
                raise ValueError(f"Unsupported glTF: {name}")
            files[name] = data
            for item in document.get("buffers", []) + document.get("images", []):
                uri = item.get("uri")
                if uri is None:
                    continue
                parts = urlsplit(uri)
                path = PurePosixPath(unquote(parts.path))
                # This pack uses sibling files only. Reject everything else.
                if (parts.scheme or parts.netloc or parts.query or parts.fragment
                        or len(path.parts) != 1 or "\\" in unquote(uri) or ":" in unquote(uri)
                        or path.name in (".", "..") or path.suffix.lower() not in (".bin", ".png")):
                    raise ValueError(f"Unsafe dependency URI: {uri}")
                files[path.name] = read("glTF/" + path.name)
        if sum(map(len, files.values())) > 64 * 1024 * 1024:
            raise ValueError("Forest subset exceeds 64 MiB")

    # Validate the entire subset before creating either destination.
    staging.mkdir()
    for name, data in files.items():
        with (staging / name).open("xb") as file:
            file.write(data)
    shutil.copytree(staging, output)
    print(f"Prepared {len(files)} files ({sum(map(len, files.values())) / 1024**2:.1f} MiB) in {output}")


if __name__ == "__main__":
    main()
