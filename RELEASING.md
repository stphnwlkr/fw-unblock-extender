# Releasing Unblock Extender

1. Update the plugin header and `VERSION` in `fw-unblock-extender.php`.
2. Update `Stable tag` and add the newest changelog entry to `readme.txt`.
3. Run `python3 scripts/build-release.py X.Y.Z`. Check that `dist/fw-unblock-extender.zip` installs and works on a test site.
4. Commit and push to `main`. In GitHub, open **Actions → Publish release → Run workflow**, select `main`, and enter `X.Y.Z`. You can also push a tag named `X.Y.Z` at the release commit.
5. Verify the published release has both `fw-unblock-extender.zip` and `update.json`. The workflow attaches both assets before publishing the release. WordPress checks the latest published release and downloads the ZIP attached to its exact version.

Use increasing stable versions for this workflow. The ZIP installs under `fw-unblock-extender/` and contains only the plugin files.
