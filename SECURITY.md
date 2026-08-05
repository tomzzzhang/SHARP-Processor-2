# Security and confidentiality

**Last Updated:** 2026-08-05 15:52 EDT

This is a public repository. Do not commit or mention confidential third-party
information here, including organization or contact names, private project or
assay identifiers, real data filenames, private-storage paths, raw data, or
screenshots and generated archives that contain any of those details.

Use neutral descriptions such as “private validation fixture.” Keep the actual
data, provenance, and internal planning record in approved private storage.

## Required local privacy gate

Every development checkout must have a private denylist at
`.git/info/privacy-denylist`, with one confidential identifier per line. The
file must never be committed or copied into a public artifact.

`npm install` configures this repository’s pre-commit and pre-push hooks. Both
hooks run `npm run privacy:check`; a push is blocked if the private denylist is
missing or if any tracked file, packaged Agent Skill, commit message, branch,
tag, or reachable historical blob contains a listed identifier. CI separately
checks for structural leaks such as private machine paths and dated fixture
filenames.

If confidential content reaches the public repository, stop publishing,
rewrite every affected branch and tag, replace any generated or release
artifact that contains it, and verify the remote again before resuming work.
