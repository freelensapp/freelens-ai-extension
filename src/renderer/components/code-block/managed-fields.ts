// Matches the `managedFields:` key in a YAML document regardless of indentation.
export const MANAGED_FIELDS_KEY = /^(\s*)managedFields:\s*$/m;

// Removes the `metadata.managedFields` block from a YAML document. The key line
// and every following line indented deeper than it are dropped; the block ends
// at the first line indented at or below the key (or a blank line).
export const stripManagedFields = (yaml: string): string => {
  const lines = yaml.split("\n");
  const result: string[] = [];
  let blockIndent: number | null = null;

  for (const line of lines) {
    if (blockIndent !== null) {
      const indent = line.length - line.trimStart().length;
      if (line.trim() !== "" && indent > blockIndent) {
        continue;
      }
      blockIndent = null;
    }

    const match = /^(\s*)managedFields:\s*$/.exec(line);
    if (match) {
      blockIndent = match[1].length;
      continue;
    }

    result.push(line);
  }

  return result.join("\n");
};

// Whether the YAML document contains a `metadata.managedFields` block.
export const hasManagedFields = (yaml: string): boolean => MANAGED_FIELDS_KEY.test(yaml);
