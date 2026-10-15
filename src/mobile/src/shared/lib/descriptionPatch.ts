export function descriptionPatch(base: string, description: string) {
  return description === base ? {} : { description, baseDescription: base };
}
