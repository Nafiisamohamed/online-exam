/**
 * CSV parsing helper. Headers are normalised to snake_case lower case so
 * "Student ID", "student_id" and "STUDENT ID" all become `student_id`.
 * Returns rows with their original line number (header = line 1) for error reports.
 * Errors: 400 CSV_INVALID if the text is not parseable CSV.
 */
import { parse } from 'csv-parse/sync';
import { badRequest } from './errors';

export interface CsvRow {
  line: number;
  data: Record<string, string>;
}

export const MAX_CSV_ROWS = 2000;

export function parseCsv(text: string): CsvRow[] {
  let records: Record<string, string>[];
  try {
    records = parse(text.replace(/^﻿/, ''), {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (err) {
    throw badRequest('CSV_INVALID', `The file is not valid CSV: ${(err as Error).message}`);
  }
  if (records.length > MAX_CSV_ROWS) throw badRequest('CSV_TOO_LARGE', `At most ${MAX_CSV_ROWS} rows per file`);
  return records.map((data, i) => ({ line: i + 2, data }));
}
