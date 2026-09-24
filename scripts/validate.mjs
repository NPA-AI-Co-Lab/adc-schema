#!/usr/bin/env node
/**
 * Validates the ADC schema and its taxonomies.
 *
 * This is the release gate: a schema that fails here must never be tagged.
 * It has no dependencies beyond Node.js >= 18.
 *
 * Checks
 *   1. schema/adc.schema.jsonld parses as JSON and is well-formed JSON-LD:
 *      a single @context object with an absolute @vocab, every term mapping
 *      to a string or an expanded term definition, every compact IRI using a
 *      prefix that the context defines.
 *   2. Every entity has an @type and a properties object; idProp (when set)
 *      names one of the entity's own properties.
 *   3. Every property definition has a valid JSON Schema type, arrays have
 *      items, objects have properties, numeric bounds are consistent and
 *      pattern compiles.
 *   4. Every enumFromTaxonomy reference resolves to taxonomies/<name>.json.
 *   5. Every taxonomy file is a non-empty array of { notation, value } with
 *      unique notation and unique value.
 *   6. $id is an absolute URL and version matches package.json.
 *
 * Usage
 *   node scripts/validate.mjs [--schema <file>] [--taxonomies <dir>] [--package <file>] [--quiet]
 *
 * Exit code 0 when there are no errors, 1 otherwise. Warnings never fail the run.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const JSON_SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']);
const CONTEXT_KEYWORDS = new Set(['@vocab', '@base', '@language', '@version', '@import', '@protected', '@propagate', '@direction']);
const TERM_DEFINITION_KEYS = new Set(['@id', '@type', '@container', '@reverse', '@language', '@context', '@nest', '@prefix', '@protected', '@index', '@direction']);
const KNOWN_PROPERTY_KEYS = new Set([
  'type', 'description', 'format', 'minimum', 'maximum', 'enum', 'enumFromTaxonomy',
  'required', 'items', 'properties', 'pattern', 'nullable', 'default', 'examples', 'title',
]);
const KNOWN_TOP_LEVEL_KEYS = new Set(['$comment', '$id', 'version', '@context', 'entities']);

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    schema: join(ROOT, 'schema', 'adc.schema.jsonld'),
    taxonomies: join(ROOT, 'taxonomies'),
    package: join(ROOT, 'package.json'),
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--schema') opts.schema = resolve(argv[++i]);
    else if (a === '--taxonomies') opts.taxonomies = resolve(argv[++i]);
    else if (a === '--package') opts.package = resolve(argv[++i]);
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: node scripts/validate.mjs [--schema <file>] [--taxonomies <dir>] [--package <file>] [--quiet]');
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isAbsoluteIri(s) {
  return typeof s === 'string' && /^[a-z][a-z0-9+.-]*:/i.test(s) && !/\s/.test(s);
}

function readJson(file, errors, label) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    errors.push(`${label}: cannot read ${file}: ${e.message}`);
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    errors.push(`${label}: ${file} is not valid JSON: ${e.message}`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------

export function validate(opts) {
  const errors = [];
  const warnings = [];
  const stats = { entities: 0, properties: 0, taxonomyRefs: 0, taxonomies: 0, taxonomyEntries: 0 };

  const schema = readJson(opts.schema, errors, 'schema');
  if (schema === undefined) return { errors, warnings, stats };

  if (!isPlainObject(schema)) {
    errors.push('schema: top level must be a JSON object');
    return { errors, warnings, stats };
  }

  for (const key of Object.keys(schema)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) warnings.push(`schema: unexpected top-level key "${key}"`);
  }

  // --- metadata -----------------------------------------------------------
  if (!isAbsoluteIri(schema.$id)) errors.push('schema: $id must be an absolute URL');
  if (typeof schema.version !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(schema.version)) {
    errors.push('schema: version must be a semver string, e.g. "1.0.0"');
  }
  if (existsSync(opts.package)) {
    const pkg = readJson(opts.package, errors, 'package.json');
    if (pkg && typeof schema.version === 'string' && pkg.version !== schema.version) {
      errors.push(`schema: version "${schema.version}" does not match package.json version "${pkg.version}"`);
    }
  } else {
    warnings.push(`package.json not found at ${opts.package}; skipping version cross-check`);
  }

  // --- @context -----------------------------------------------------------
  const ctx = schema['@context'];
  const prefixes = new Set();
  if (!isPlainObject(ctx)) {
    errors.push('schema: @context must be a JSON object');
  } else {
    if (!isAbsoluteIri(ctx['@vocab'])) errors.push('schema: @context.@vocab must be an absolute IRI');
    for (const [term, def] of Object.entries(ctx)) {
      if (term.startsWith('@')) {
        if (!CONTEXT_KEYWORDS.has(term)) errors.push(`schema: @context uses unknown keyword "${term}"`);
        continue;
      }
      if (term.length === 0) {
        errors.push('schema: @context contains an empty term');
        continue;
      }
      if (typeof def === 'string') {
        if (isAbsoluteIri(def) && !def.startsWith('@')) prefixes.add(term); // term usable as prefix
      } else if (isPlainObject(def)) {
        for (const k of Object.keys(def)) {
          if (!TERM_DEFINITION_KEYS.has(k)) errors.push(`schema: @context term "${term}" has unknown key "${k}"`);
        }
        if (typeof def['@id'] === 'string' && isAbsoluteIri(def['@id'])) prefixes.add(term);
      } else {
        errors.push(`schema: @context term "${term}" must map to a string or an object`);
      }
    }
    // second pass: compact IRIs must use a defined prefix
    for (const [term, def] of Object.entries(ctx)) {
      if (term.startsWith('@')) continue;
      const target = typeof def === 'string' ? def : isPlainObject(def) ? def['@id'] : undefined;
      if (typeof target !== 'string' || target.startsWith('@')) continue;
      const colon = target.indexOf(':');
      if (colon > 0 && !target.includes('://')) {
        const prefix = target.slice(0, colon);
        if (!prefixes.has(prefix) && !['urn', 'mailto', 'tel'].includes(prefix)) {
          errors.push(`schema: @context term "${term}" maps to "${target}" but prefix "${prefix}" is not defined`);
        }
      }
    }
  }

  // --- entities and properties -------------------------------------------
  const taxonomyRefs = new Map(); // taxonomy name -> [property paths]

  function checkProperty(prop, path) {
    stats.properties++;
    if (!isPlainObject(prop)) {
      errors.push(`schema: property ${path} must be an object`);
      return;
    }
    for (const k of Object.keys(prop)) {
      if (!KNOWN_PROPERTY_KEYS.has(k)) warnings.push(`schema: property ${path} has unknown key "${k}"`);
    }
    const types = Array.isArray(prop.type) ? prop.type : [prop.type];
    if (prop.type === undefined) {
      errors.push(`schema: property ${path} has no type`);
    } else {
      for (const t of types) {
        if (!JSON_SCHEMA_TYPES.has(t)) errors.push(`schema: property ${path} has invalid type "${t}"`);
      }
    }
    if (prop.required !== undefined && typeof prop.required !== 'boolean' &&
        !(Array.isArray(prop.required) && prop.required.every((r) => typeof r === 'string'))) {
      errors.push(`schema: property ${path}.required must be a boolean or an array of property names`);
    }
    if (prop.description !== undefined && typeof prop.description !== 'string') {
      errors.push(`schema: property ${path}.description must be a string`);
    }
    if (prop.minimum !== undefined && typeof prop.minimum !== 'number') errors.push(`schema: ${path}.minimum must be a number`);
    if (prop.maximum !== undefined && typeof prop.maximum !== 'number') errors.push(`schema: ${path}.maximum must be a number`);
    if (typeof prop.minimum === 'number' && typeof prop.maximum === 'number' && prop.minimum > prop.maximum) {
      errors.push(`schema: property ${path} has minimum > maximum`);
    }
    if (prop.pattern !== undefined) {
      try {
        new RegExp(prop.pattern);
      } catch (e) {
        errors.push(`schema: property ${path}.pattern is not a valid regular expression: ${e.message}`);
      }
    }
    if (prop.enum !== undefined && !Array.isArray(prop.enum)) errors.push(`schema: ${path}.enum must be an array`);
    if (prop.enumFromTaxonomy !== undefined) {
      if (typeof prop.enumFromTaxonomy !== 'string' || prop.enumFromTaxonomy.length === 0) {
        errors.push(`schema: property ${path}.enumFromTaxonomy must be a non-empty string`);
      } else {
        stats.taxonomyRefs++;
        if (!taxonomyRefs.has(prop.enumFromTaxonomy)) taxonomyRefs.set(prop.enumFromTaxonomy, []);
        taxonomyRefs.get(prop.enumFromTaxonomy).push(path);
        if (!types.includes('string')) {
          warnings.push(`schema: property ${path} uses enumFromTaxonomy but its type is not "string"`);
        }
      }
    }
    if (types.includes('array')) {
      if (prop.items === undefined) errors.push(`schema: array property ${path} has no items`);
      else checkProperty(prop.items, `${path}[]`);
    }
    if (types.includes('object')) {
      if (!isPlainObject(prop.properties)) {
        errors.push(`schema: object property ${path} has no properties`);
      } else {
        for (const [name, sub] of Object.entries(prop.properties)) checkProperty(sub, `${path}.${name}`);
      }
    }
  }

  const entities = schema.entities;
  if (!isPlainObject(entities) || Object.keys(entities).length === 0) {
    errors.push('schema: entities must be a non-empty object');
  } else {
    for (const [name, entity] of Object.entries(entities)) {
      stats.entities++;
      if (!isPlainObject(entity)) {
        errors.push(`schema: entity "${name}" must be an object`);
        continue;
      }
      if (typeof entity['@type'] !== 'string' || entity['@type'].length === 0) {
        errors.push(`schema: entity "${name}" has no @type`);
      }
      if (!isPlainObject(entity.properties) || Object.keys(entity.properties).length === 0) {
        errors.push(`schema: entity "${name}" has no properties`);
        continue;
      }
      if (entity.idProp !== undefined && !(entity.idProp in entity.properties)) {
        errors.push(`schema: entity "${name}" idProp "${entity.idProp}" is not one of its properties`);
      }
      for (const [propName, prop] of Object.entries(entity.properties)) {
        checkProperty(prop, `${name}.${propName}`);
      }
    }
  }

  // --- taxonomies ---------------------------------------------------------
  let taxonomyFiles = [];
  if (!existsSync(opts.taxonomies)) {
    errors.push(`taxonomies: directory not found: ${opts.taxonomies}`);
  } else {
    taxonomyFiles = readdirSync(opts.taxonomies).filter((f) => f.endsWith('.json')).sort();
    if (taxonomyFiles.length === 0) errors.push(`taxonomies: no .json files in ${opts.taxonomies}`);
  }
  const taxonomyNames = new Set(taxonomyFiles.map((f) => basename(f, '.json')));

  for (const file of taxonomyFiles) {
    const name = basename(file, '.json');
    stats.taxonomies++;
    const data = readJson(join(opts.taxonomies, file), errors, `taxonomy ${name}`);
    if (data === undefined) continue;
    if (!Array.isArray(data) || data.length === 0) {
      errors.push(`taxonomy ${name}: must be a non-empty array of { notation, value }`);
      continue;
    }
    const notations = new Map();
    const values = new Map();
    data.forEach((entry, i) => {
      stats.taxonomyEntries++;
      if (!isPlainObject(entry)) {
        errors.push(`taxonomy ${name}[${i}]: entry must be an object`);
        return;
      }
      for (const field of ['notation', 'value']) {
        if (typeof entry[field] !== 'string' || entry[field].trim().length === 0) {
          errors.push(`taxonomy ${name}[${i}]: "${field}" must be a non-empty string`);
        }
      }
      if (typeof entry.notation === 'string') {
        if (notations.has(entry.notation)) {
          errors.push(`taxonomy ${name}: duplicate notation "${entry.notation}" (entries ${notations.get(entry.notation)} and ${i})`);
        } else notations.set(entry.notation, i);
      }
      if (typeof entry.value === 'string') {
        if (values.has(entry.value)) {
          errors.push(`taxonomy ${name}: duplicate value "${entry.value}" (entries ${values.get(entry.value)} and ${i})`);
        } else values.set(entry.value, i);
      }
    });
    if (!taxonomyRefs.has(name)) warnings.push(`taxonomy ${name}: not referenced by any schema property`);
  }

  for (const [name, paths] of taxonomyRefs) {
    if (!taxonomyNames.has(name)) {
      errors.push(`schema: enumFromTaxonomy "${name}" (used by ${paths.join(', ')}) has no file taxonomies/${name}.json`);
    }
  }

  return { errors, warnings, stats };
}

// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { errors, warnings, stats } = validate(opts);

  if (!opts.quiet) {
    console.log(`ADC schema validation`);
    console.log(`  schema:      ${opts.schema}`);
    console.log(`  taxonomies:  ${opts.taxonomies}`);
    console.log(`  entities: ${stats.entities}, properties: ${stats.properties}, taxonomy references: ${stats.taxonomyRefs}`);
    console.log(`  taxonomies: ${stats.taxonomies}, entries: ${stats.taxonomyEntries}`);
    for (const w of warnings) console.log(`  warning: ${w}`);
  }
  for (const e of errors) console.error(`  error: ${e}`);

  if (errors.length > 0) {
    console.error(`\nFAILED: ${errors.length} error(s), ${warnings.length} warning(s)`);
    process.exit(1);
  }
  if (!opts.quiet) console.log(`\nOK: 0 errors, ${warnings.length} warning(s)`);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
