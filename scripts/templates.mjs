export function replaceTokens(text, values) {
  return text.replace(/__([A-Za-z]+)__/g, (token, name) =>
    Object.hasOwn(values, name) ? values[name] : token,
  );
}

export function renderTemplate(file, values, io) {
  const original = io.readFileSync(file, "utf8");
  const rendered = replaceTokens(original, values);
  if (rendered !== original) io.writeFileSync(file, rendered);
}
