const ANNOTATIONS = new Set(["$schema", "$id", "title", "description", "$defs"]);

/** Validation errors as "path: message"; empty when valid. */
export function validate(schema, instance, root = schema, path = "$", errors = []) {
  const isObject = typeof instance === "object" && instance !== null && !Array.isArray(instance);
  for (const [keyword, value] of Object.entries(schema)) {
    switch (keyword) {
      case "$ref": {
        if (!value.startsWith("#/$defs/")) throw new Error(`unsupported $ref ${value}`);
        validate(root.$defs[value.slice(8)], instance, root, path, errors);
        break;
      }
      case "type": {
        const types = Array.isArray(value) ? value : [value];
        const ok = types.some((t) => t === "integer" ? Number.isInteger(instance)
          : t === "number" ? typeof instance === "number"
          : t === "array" ? Array.isArray(instance)
          : t === "object" ? isObject
          : t === "null" ? instance === null
          : typeof instance === t);
        if (!ok) errors.push(`${path}: expected ${types.join("|")}`);
        break;
      }
      case "const": if (JSON.stringify(instance) !== JSON.stringify(value)) errors.push(`${path}: expected ${JSON.stringify(value)}`); break;
      case "enum": if (!value.some((o) => JSON.stringify(o) === JSON.stringify(instance))) errors.push(`${path}: not one of ${JSON.stringify(value)}`); break;
      case "pattern": if (typeof instance === "string" && !new RegExp(value).test(instance)) errors.push(`${path}: '${instance}' does not match ${value}`); break;
      case "minimum": if (typeof instance === "number" && instance < value) errors.push(`${path}: ${instance} < ${value}`); break;
      case "maximum": if (typeof instance === "number" && instance > value) errors.push(`${path}: ${instance} > ${value}`); break;
      case "minItems": if (Array.isArray(instance) && instance.length < value) errors.push(`${path}: fewer than ${value} items`); break;
      case "maxItems": if (Array.isArray(instance) && instance.length > value) errors.push(`${path}: more than ${value} items`); break;
      case "items": if (Array.isArray(instance)) instance.forEach((item, i) => validate(value, item, root, `${path}[${i}]`, errors)); break;
      case "required": if (isObject) for (const p of value) if (!(p in instance)) errors.push(`${path}: missing '${p}'`); break;
      case "properties":
        if (isObject) for (const [k, v] of Object.entries(instance)) if (k in value) validate(value[k], v, root, `${path}.${k}`, errors);
        break;
      case "additionalProperties":
        if (value !== false) throw new Error("only additionalProperties: false is supported");
        if (isObject) for (const k of Object.keys(instance)) if (!(k in (schema.properties ?? {}))) errors.push(`${path}: unexpected property '${k}'`);
        break;
      case "oneOf": {
        const n = value.filter((o) => validate(o, instance, root, path, []).length === 0).length;
        if (n !== 1) errors.push(`${path}: matches ${n} oneOf alternatives instead of exactly one`);
        break;
      }
      default:
        if (!ANNOTATIONS.has(keyword)) throw new Error(`unsupported keyword '${keyword}'`);
    }
  }
  return errors;
}

/** Cross-field checks for one vector that has already passed vector.v1 schema validation. */
export function validateVectorSemantics(vec, path = vec.id) {
  const errors = [];
  const ctx = vec.context;
  for (const [i, c] of vec.cases.entries()) {
    const where = `${path} case ${i}`;
    const end = ctx.baseOffset + c.hex.length / 2;
    if (c.error && !(c.error.offset >= ctx.baseOffset && c.error.offset <= end)) errors.push(`${where}: error offset ${c.error.offset} outside [${ctx.baseOffset}, ${end}]`);
    if (vec.entry === "META" && ctx.inputEnd !== end) errors.push(`${where}: inputEnd ${ctx.inputEnd} != baseOffset + byte count (${end})`);
    if (vec.entry === "META" && ctx.sectionEnd < ctx.inputEnd) errors.push(`${where}: sectionEnd ${ctx.sectionEnd} < inputEnd ${ctx.inputEnd}`);
    if (vec.entry === "META" && !vec.provenance && ctx.sectionEnd !== ctx.inputEnd) errors.push(`${where}: synthetic META fragments are complete sections (sectionEnd == inputEnd)`);
    if (vec.entry === "SEC" && c.result && (c.result.width !== ctx.width || c.result.height !== ctx.height || c.result.tiles.length !== ctx.width * ctx.height)) errors.push(`${where}: grid does not match the ${ctx.width}x${ctx.height} context`);
  }
  return errors;
}
