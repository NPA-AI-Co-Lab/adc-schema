#!/usr/bin/env node
/**
 * Validates the ADC schema and its taxonomies.
 *
 * This is the release gate: a schema with errors here must never be tagged.
 * It has no dependencies beyond Node.js >= 20.
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
 *      pattern compiles. A `required` array names only properties that
 *      exist on that node.
 *   4. Every enumFromTaxonomy reference resolves to taxonomies/<name>.json.
 *   5. Every taxonomy file is a non-empty array of { notation, value } with
 *      unique notation and unique value.
 *   6. $id is an absolute URL, the /v<version>/ segment embedded in $id
 *      equals version, and version matches package.json.
 *
 * Checks 1-6 are errors. The following are warnings: they describe known
 * limitations of the 1.0 data model that are recorded under "Known issues"
 * in README.md and will be addressed in a model revision.
 *   7. Every property name has an explicit @context entry, except for the
 *      schema.org terms in VOCAB_ALLOWED_TERMS that are used through @vocab.
 *   8. No two properties on the same node resolve to the same IRI once the
 *      @context is applied (term -> value -> prefix expansion -> @vocab).
 *   9. Every entity @type is mapped in @context or is a schema.org class in
 *      VOCAB_ALLOWED_TYPES.
 *  10. Every @context term (other than a prefix) is used by the schema.
 *   Also warned: unknown keys, an unreferenced taxonomy file.
 *
 * Usage
 *   node scripts/validate.mjs [--schema <file>] [--taxonomies <dir>] [--package <file>] [--strict] [--quiet]
 *
 * Exit code 0 when there are no errors, 1 otherwise. Warnings do not fail
 * the run unless --strict is given (the shipped 1.0.0 schema has known
 * warnings, so --strict is expected to fail until the model revision).
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

/**
 * Property names that legitimately resolve through @vocab to the schema.org
 * term of the same name and therefore need no explicit @context entry. Every
 * other property name must be mapped explicitly, so that a misspelt or
 * invented name cannot silently become a non-existent schema.org IRI.
 */
export const VOCAB_ALLOWED_TERMS = new Set([
  'addressCountry', 'addressLocality', 'familyName', 'gender', 'givenName', 'location', 'postalCode', 'question',
]);

/**
 * Entity @type values that legitimately resolve through @vocab to an existing
 * schema.org class and therefore need no explicit @context entry.
 */
export const VOCAB_ALLOWED_TYPES = new Set(['Person', 'Action']);

/**
 * Appended to every warning about a known limitation of the 1.0 data model.
 * These are reported, not enforced: changing the model is out of scope for a
 * packaging release and is tracked as a separate model revision.
 */
export const MODEL_REVISION_NOTE = 'this will be addressed in a model revision; see "Known issues" in README.md';

const USAGE = 'usage: node scripts/validate.mjs [--schema <file>] [--taxonomies <dir>] [--package <file>] [--strict] [--quiet]\n' +
  '  --strict   treat warnings as errors (non-zero exit code)\n' +
  '  --quiet    print errors only';

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    schema: join(ROOT, 'schema', 'adc.schema.jsonld'),
    taxonomies: join(ROOT, 'taxonomies'),
    package: join(ROOT, 'package.json'),
    quiet: false,
    strict: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--schema') opts.schema = resolve(argv[++i]);
    else if (a === '--taxonomies') opts.taxonomies = resolve(argv[++i]);
    else if (a === '--package') opts.package = resolve(argv[++i]);
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--strict') opts.strict = true;
    else if (a === '--help' || a === '-h') {
      console.log(USAGE);
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

function termTarget(ctx, term) {
  const def = ctx[term];
  if (typeof def === 'string') return def;
  if (isPlainObject(def) && typeof def['@id'] === 'string') return def['@id'];
  return undefined;
}

/**
 * Resolves a property name to the IRI a JSON-LD processor would use for it,
 * given a simple @context: term -> its value -> compact-IRI prefix expansion
 * -> @vocab for anything relative. Keywords (@id, @type, ...) are returned
 * as they are. Returns undefined when the context is not an object.
 */
export function resolveTerm(ctx, name, depth = 0) {
  if (!isPlainObject(ctx) || typeof name !== 'string') return undefined;
  if (name.startsWith('@')) return name;
  const explicit = termTarget(ctx, name);
  const target = explicit === undefined ? name : explicit;
  if (target.startsWith('@')) return target;
  const colon = target.indexOf(':');
  if (colon > 0) {
    const prefix = target.slice(0, colon);
    const suffix = target.slice(colon + 1);
    if (prefix !== name && !suffix.startsWith('//') && termTarget(ctx, prefix) !== undefined && depth < 8) {
      const prefixIri = resolveTerm(ctx, prefix, depth + 1);
      if (isAbsoluteIri(prefixIri)) return prefixIri + suffix;
    }
    return target; // absolute IRI, blank node or undefined prefix (reported separately)
  }
  // A term whose value is another defined term takes that term's IRI (JSON-LD 1.1 §4.2.2).
  if (target !== name && termTarget(ctx, target) !== undefined && depth < 8) {
    return resolveTerm(ctx, target, depth + 1);
  }
  const vocab = typeof ctx['@vocab'] === 'string' ? ctx['@vocab'] : '';
  return vocab + target;
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
  if (typeof schema.$id === 'string' && typeof schema.version === 'string') {
    const m = /\/v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\//.exec(schema.$id);
    if (!m) {
      warnings.push('schema: $id does not embed a /v<version>/ path segment; cannot cross-check it against version');
    } else if (m[1] !== schema.version) {
      errors.push(`schema: $id embeds version "${m[1]}" but version is "${schema.version}"`);
    }
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
  const ctxIsObject = isPlainObject(ctx);

  /**
   * Checks the set of properties that live on one node (an entity's
   * top-level properties, or the properties of one nested object): every
   * name is mapped in @context or allow-listed, and no two names resolve
   * to the same IRI.
   */
  function checkNode(properties, path) {
    if (!ctxIsObject) return;
    const byIri = new Map(); // iri -> first property name
    for (const name of Object.keys(properties)) {
      const explicit = termTarget(ctx, name) !== undefined;
      if (!explicit && !VOCAB_ALLOWED_TERMS.has(name)) {
        warnings.push(`model review: property ${path}.${name} has no explicit @context entry and is not an allow-listed schema.org term, so it falls through @vocab to <${resolveTerm(ctx, name)}>; ${MODEL_REVISION_NOTE}`);
      }
      const iri = resolveTerm(ctx, name);
      if (typeof iri !== 'string' || iri.startsWith('@')) continue;
      if (byIri.has(iri)) {
        warnings.push(`model review: properties ${path}.${byIri.get(iri)} and ${path}.${name} both map to <${iri}>, so a JSON-LD processor cannot tell them apart; ${MODEL_REVISION_NOTE}`);
      } else byIri.set(iri, name);
    }
  }

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
    } else if (Array.isArray(prop.required)) {
      const names = isPlainObject(prop.properties) ? prop.properties : {};
      for (const r of prop.required) {
        if (!(r in names)) errors.push(`schema: ${path}.required names "${r}" but ${path} has no such property`);
      }
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
        checkNode(prop.properties, path);
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
      if (ctxIsObject && typeof entity['@type'] === 'string' && termTarget(ctx, entity['@type']) === undefined &&
          !VOCAB_ALLOWED_TYPES.has(entity['@type']) && !entity['@type'].includes(':')) {
        warnings.push(`model review: entity "${name}" @type "${entity['@type']}" has no explicit @context entry and is not an allow-listed schema.org class, so it falls through @vocab to <${resolveTerm(ctx, entity['@type'])}>; ${MODEL_REVISION_NOTE}`);
      }
      checkNode(entity.properties, name);
      for (const [propName, prop] of Object.entries(entity.properties)) {
        checkProperty(prop, `${name}.${propName}`);
      }
    }
  }

  // --- unused @context terms ---------------------------------------------
  if (ctxIsObject && isPlainObject(entities)) {
    const used = new Set();
    const collect = (props) => {
      if (!isPlainObject(props)) return;
      for (const [n, p] of Object.entries(props)) {
        used.add(n);
        if (isPlainObject(p)) {
          if (isPlainObject(p.properties)) collect(p.properties);
          if (isPlainObject(p.items) && isPlainObject(p.items.properties)) collect(p.items.properties);
        }
      }
    };
    for (const e of Object.values(entities)) {
      if (!isPlainObject(e)) continue;
      if (typeof e['@type'] === 'string') used.add(e['@type']);
      collect(e.properties);
    }
    for (const [term, def] of Object.entries(ctx)) {
      if (term.startsWith('@') || used.has(term)) continue;
      const target = typeof def === 'string' ? def : isPlainObject(def) ? def['@id'] : undefined;
      // a prefix (a term mapped to an absolute IRI that other terms use) is not a property
      const isPrefix = isAbsoluteIri(target) && Object.values(ctx).some((d) => {
        const t = typeof d === 'string' ? d : isPlainObject(d) ? d['@id'] : undefined;
        return typeof t === 'string' && t.startsWith(`${term}:`);
      });
      if (isPrefix) continue;
      warnings.push(`model review: @context term "${term}" is declared but no entity or property uses it; ${MODEL_REVISION_NOTE}`);
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
  if (opts.strict && warnings.length > 0) {
    if (opts.quiet) for (const w of warnings) console.error(`  warning: ${w}`);
    console.error(`\nFAILED (--strict): 0 errors, ${warnings.length} warning(s)`);
    process.exit(1);
  }
  if (!opts.quiet) console.log(`\nOK: 0 errors, ${warnings.length} warning(s)${opts.strict ? ' (strict)' : ''}`);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
