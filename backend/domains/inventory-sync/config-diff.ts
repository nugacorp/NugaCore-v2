// ====================================================================
// Diff de líneas entre dos exports de configuración (READ-ONLY).
// ====================================================================

export type ConfigDiffLineType = 'same' | 'add' | 'remove';

export interface ConfigDiffLine {
  type: ConfigDiffLineType;
  line: string;
  lineNo?: number;
}

/** Diff simple línea a línea (estilo unified-lite). */
export const diffExportText = (before: string, after: string): ConfigDiffLine[] => {
  const a = before.split('\n');
  const b = after.split('\n');
  const result: ConfigDiffLine[] = [];

  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined && right !== undefined) {
      result.push({ type: 'add', line: right, lineNo: i + 1 });
    } else if (right === undefined && left !== undefined) {
      result.push({ type: 'remove', line: left, lineNo: i + 1 });
    } else if (left !== right) {
      result.push({ type: 'remove', line: left!, lineNo: i + 1 });
      result.push({ type: 'add', line: right!, lineNo: i + 1 });
    } else {
      result.push({ type: 'same', line: left!, lineNo: i + 1 });
    }
  }

  return result;
};

export const summarizeDiff = (lines: ConfigDiffLine[]): { added: number; removed: number; unchanged: number } => {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const line of lines) {
    if (line.type === 'add') added += 1;
    else if (line.type === 'remove') removed += 1;
    else unchanged += 1;
  }
  return { added, removed, unchanged };
};
