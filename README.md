# Audience Data Commons (ADC) Schema

The **Audience Data Commons** is an open data model for newsroom audience data. It describes three kinds of things — the **people** in an audience, the **objects** they interact with (articles, newsletters, surveys) and the **actions** that connect the two — in a form that different newsrooms and different tools can produce and consume without bespoke integration work.

This repository is the standard itself: one JSON-LD schema file and the controlled vocabularies it refers to. It contains no application code. Tools that read or write ADC data, such as the [Schema Mapping CLI](https://github.com/NPA-AI-Co-Lab/schema-mapping-cli), are *consumers* of this repository and live elsewhere.

> **Status:** version **1.0.0**. The model is stable; changes follow the [versioning policy](#versioning-policy) below. A few known issues in how the `@context` maps properties to IRIs are listed under [Known issues](#known-issues-to-be-addressed-in-11).

## Contents

```
schema/adc.schema.jsonld   the data model: three entities, their properties, and the @context
taxonomies/*.json          eight controlled vocabularies referenced from the schema
scripts/validate.mjs       the validation gate that every change must pass
```

| File | What it is |
|---|---|
| `schema/adc.schema.jsonld` | The ADC data model. JSON-LD `@context` mapping every property onto [schema.org](https://schema.org/) or [W3C Activity Streams 2.0](https://www.w3.org/TR/activitystreams-vocabulary/) terms, plus the definitions of the `person`, `object` and `action` entities. |
| `taxonomies/ActionType-v1.json` | Kinds of audience action (`web_read`, `newsletter_open`, `donation_made`, …) |
| `taxonomies/AgeGroup-v1.json` | Age groups |
| `taxonomies/ConsentType-v1.json` | How consent was obtained |
| `taxonomies/DonorStatus-v1.json` | Donor status |
| `taxonomies/EducationLevel-v1.json` | Education levels |
| `taxonomies/Gender-v1.json` | Gender |
| `taxonomies/IncomeBracket-v1.json` | Income brackets |
| `taxonomies/ObjectType-v1.json` | Kinds of object (`article`, `newsletter`, `survey`, `survey_response`) |

## The data model

ADC describes an audience as a graph of three entity types. A **person** performs **actions** on **objects**. Every record, whichever entity it belongs to, carries a `dataSource` saying where it came from.

```
        person  ──── action ────▶  object
   (who: userID)   (what happened,   (what: objectID — usually a URL)
                    when, how long)
```

### `person`

A member of the audience: a reader, subscriber, donor, survey respondent. Identified by `userID`, which is the entity's `idProp` — the property that becomes the `@id` of the record in JSON-LD output. Contact details, an engagement score, consent, and optional demographic, location, behaviour and interest facets. `@type` is `schema:Person`.

| Property | Type | Required | Constraints | Maps to | Description |
|---|---|---|---|---|---|
| `userID` | string | yes |  | `identifier` | Global user ID |
| `givenName` | string |  |  | `givenName` | First name of the user |
| `familyName` | string |  |  | `familyName` | Last name of the user |
| `primaryEmail` | string |  |  | `email` | The primary contact address for the user. If the user has authenticated, this should be supplied. Otherwise it will be blank or undefined. |
| `additionalEmails` | array of string |  |  | `email` | An array of additional addresses, for the purposes of matching. |
| `engagementScore` | number |  | 1 – 5 | `ratingValue` | A numeric score from 1-5 representing the user's engagement with the newsroom's content. |
| `tags` | array of string |  |  | `keywords` | An array of tags that could also represent MailChimp lists. |
| `dataSource` | string | yes |  | `isBasedOn` | Where this record originated |
| `consentDate` | string |  | RFC 3339 date-time | `dateCreated` | Date-time when user gave consent, e.g. `2023-06-25T14:33:42Z` |
| `consentType` | string |  | taxonomy `ConsentType-v1` | `category` | The type of consent the user has given |
| `demographics` | object |  |  | — | Demographic facets |
| `demographics.ageGroup` | string |  | taxonomy `AgeGroup-v1` | `ageGroup` | Age group of the user |
| `demographics.gender` | string |  | taxonomy `Gender-v1` | `gender` | Gender of the user |
| `demographics.educationLevel` | string |  | taxonomy `EducationLevel-v1` | `educationLevel` | Education level of the user |
| `demographics.incomeBracket` | string |  | taxonomy `IncomeBracket-v1` | `incomeBracket` | Income bracket of the user |
| `location` | object |  |  | — | Location facets |
| `location.postalCode` | string |  |  | `postalCode` | A deliberately freeform field that can take postal code in a variety of local forms. (US zip codes are numeric, but national systems vary.) |
| `location.addressCountry` | string |  |  | `addressCountry` | Two-letter ISO 3166-1 country code |
| `location.addressLocality` | string |  |  | `addressLocality` | City or locality |
| `behavior` | object |  |  | — | Behavioural facets |
| `behavior.donorStatus` | string |  | taxonomy `DonorStatus-v1` | `category` | An indicator whether the user is a donor. Consider minor donor to be below $100, above that - major donor. |
| `behavior.lastDonationDate` | string |  | RFC 3339 date-time | `dateCreated` | Date-time representing when the user last donated |
| `interests` | object |  |  | — | Interest facets |
| `interests.topics` | array of string |  |  | `topics` | An array of topics that the user is interested in. |
| `interests.commentedOn` | array of string |  |  | `commentedOn` | An array of topics that the user has commented on. |

### `object`

A thing a person can interact with: an article, a newsletter edition, a survey, or a single survey response. Identified by `objectID` (the `idProp`), which is almost always a URL. `@type` is `schema:Object`.

| Property | Type | Required | Constraints | Maps to | Description |
|---|---|---|---|---|---|
| `objectID` | string | yes | URL pattern | `identifier` | This could potentially be a hashed uuid, but most commonly will be a URI, for example the URL for an article or survey. If not immediately obvious and present in correct format, do not try to imagine / infer it - leave it as null. |
| `title` | string |  |  | `name` | The plaintext name of the object. |
| `type` | string |  | taxonomy `ObjectType-v1` | `category` | Kind of object |
| `subType` | string |  |  | `additionalType` | Text field to allow for further granularity in types, for analysis rather than parsing purposes. |
| `published` | string | yes | RFC 3339 date-time | `datePublished` | Date-time when the item was created, e.g. `2023-06-25T14:33:42Z` |
| `subject` | array of string |  |  | `keywords` | An array of tags or subjects that describe the object. |
| `responses` | array of object |  |  | `about` | Survey responses as an array of question/answer pair objects. Required for `survey_response` objects. |
| `responses[].question` | string | yes |  | `question` | The survey question text |
| `responses[].answer` | string | yes |  | `answer` | The user's response to the question. Is string, but answers may be in any format (e.g. 'Yes', 'TRUE', '5', free text). It may even be empty if the user skipped the question. |
| `dataSource` | string | yes |  | `isBasedOn` | Where this record originated |

### `action`

One event: a person did something to an object at a point in time. `action` has no `idProp` of its own; it is the edge of the graph and points at a `person` (via `person`, holding that person's `userID`) and an `object` (via `object`, holding that object's `objectID`). `@type` is `schema:Action`.

| Property | Type | Required | Constraints | Maps to | Description |
|---|---|---|---|---|---|
| `actionType` | string |  | taxonomy `ActionType-v1` | `actionType` | Represents the action type and the platform being used. |
| `person` | string | yes |  | `identifier` | The globally unique id of the person performing the action. Most likely the `userID` from the person entity. |
| `object` | string | yes | URL pattern | `identifier` | The globally unique id of the object the action is being performed on. |
| `referrer` | string |  |  | `activitystream:origin` | The URI of the page that sent the user to conduct the action. If not known, this field should be blank or undefined. |
| `published` | string | yes | `date-time` | `datePublished` | Date-time when the action occurred, e.g. `2023-06-25T14:33:42Z` |
| `timeSpent` | string |  | ISO 8601 duration | `duration` | The amount of time the user spent on the object. |
| `completionRate` | number |  | 0 – 1 | `value` | The portion of a resource completed (e.g., an article read or a survey answered). |
| `dataSource` | string | yes |  | `isBasedOn` | Where this record originated |
| `deviceContext` | object |  |  | — | Device facets |
| `deviceContext.userAgent` | string |  |  | `instrument` | A string describing the software used by the user (eg a browser user agent or mobile app signature). |

In the *Maps to* column, a bare term such as `identifier` is `https://schema.org/identifier`; `activitystream:origin` is `https://www.w3.org/ns/activitystreams#origin`. See the next section for how that mapping works.

## How to read a property definition

The schema file has two parts.

**`@context`** is a standard JSON-LD context. It declares `https://schema.org/` as the default vocabulary (`@vocab`) and the `activitystream` prefix for Activity Streams 2.0, then maps ADC property names onto terms from those vocabularies where the ADC name differs from the vocabulary term — `primaryEmail` → `email`, `published` → `datePublished`, `referrer` → `activitystream:origin`, and so on. A property that is *not* listed in `@context`, such as `givenName` or `postalCode`, resolves through `@vocab` to the schema.org term of the same name. This is what lets an ADC record be read by any JSON-LD processor as linked data.

**`entities`** defines the three entity types. Each entity has:

| Key | Meaning |
|---|---|
| `@type` | The schema.org type of the entity (`Person`, `Object`, `Action`). |
| `idProp` | Which property identifies a record. Its value becomes the record's `@id` in JSON-LD. `person` and `object` have one; `action` does not. |
| `properties` | The property definitions, keyed by property name. |

Each property definition uses a small, JSON-Schema-*like* vocabulary: the key names are borrowed from [JSON Schema](https://json-schema.org/), but the definitions are not a JSON Schema document and must not be fed to a JSON Schema validator. The ADC-specific differences are `required: true` on the property itself (JSON Schema puts a `required` array on the parent), `nullable`, and `enumFromTaxonomy`. The checker for this vocabulary is [`scripts/validate.mjs`](#validation).

| Key | Meaning |
|---|---|
| `type` | JSON Schema type: `string`, `number`, `array` or `object`. |
| `description` | Human-readable meaning. This is also what an LLM-based mapper is shown, so it is written to be unambiguous. |
| `required` | **ADC form:** `true` on the property itself when a record is invalid without it. Absent means optional. Inside `responses[]` the JSON Schema list form `["question", "answer"]` is used instead, on the item definition. |
| `items` | For arrays: the definition of each element. |
| `properties` | For objects: nested property definitions (`demographics`, `location`, `behavior`, `interests`, `deviceContext`). |
| `minimum`, `maximum` | Numeric bounds (`engagementScore` 1–5, `completionRate` 0–1). |
| `pattern` | A regular expression the string must match (used to require a URL for `objectID` and `action.object`). |
| `format` | A named string format (`date-time`). |
| `nullable` | **ADC extension.** `true` when `null` is an accepted value. Part of the vocabulary and accepted by the validator; not used by any property in 1.0.0. |
| **`enumFromTaxonomy`** | **ADC extension.** The value must be one of the `value` fields in `taxonomies/<name>.json`. |

### Taxonomies

A taxonomy is a JSON array of entries with exactly two fields:

```json
[
  { "notation": "CONSENT_IMPLICIT", "value": "implicit" },
  { "notation": "CONSENT_EXPLICIT", "value": "explicit" },
  { "notation": "CONSENT_IMPORTED", "value": "imported" }
]
```

`value` is what appears in data. `notation` is a stable, upper-case identifier for the concept, intended for code, documentation and cross-referencing; it never changes even if the display `value` is later revised. Both are unique within a file. The `-v1` suffix in the file name is the taxonomy's own version (see [Versioning policy](#versioning-policy)).

| Taxonomy | Entries | Values |
|---|---|---|
| `ActionType-v1` | 11 | `newsletter_subscribe`, `newsletter_unsubscribe`, `newsletter_click`, `newsletter_open`, `web_read`, `app_read`, `form_submit`, `survey_complete`, `comment_post`, `donation_made`, `irl_event_attend` |
| `AgeGroup-v1` | 4 | `underage`, `youth`, `adult`, `senior` |
| `ConsentType-v1` | 3 | `implicit`, `explicit`, `imported` |
| `DonorStatus-v1` | 4 | `no`, `minor`, `major`, `lapsed` |
| `EducationLevel-v1` | 6 | `no_formal_education`, `primary_education`, `secondary_education`, `bachelors_degree`, `mains_degree`, `doctorate_degree` |
| `Gender-v1` | 4 | `male`, `female`, `non-binary`, `other/unspecified` |
| `IncomeBracket-v1` | 7 | `very_low`, `low`, `lower_middle`, `middle`, `upper_middle`, `high`, `very_high` |
| `ObjectType-v1` | 4 | `article`, `newsletter`, `survey`, `survey_response` |

## Using the schema

You do not need any ADC tool — and, except for the first route, not even Node.js — to use the standard. The schema and taxonomies are plain JSON files; pick whichever of the following fits your environment.

### Install from npm

```sh
npm install @npa-ai-co-lab/adc-schema
```

The package ships the schema, the taxonomies, the validator and the docs. It has no JavaScript entry point: there is nothing to `import` from the package root. Its `exports` map exposes the data files by path — `@npa-ai-co-lab/adc-schema/schema/adc.schema.jsonld`, `@npa-ai-co-lab/adc-schema/taxonomies/<name>.json` and `@npa-ai-co-lab/adc-schema/package.json`. Because `.jsonld` is not an extension Node loads as a module, resolve the path and read the file:

```js
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

// the schema
const schemaPath = require.resolve('@npa-ai-co-lab/adc-schema/schema/adc.schema.jsonld');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

// one taxonomy (plain JSON, so require() works directly)
const actionTypes = require('@npa-ai-co-lab/adc-schema/taxonomies/ActionType-v1.json');

// the taxonomies directory, for tools that load them by name
const taxonomiesDir = join(dirname(require.resolve('@npa-ai-co-lab/adc-schema/package.json')), 'taxonomies');
```

In CommonJS the same `require.resolve(...)` and `require(...)` calls work without `createRequire`.

### Download a release archive

Each [GitHub Release](https://github.com/NPA-AI-Co-Lab/adc-schema/releases) has an `adc-schema-<version>.zip` attached containing `schema/`, `taxonomies/`, `scripts/` (the validator), `LICENSE`, `README.md` and `CHANGELOG.md`. This is the right choice for spreadsheet users, data teams and anyone who wants a self-contained, offline copy.

### Download the raw files

Every release has a stable, version-pinned URL for each file. The schema's own `$id` field is its version-pinned URL, so a downloaded copy always says where it came from:

```
https://raw.githubusercontent.com/NPA-AI-Co-Lab/adc-schema/v1.0.0/schema/adc.schema.jsonld
https://raw.githubusercontent.com/NPA-AI-Co-Lab/adc-schema/v1.0.0/taxonomies/ActionType-v1.json
```

Replace `v1.0.0` with any released tag, or with `main` for the current development state.

### Python

```python
import json, urllib.request

BASE = "https://raw.githubusercontent.com/NPA-AI-Co-Lab/adc-schema/v1.0.0"
schema = json.load(urllib.request.urlopen(f"{BASE}/schema/adc.schema.jsonld"))
genders = json.load(urllib.request.urlopen(f"{BASE}/taxonomies/Gender-v1.json"))

allowed = {entry["value"] for entry in genders}
for name, prop in schema["entities"]["person"]["properties"].items():
    print(name, prop["type"], "required" if prop.get("required") else "")
```

### Spreadsheets and no-code tools

Open the release archive, and use each taxonomy's `value` column as a data-validation list for the corresponding field. The property tables above are the field reference; the `Required` column tells you which fields a record cannot be without.

## Validation

`scripts/validate.mjs` is the gate every change to this repository has to pass. It runs on every pull request and before every publish, and needs nothing but Node.js 20 or newer:

```sh
npm run validate          # validate the schema and taxonomies; exits non-zero on any error
npm run validate:strict   # the same, but warnings also fail (currently fails: see Known issues)
npm test                  # self-test: proves the gate fails on a broken reference and a duplicate notation
```

**Errors** (the run fails): the schema does not parse as JSON, or its `@context` is not well-formed JSON-LD (a single object, an absolute `@vocab`, every term a string or term definition, every compact IRI using a defined prefix); an entity or property definition is structurally unsound (missing `@type` or `type`, arrays without `items`, objects without `properties`, inconsistent bounds, a `pattern` that does not compile, a `required` array naming a property that does not exist on that node); an `enumFromTaxonomy` reference does not resolve to a file in `taxonomies/`; a taxonomy entry repeats a `notation` or a `value`; the version embedded in `$id` differs from `version`, or `version` differs from `package.json`.

**Warnings** (reported, the run passes): a property name with no explicit `@context` entry that is not one of the schema.org terms deliberately used through `@vocab`; two properties on the same node that resolve to the same IRI; an entity `@type` that resolves through `@vocab` to something other than a known schema.org class; a `@context` term that nothing uses; unknown keys; a taxonomy file that nothing references. The released 1.0.0 schema produces 15 such warnings, all of them [known issues](#known-issues-to-be-addressed-in-11).

## Known issues (to be addressed in 1.1)

Version 1.0.0 is published exactly as the model was extracted from the Schema Mapping CLI. The property definitions and taxonomies are sound, but the `@context` has the following problems when an ADC record is processed as linked data. They do not affect tools that read the property definitions directly. The validator reports them as warnings, and they will be fixed in a minor release.

- **Several properties share one IRI.** `person` and `object` on `action` both map to `schema:identifier`, as do `userID` and `objectID`, so a JSON-LD processor cannot distinguish the actor from the object of an action. Likewise `primaryEmail` and `additionalEmails` both map to `schema:email`; `donorStatus`, `consentType` and `type` to `schema:category`; `lastDonationDate` and `consentDate` to `schema:dateCreated`.
- **Eleven property names fall through `@vocab` to schema.org IRIs that do not exist:** `actionType`, `ageGroup`, `answer`, `behavior`, `commentedOn`, `demographics`, `deviceContext`, `educationLevel`, `incomeBracket`, `interests`, `topics`.
- **The `object` entity's `@type` `Object` expands to `https://schema.org/Object`,** which does not exist (Activity Streams, not schema.org, defines `Object`).
- **`personID` is declared in `@context` but not used** by any entity.

## Versioning policy

The standard is versioned as a whole with [Semantic Versioning](https://semver.org/). The version appears in three places that must always agree: the `version` field inside `schema/adc.schema.jsonld`, `version` in `package.json`, and the git tag `v<version>`. The validator enforces the first two; the release workflow enforces the third.

| Change | Version bump |
|---|---|
| Removing or renaming an entity or property; changing a property's type or meaning; making an optional property required; tightening a constraint; removing or renaming a taxonomy value | **major** |
| Adding an optional property, a new entity, a new taxonomy, or a new value to an existing taxonomy; loosening a constraint | **minor** |
| Clarifying a description, fixing a typo, changing documentation or tooling with no effect on the model | **patch** |

Taxonomies carry their own version in the file name (`Gender-v1`). Adding a value to a taxonomy is a minor change and keeps the file name. Removing or renaming a value is breaking: it is done by introducing a new file (`Gender-v2`) and pointing the schema at it in the next major version, while the old file is kept for as long as the previous major version is supported.

Schema changes are rare and deliberate. They need review from both data and newsroom stakeholders, and they are proposed as issues before they become pull requests. See [CONTRIBUTING.md](CONTRIBUTING.md).

Every release is listed in [CHANGELOG.md](CHANGELOG.md).

## Contributing

Bug reports, questions and proposals are welcome as [issues](https://github.com/NPA-AI-Co-Lab/adc-schema/issues). Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and note the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © News Product Alliance.
