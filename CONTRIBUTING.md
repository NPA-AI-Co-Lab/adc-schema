# Contributing to the ADC Schema

Thank you for helping to improve the Audience Data Commons. This repository holds a *standard*, not an application, so contributing to it works a little differently from contributing to code: the bar for changing the data model is deliberately high, while fixes to documentation and tooling are welcome any time.

## What kind of change is it?

**Documentation and tooling** — README wording, examples, the validator, CI. Open a pull request directly. These changes never bump the major or minor version.

**A change to the data model** — adding, removing or renaming a property or entity, changing a type, a constraint, a description that changes meaning, or any change to a taxonomy. These are rare and deliberate. They affect every newsroom and every tool that has adopted the schema, and they need review from both data and newsroom stakeholders. Please:

1. Open an issue first. Describe the problem the change solves, the records it affects, and the proposed definition. Say which [version bump](README.md#versioning-policy) you believe it is.
2. Wait for maintainers to agree the direction before writing the pull request. This saves everyone effort when a proposal needs reshaping.
3. In the pull request, change the schema or taxonomy, bump `version` in both `schema/adc.schema.jsonld` and `package.json`, and add an entry to `CHANGELOG.md` under *Unreleased*.

Removing or renaming a taxonomy value is a breaking change. It is done by adding a new taxonomy file with a bumped suffix (`Gender-v2.json`) and pointing the schema at it, never by editing values in place.

## Before you start

- You need [Node.js](https://nodejs.org/) **18 or newer**. The repository has no dependencies to install.
- Fork the repository and create a branch for your change (`feature/short-description`).
- Never commit real personal data, not even in examples. Use clearly synthetic values.

## Validating your change

```sh
npm run validate   # the release gate: schema well-formed, every taxonomy reference resolves, notations and values unique
npm test           # self-test of the validator
```

Both must pass locally before you open a pull request; CI runs them on every pull request and blocks merging otherwise. If you changed the validator itself, add or adjust a case in `scripts/validate.test.mjs`.

## Submitting a pull request

- Keep it focused: one model change, or one documentation topic, per pull request.
- Reference the issue it resolves (`Fixes #12`). Model changes without a prior issue will be asked to open one.
- Explain what the change means for existing data and for consumers such as the Schema Mapping CLI.
- Update `README.md` if a property table, taxonomy list or example is affected — the tables are the public reference for the standard and must match the schema exactly.
- Add a `CHANGELOG.md` entry.

## Review expectations

- Maintainers aim to respond within a few business days. Feel free to nudge the thread after that.
- Model changes will be held until the relevant stakeholders have had a chance to comment; documentation fixes are merged as soon as they are reviewed.
- Push follow-up commits rather than force-pushing, unless a reviewer asks you to squash.

## Releasing

Only maintainers release. A release is a tag `v<version>` on `main` where `<version>` equals the `version` in `package.json` and in the schema. The release workflow validates, publishes `@npa-ai-co-lab/adc-schema` to npm, and attaches `adc-schema-<version>.zip` (schema, taxonomies, licence and docs) to a GitHub Release so that consumers who do not use npm can download the files directly. A tag whose version does not match `package.json` fails the workflow and publishes nothing.

## Reporting issues

Search existing issues first. For a problem with the model, quote the property or taxonomy and describe the data that does not fit. For a problem with the validator or CI, include the command you ran, the output, and your Node.js version.

## Security and privacy

If a proposed example or fixture contains, or could reveal, real personal data, do **not** open a public issue. Contact the maintainers privately via the repository owners on GitHub, or at hello@newsproduct.org.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to uphold it.
