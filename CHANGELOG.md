# Changelog

All notable changes to the Audience Data Commons schema are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the standard is versioned with [Semantic Versioning](https://semver.org/spec/v2.0.0.html). See the [versioning policy](README.md#versioning-policy) for what counts as a major, minor or patch change to a data model.

## [Unreleased]

## [1.0.0] - Unreleased

First standalone release of the ADC schema. The data model and taxonomies are identical to those shipped inside the Schema Mapping CLI up to and including its version 2.2.0; this release moves them into their own repository and package so that the standard can be cited, versioned and adopted independently of any one tool.

### Added

- `schema/adc.schema.jsonld` — the ADC data model (`person`, `object`, `action`), previously `examples/schema.jsonld` in the CLI repository. The file gains three metadata fields and nothing else: `$id` (its version-pinned raw URL), `version`, and a `$comment` naming the vocabularies it builds on.
- `taxonomies/` — the eight controlled vocabularies (`ActionType-v1`, `AgeGroup-v1`, `ConsentType-v1`, `DonorStatus-v1`, `EducationLevel-v1`, `Gender-v1`, `IncomeBracket-v1`, `ObjectType-v1`), moved unchanged.
- `scripts/validate.mjs` — the release gate: JSON-LD well-formedness, every `enumFromTaxonomy` reference resolves, unique `notation` and `value` per taxonomy, schema version matches the package version. `npm test` proves it fails on a broken reference and on a duplicate notation.
- npm package `@npa-ai-co-lab/adc-schema` exposing the schema and taxonomies through an `exports` map.
- CI: validation on every pull request; on a `v*` tag, publish to npm and attach `adc-schema-<version>.zip` to a GitHub Release for consumers that do not use npm.
- README describing the model, how to read a property definition, how to use the schema without any tooling, and the versioning policy.

### Changed

- Nothing in the data model. No property, entity, constraint or taxonomy value was added, removed or renamed.
