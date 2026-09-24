/**
 * Self-test for scripts/validate.mjs. Run with `npm test` (node --test).
 *
 * Copies the real schema and taxonomies into a temporary directory, breaks
 * them in a controlled way and asserts that validation fails for the right
 * reason - and that the untouched copy passes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validate } from './validate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'validate.mjs');

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
  const run = () => spawnSync(process.execPath, [
    SCRIPT, '--schema', opts.schema, '--taxonomies', opts.taxonomies, '--package', opts.package, '--quiet',
  ], { encoding: 'utf8' });
  return { dir, opts, editJson, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('the shipped schema and taxonomies pass with no errors', () => {
  const { errors, warnings, stats } = validate({
    schema: join(ROOT, 'schema', 'adc.schema.jsonld'),
    taxonomies: join(ROOT, 'taxonomies'),
    package: join(ROOT, 'package.json'),
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(stats.entities, 3);
  assert.ok(stats.taxonomies >= 8);
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
