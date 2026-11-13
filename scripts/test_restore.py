"""Verifica integridad, rutas y frescura de los respaldos entre ejecuciones."""

import copy
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from restore_snapshots import restore_bundle, unpack_archive
from update_all import ROOT, read_json


class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.dataset = read_json(ROOT / "data/cache/ipi.json")
        self.files = {"ipi.json": json.dumps(self.dataset).encode()}

    def tearDown(self):
        self.directory.cleanup()

    def test_valid_archive_recovers_all_observations(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("ipi.json", self.files["ipi.json"])
        files = unpack_archive(buffer.getvalue(), {"ipi"})
        self.assertEqual(restore_bundle(files, self.root, {"ipi"}), 1)
        self.assertEqual(read_json(self.root / "data/cache/ipi.json"), self.dataset)

    def test_corrupt_hash_does_not_replace_valid_cache(self):
        restore_bundle(self.files, self.root, {"ipi"})
        corrupted = copy.deepcopy(self.dataset)
        corrupted["observations"][0]["value"] += 1
        with self.assertRaises(ValueError):
            restore_bundle(
                {"ipi.json": json.dumps(corrupted).encode()}, self.root, {"ipi"}
            )
        self.assertEqual(read_json(self.root / "data/cache/ipi.json"), self.dataset)

    def test_old_snapshot_cannot_replace_more_recent_verification(self):
        restore_bundle(self.files, self.root, {"ipi"})
        older = {**self.dataset, "lastSuccessfulFetchAt": "2020-01-01T00:00:00Z"}
        self.assertEqual(
            restore_bundle(
                {"ipi.json": json.dumps(older).encode()}, self.root, {"ipi"}
            ),
            0,
        )
        self.assertEqual(read_json(self.root / "data/cache/ipi.json"), self.dataset)

    def test_traversal_and_extra_files_are_rejected(self):
        for name in ["../ipi.json", "data/cache/ipi.json", "unrelated.json"]:
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w") as archive:
                archive.writestr(name, self.files["ipi.json"])
            with self.assertRaises(ValueError):
                unpack_archive(buffer.getvalue(), {"ipi"})

    def test_incomplete_bundle_leaves_cache_untouched(self):
        with self.assertRaises(ValueError):
            restore_bundle(self.files, self.root, {"ipi", "emae"})
        self.assertFalse((self.root / "data/cache/ipi.json").exists())


if __name__ == "__main__":
    unittest.main()
