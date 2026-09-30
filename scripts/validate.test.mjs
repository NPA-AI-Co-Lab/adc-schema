/**
 * Self-test for scripts/validate.mjs. Run with `npm test` (node --test).
 *
 * Copies the real schema and taxonomies into a temporary directory, breaks
 * them in a controlled way and asserts that validation fails (errors) or
 * warns (model-review notes) for the right reason - and that the untouched
 * copy passes with exactly the known warnings.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validate, resolveTerm, VOCAB_ALLOWED_TERMS, MODEL_REVISION_NOTE } from './validate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'validate.mjs');
const SCHEMA = join(ROOT, 'schema', 'adc.schema.jsonld');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'adc-schema-'));
  cpSync(join(ROOT, 'schema'), join(dir, 'schema'), { recursive: true });
  cpSync(join(ROOT, 'taxonomies'), join(dir, 'taxonomies'), { recursive: true });
  cpSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
  const opts = {
    schema: join(dir, 'schema', 'adc.schema.jsonld'),
    taxonomies: join(dir, 'taxonomies'),
    package: join(dir, 'package.json'),
  };
  const editJson = (file, fn) => {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify(fn(data) ?? data, null, 2));
  };
  const run = (...extra) => spawnSync(process.execPath, [
    SCRIPT, '--schema', opts.schema, '--taxonomies', opts.taxonomies, '--package', opts.package, '--quiet', ...extra,
  ], { encoding: 'utf8' });
  return { dir, opts, editJson, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// The known limitations of the 1.0.0 data model, reported as warnings and
// listed under "Known issues" in README.md. Pinned here so that any new
// warning (or a fixed one) is noticed: update this list together with the
// README when the model revision lands.
const EXPECTED_WARNINGS = [
  ['collision', 'person.primaryEmail', 'person.additionalEmails', 'https://schema.org/email'],
  ['unmapped', 'person.demographics'],
  ['unmapped', 'person.behavior'],
  ['unmapped', 'person.interests'],
  ['unmapped', 'person.demographics.ageGroup'],
  ['unmapped', 'person.demographics.educationLevel'],
  ['unmapped', 'person.demographics.incomeBracket'],
  ['unmapped', 'person.interests.topics'],
  ['unmapped', 'person.interests.commentedOn'],
  ['type', 'object', 'Object', 'https://schema.org/Object'],
  ['unmapped', 'object.responses[].answer'],
  ['unmapped', 'action.actionType'],
  ['collision', 'action.person', 'action.object', 'https://schema.org/identifier'],
  ['unmapped', 'action.deviceContext'],
  ['unused', 'personID'],
].map(([kind, a, b, iri]) => {
  const note = `; ${MODEL_REVISION_NOTE}`;
  if (kind === 'collision') return `model review: properties ${a} and ${b} both map to <${iri}>, so a JSON-LD processor cannot tell them apart${note}`;
  if (kind === 'type') return `model review: entity "${a}" @type "${b}" has no explicit @context entry and is not an allow-listed schema.org class, so it falls through @vocab to <${iri}>${note}`;
  if (kind === 'unused') return `model review: @context term "${a}" is declared but no entity or property uses it${note}`;
  const leaf = a.split('.').pop();
  return `model review: property ${a} has no explicit @context entry and is not an allow-listed schema.org term, so it falls through @vocab to <https://schema.org/${leaf}>${note}`;
});

test('the shipped schema and taxonomies pass with no errors and exactly the known model-review warnings', () => {
  const { errors, warnings, stats } = validate({
    schema: SCHEMA,
    taxonomies: join(ROOT, 'taxonomies'),
    package: join(ROOT, 'package.json'),
  });
  assert.deepEqual(errors, []);
  assert.deepEqual([...warnings].sort(), [...EXPECTED_WARNINGS].sort());
  assert.equal(stats.entities, 3);
  assert.equal(stats.taxonomies, 8);

  const proc = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stdout + proc.stderr);
  assert.match(proc.stdout, new RegExp(`OK: 0 errors, ${EXPECTED_WARNINGS.length} warning\\(s\\)`));

  const strict = spawnSync(process.execPath, [SCRIPT, '--strict'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(strict.status, 1, 'the known issues make --strict fail until the model revision');
  assert.match(strict.stderr, /FAILED \(--strict\): 0 errors/);
});

test('--strict turns a warning into a non-zero exit code', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.opts.taxonomies, 'Unused-v1.json'), JSON.stringify([{ notation: 'X', value: 'x' }]));
    assert.equal(f.run().status, 0, 'lenient run must still pass');
    const strict = f.run('--strict');
    assert.equal(strict.status, 1, 'strict run must fail');
    assert.match(strict.stderr, /Unused-v1/);
    assert.match(strict.stderr, /FAILED \(--strict\)/);
  } finally {
    f.cleanup();
  }
});

// --- JSON-LD term resolution -------------------------------------------------
//
// These mirror what jsonld.expand() produces for the shipped @context (verified
// against the reference implementation) without adding it as a dependency.

function shippedContext() {
  return JSON.parse(readFileSync(SCHEMA, 'utf8'))['@context'];
}

test('term resolution follows the shipped @context (as a JSON-LD processor would)', () => {
  const ctx = shippedContext();
  assert.equal(resolveTerm(ctx, 'userID'), 'https://schema.org/identifier');
  assert.equal(resolveTerm(ctx, 'primaryEmail'), 'https://schema.org/email');
  assert.equal(resolveTerm(ctx, 'referrer'), 'https://www.w3.org/ns/activitystreams#origin');
  assert.equal(resolveTerm(ctx, 'givenName'), 'https://schema.org/givenName'); // through @vocab
  assert.equal(resolveTerm(ctx, 'Person'), 'https://schema.org/Person');
  assert.equal(resolveTerm(ctx, '@id'), '@id');
  assert.ok(VOCAB_ALLOWED_TERMS.has('givenName'));
});

test('a deliberately broken enumFromTaxonomy reference fails the gate', () => {
  const f = fixture();
  try {
    f.editJson(f.opts.schema, (s) => {
      s.entities.person.properties.consentType.enumFromTaxonomy = 'DoesNotExist-v1';
    });
    const { errors } = validate(f.opts);
    assert.ok(errors.some((e) => e.includes('DoesNotExist-v1') && e.includes('no file')), errors.join('\n'));

    const proc = f.run();
    assert.equal(proc.status, 1, 'process must exit with code 1');
    assert.match(proc.stderr, /DoesNotExist-v1/);
  } finally {
    f.cleanup();
  }
});

test('a duplicate taxonomy notation fails the gate', () => {
  const f = fixture();
  try {
    f.editJson(join(f.opts.taxonomies, 'Gender-v1.json'), (t) => {
      t.push({ notation: 'GENDER_MALE', value: 'something_new' });
    });
    const { errors } = validate(f.opts);
    assert.ok(errors.some((e) => e.includes('duplicate notation "GENDER_MALE"')), errors.join('\n'));

    const proc = f.run();
    assert.equal(proc.status, 1, 'process must exit with code 1');
    assert.match(proc.stderr, /duplicate notation "GENDER_MALE"/);
  } finally {
    f.cleanup();
  }
});

test('a duplicate taxonomy value fails the gate', () => {
  const f = fixture();
  try {
    f.editJson(join(f.opts.taxonomies, 'DonorStatus-v1.json'), (t) => {
      t.push({ notation: 'DONOR_SOMETHING_NEW', value: 'major' });
    });
    const { errors } = validate(f.opts);
    assert.ok(errors.some((e) => e.includes('duplicate value "major"')), errors.join('\n'));
  } finally {
    f.cleanup();
  }
});

test('a missing taxonomy file fails even when the schema is untouched', () => {
  const f = fixture();
  try {
    rmSync(join(f.opts.taxonomies, 'ObjectType-v1.json'));
    const { errors } = validate(f.opts);
    assert.ok(errors.some((e) => e.includes('ObjectType-v1') && e.includes('no file')), errors.join('\n'));
  } finally {
    f.cleanup();
  }
});

test('schema version must match package.json version', () => {
  const f = fixture();
  try {
    f.editJson(f.opts.schema, (s) => {
      s.version = '9.9.9';
    });
    const { errors } = validate(f.opts);
    assert.ok(errors.some((e) => e.includes('does not match package.json')), errors.join('\n'));
  } finally {
    f.cleanup();
  }
});

test('invalid JSON is reported, not thrown', () => {
  const f = fixture();
  try {
    writeFileSync(f.opts.schema, '{ "@context": ');
    const { errors } = validate(f.opts);
    assert.ok(errors.some((e) => e.includes('not valid JSON')), errors.join('\n'));
  } finally {
    f.cleanup();
  }
});

test('an undefined compact-IRI prefix in @context is an error', () => {
  const f = fixture();
  try {
    f.editJson(f.opts.schema, (s) => {
      s['@context'].referrer = 'nosuchprefix:origin';
    });
    const { errors } = validate(f.opts);
    assert.ok(errors.some((e) => e.includes('prefix "nosuchprefix" is not defined')), errors.join('\n'));
  } finally {
    f.cleanup();
  }
});

test('two properties on the same node sharing an IRI is a warning, and fails --strict', () => {
  const f = fixture();
  try {
    f.editJson(f.opts.schema, (s) => {
      s['@context'].timeSpent = 'value'; // same IRI as completionRate
    });
    const { errors, warnings } = validate(f.opts);
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => w.includes('action.timeSpent and action.completionRate both map to <https://schema.org/value>') ||
      w.includes('action.completionRate and action.timeSpent both map to <https://schema.org/value>')), warnings.join('\n'));
    assert.ok(warnings.some((w) => w.includes('action.person and action.object both map to')), 'the known collision is still reported');

    assert.equal(f.run().status, 0, 'lenient run must pass');
    const strict = f.run('--strict');
    assert.equal(strict.status, 1, 'strict run must fail');
    assert.match(strict.stderr, /completionRate.*both map to|timeSpent.*both map to/);
  } finally {
    f.cleanup();
  }
});

test('the same IRI on different entities (userID / objectID -> identifier) is not a collision', () => {
  const { errors, warnings } = validate({ schema: SCHEMA, taxonomies: join(ROOT, 'taxonomies'), package: join(ROOT, 'package.json') });
  assert.equal(resolveTerm(shippedContext(), 'userID'), resolveTerm(shippedContext(), 'objectID'));
  assert.ok(!errors.some((e) => e.includes('both map to')), errors.join('\n'));
  assert.ok(!warnings.some((w) => w.includes('userID') && w.includes('objectID')), warnings.join('\n'));
});

test('a collision inside a nested object node is a warning', () => {
  const f = fixture();
  try {
    f.editJson(f.opts.schema, (s) => {
      s['@context'].topics = 'keywords';
      s['@context'].commentedOn = 'keywords';
    });
    const { errors, warnings } = validate(f.opts);
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => w.includes('person.interests.topics') && w.includes('person.interests.commentedOn') && w.includes('both map to')), warnings.join('\n'));
  } finally {
    f.cleanup();
  }
});

test('the version embedded in $id must equal version', () => {
  const f = fixture();
  try {
    f.editJson(f.opts.schema, (s) => {
      s.$id = s.$id.replace('/v1.0.0/', '/v1.0.1/');
    });
    const { errors } = validate(f.opts);
    assert.ok(errors.some((e) => e.includes('$id embeds version "1.0.1"') && e.includes('version is "1.0.0"')), errors.join('\n'));

    const proc = f.run();
    assert.equal(proc.status, 1, 'process must exit with code 1');
    assert.match(proc.stderr, /\$id embeds version "1\.0\.1"/);
  } finally {
    f.cleanup();
  }
});

test('a property with no explicit @context entry that is not allow-listed is a warning, and fails --strict', () => {
  const f = fixture();
  try {
    f.editJson(f.opts.schema, (s) => {
      // a typo-style drift: the property is renamed but the @context is not
      s.entities.action.properties.completionRat = s.entities.action.properties.completionRate;
      delete s.entities.action.properties.completionRate;
    });
    const { errors, warnings } = validate(f.opts);
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => w.includes('property action.completionRat has no explicit @context entry') && w.includes(MODEL_REVISION_NOTE)), warnings.join('\n'));

    assert.equal(f.run().status, 0, 'lenient run must pass');
    const strict = f.run('--strict');
    assert.equal(strict.status, 1, 'strict run must fail');
    assert.match(strict.stderr, /property action\.completionRat has no explicit @context entry/);
  } finally {
    f.cleanup();
  }
});

test('an allow-listed schema.org term needs no @context entry; any other unmapped name is warned', () => {
  const ctx = shippedContext();
  for (const term of VOCAB_ALLOWED_TERMS) assert.equal(ctx[term], undefined, `${term} should resolve through @vocab`);
  const { warnings } = validate({ schema: SCHEMA, taxonomies: join(ROOT, 'taxonomies'), package: join(ROOT, 'package.json') });
  for (const term of VOCAB_ALLOWED_TERMS) {
    assert.ok(!warnings.some((w) => w.includes(`.${term} has no explicit`)), `${term} must not be warned`);
  }
  const f = fixture();
  try {
    f.editJson(f.opts.schema, (s) => {
      s.entities.person.properties.location.properties.addressRegion = { type: 'string', description: 'State or region' };
    });
    const { errors, warnings: w2 } = validate(f.opts);
    assert.deepEqual(errors, []);
    assert.ok(w2.some((w) => w.includes('property person.location.addressRegion has no explicit @context entry')), w2.join('\n'));
  } finally {
    f.cleanup();
  }
});

test('an unmapped entity @type and an unused @context term are warnings', () => {
  const f = fixture();
  try {
    f.editJson(f.opts.schema, (s) => {
      s.entities.action['@type'] = 'Happening';
      s['@context'].neverUsed = 'name';
    });
    const { errors, warnings } = validate(f.opts);
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => w.includes('entity "action" @type "Happening"')), warnings.join('\n'));
    assert.ok(warnings.some((w) => w.includes('@context term "neverUsed" is declared but no entity or property uses it')), warnings.join('\n'));
    assert.ok(!warnings.some((w) => w.includes('"activitystream"')), 'a prefix is not an unused term');
  } finally {
    f.cleanup();
  }
});

test('a required array naming a property that does not exist on that node is an error', () => {
  const f = fixture();
  try {
    f.editJson(f.opts.schema, (s) => {
      s.entities.object.properties.responses.items.required = ['question', 'answr'];
    });
    const { errors } = validate(f.opts);
    assert.ok(errors.some((e) => e.includes('object.responses[].required names "answr"')), errors.join('\n'));
  } finally {
    f.cleanup();
  }
});

test('an unreferenced taxonomy is a warning, not an error', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.opts.taxonomies, 'Unused-v1.json'), JSON.stringify([{ notation: 'X', value: 'x' }]));
    const { errors, warnings } = validate(f.opts);
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => w.includes('Unused-v1') && w.includes('not referenced')), warnings.join('\n'));
  } finally {
    f.cleanup();
  }
});
