#!/usr/bin/env node

import {
  expiredBackupIds,
  isBackupId,
  isSafeRestoreTempPath,
} from './lib/gl02-backup-config.mjs';

const [operation, value] = process.argv.slice(2);

if (operation === 'backup-id') {
  process.exit(isBackupId(value) ? 0 : 1);
}

if (operation === 'safe-restore-temp') {
  process.exit(isSafeRestoreTempPath(value) ? 0 : 1);
}

if (operation === 'expired-backup-ids') {
  const retentionDays = Number(value);
  if (!Number.isInteger(retentionDays) || retentionDays < 7 || retentionDays > 365) process.exit(1);
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  for (const id of expiredBackupIds(input.split(/\r?\n/), retentionDays)) console.log(id);
  process.exit(0);
}

process.exit(2);
