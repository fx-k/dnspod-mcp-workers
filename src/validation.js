/** 只实现本项目实际生成的 JSON Schema 关键字，未知关键字由 CI 元 Schema 检查。 */
export function validate(schema, value, path = "arguments") {
  const fail = (message) => { throw new Error(`${path}: ${message}`); };
  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail("必须是对象");
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail(`缺少 ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties || {}, key)) {
        if (schema.additionalProperties === false) fail(`不支持的参数 ${key}`);
      } else validate(schema.properties[key], item, `${path}.${key}`);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) fail("必须是数组");
    if (schema.minItems !== undefined && value.length < schema.minItems) fail("数组不能为空");
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`最多 ${schema.maxItems} 项`);
    if (schema.uniqueItems && new Set(value.map((x) => JSON.stringify(x))).size !== value.length) fail("不允许重复项");
    value.forEach((item, i) => validate(schema.items, item, `${path}[${i}]`));
  } else if (schema.type === "integer") {
    if (!Number.isSafeInteger(value)) fail("必须是安全整数");
  } else if (schema.type && typeof value !== schema.type) fail(`必须是 ${schema.type}`);
  if (schema.enum && !schema.enum.includes(value)) fail(`必须是 ${schema.enum.join(" / ")}`);
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`不能小于 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`不能大于 ${schema.maximum}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail("不能为空");
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(`长度不能超过 ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) fail("格式不正确");
  }
  return value;
}

export function canonicalDomain(value) {
  if (typeof value !== "string" || !value.trim() || /[\s/:?#@\\]/u.test(value)) throw new Error("Domain 必须是纯域名，不得包含 URL、端口或路径");
  const name = new URL(`https://${value}`).hostname.toLowerCase().replace(/\.$/u, "");
  if (name.length > 253 || !name.includes(".") || name.split(".").some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(part))) throw new Error("Domain 格式不正确");
  return name;
}

export function validateDates(args) {
  for (const key of ["StartDate", "EndDate"]) {
    if (args[key] !== undefined && (!/^\d{4}-\d{2}-\d{2}$/u.test(args[key]) || Number.isNaN(Date.parse(args[key])) || new Date(args[key]).toISOString().slice(0, 10) !== args[key])) throw new Error(`${key} 必须是有效 YYYY-MM-DD 日期`);
  }
  if (args.StartDate && args.EndDate && args.StartDate > args.EndDate) throw new Error("StartDate 不能晚于 EndDate");
}
