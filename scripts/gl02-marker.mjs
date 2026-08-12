#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createSignedMarker, parseStrictEnvDocument } from './lib/gl02-backup-config.mjs';

const envPath = process.env.GL02_TEST_MODE === '1' && process.env.GL02_PRODUCTION_ENV
  ? process.env.GL02_PRODUCTION_ENV : '/root/nugacore-production-backup.env';
const parsed = parseStrictEnvDocument(readFileSync(envPath, 'utf8'));
if (parsed.errors.length) process.exit(1);
const key = readFileSync(parsed.values.get('BACKUP_MARKER_HMAC_KEY_FILE'), 'utf8').trim();
const kind = process.argv[2];
if (kind !== 'ownership') process.exit(2);
process.stdout.write(`${JSON.stringify(createSignedMarker({
  version: 1,
  kind: 'OWNERSHIP',
  namespaceId: parsed.values.get('BACKUP_NAMESPACE_ID'),
}, key))}\n`);
