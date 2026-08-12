import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

const PRODUCTION_FIELDS = [
  'PRODUCTION_DB_URL',
  'PRODUCTION_SUPABASE_URL',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_STORAGE_S3_ENDPOINT',
  'SUPABASE_STORAGE_S3_ACCESS_KEY_ID',
  'SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY',
  'BACKUP_RCLONE_REMOTE',
  'BACKUP_OFFSITE_CONFIRMED',
  'BACKUP_OFFSITE_HOST',
  'BACKUP_ON_HOST_IDENTITIES',
  'BACKUP_OFFSITE_BUCKET',
  'BACKUP_NAMESPACE_ID',
  'BACKUP_MARKER_HMAC_KEY_FILE',
  'BACKUP_GPG_RECIPIENT',
  'BACKUP_RETENTION_DAYS',
  'RESTORE_POSTGRES_IMAGE',
  'RESTORE_TMPFS_SIZE',
  'RESTORE_REQUIRED_TABLES',
];

const OPTIONAL_PRODUCTION_FIELDS = ['BACKUP_RCLONE_PATH'];
const ROUTEROS_FIELDS = [
  'ROUTEROS_LAB_CONFIRMED',
  'ROUTEROS_LAB_HOST',
  'ROUTEROS_LAB_PORT',
  'ROUTEROS_LAB_USER',
  'ROUTEROS_LAB_EXPECTED_IDENTITY',
  'ROUTEROS_LAB_PASSWORD',
  'ROUTEROS_LAB_SSH_KEY_PATH',
];
const HOSTED_RESTORE_FIELDS = [
  'RESTORE_TARGET_CONFIRMED_ISOLATED',
  'RESTORE_TARGET_PROJECT_REF',
  'RESTORE_TARGET_DB_URL',
  'RESTORE_TARGET_SUPABASE_URL',
  'RESTORE_TARGET_SUPABASE_SERVICE_ROLE_KEY',
  'RESTORE_TARGET_STORAGE_S3_ENDPOINT',
  'RESTORE_TARGET_STORAGE_S3_ACCESS_KEY_ID',
  'RESTORE_TARGET_STORAGE_S3_SECRET_ACCESS_KEY',
];

export const GL02_ENV_FIELDS = new Set([
  ...PRODUCTION_FIELDS,
  ...OPTIONAL_PRODUCTION_FIELDS,
  ...ROUTEROS_FIELDS,
  ...HOSTED_RESTORE_FIELDS,
]);

const unique = (items) => [...new Set(items)];
const unquote = (value) => {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
};

export const parseStrictEnvDocument = (text, allowedFields = GL02_ENV_FIELDS) => {
  const values = new Map();
  const errors = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      errors.push('ENV_MALFORMED_LINE');
      continue;
    }
    const [, name, rawValue] = match;
    if (values.has(name)) errors.push(`ENV_DUPLICATE_${name}`);
    if (!allowedFields.has(name)) errors.push(`ENV_UNKNOWN_${name}`);
    const value = unquote(rawValue);
    // dotenv is data, never shell. Reject expansion, substitutions and command separators.
    if (/\$\(|\$\{|`|[\r\n\0]|(?:^|\s)[;&|<>]/.test(value)) {
      errors.push(`ENV_UNSAFE_${name}`);
    }
    if (!values.has(name)) values.set(name, value);
  }
  return { values, errors: unique(errors) };
};

// Retained as a compatibility read-only parser. Operational scripts use the strict parser.
export const parseEnvDocument = (text) => parseStrictEnvDocument(text).values;

export const parseRcloneConfig = (text) => {
  const sections = new Map();
  let current = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const section = /^\[([^\]]+)]$/.exec(line);
    if (section) {
      current = section[1].trim();
      sections.set(current, new Map());
      continue;
    }
    const setting = /^([^=]+)=(.*)$/.exec(line);
    if (current && setting) sections.get(current).set(setting[1].trim(), setting[2].trim());
  }
  return sections;
};

export const validateSecretFileMetadata = ({ uid, mode }) => {
  const missing = [];
  if (uid !== 0) missing.push('FILE_OWNER_ROOT');
  if ((mode & 0o777) !== 0o600) missing.push('FILE_MODE_0600');
  return missing;
};

const canonicalRef = (value) => String(value || '').trim().toLowerCase();
const validRef = (value) => /^[a-z0-9]{20}$/.test(canonicalRef(value));

const endpointHost = (value) => {
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
};

const dbProjectRef = (value) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(host);
    if (direct) return direct[1];
    const poolerUser = /^postgres\.([a-z0-9]{20})$/i.exec(decodeURIComponent(url.username));
    return poolerUser?.[1]?.toLowerCase() || '';
  } catch {
    return '';
  }
};

const apiProjectRef = (value) => {
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(endpointHost(value));
  return match?.[1] || '';
};

const storageProjectRef = (value) => {
  const match = /^([a-z0-9]{20})\.storage\.supabase\.co$/.exec(endpointHost(value));
  return match?.[1] || '';
};

const isPrivateIpv4 = (host) => {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 0
  );
};

const isPublicHttpsEndpoint = (value, expectedHost) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (host !== canonicalRef(expectedHost).replace(/\.$/, '')) return false;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
    if (isIP(host) === 4 && isPrivateIpv4(host)) return false;
    if (isIP(host) === 6 && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb'))) return false;
    return true;
  } catch {
    return false;
  }
};

const validateSupabaseIdentity = (env, fields, label, missing) => {
  const ref = canonicalRef(env.get(fields.ref));
  if (!validRef(ref)) missing.push(`${fields.ref}_VALID`);
  const identities = [
    dbProjectRef(env.get(fields.db)),
    apiProjectRef(env.get(fields.api)),
    storageProjectRef(env.get(fields.storage)),
  ];
  if (!ref || identities.some((identity) => identity !== ref)) {
    missing.push(`${label}_PROJECT_IDENTITY_CONSISTENT`);
  }
  return ref;
};

const encryptedBacking = (remoteName, sections) => {
  const crypt = sections.get(remoteName);
  if (crypt?.get('type') !== 'crypt') return null;
  const backingSpec = crypt.get('remote') || '';
  const separator = backingSpec.indexOf(':');
  if (separator <= 0) return null;
  const backingName = backingSpec.slice(0, separator);
  const prefix = backingSpec.slice(separator + 1).replace(/^\/+|\/+$/g, '');
  if (backingName === remoteName) return null;
  const backing = sections.get(backingName);
  if (backing?.get('type') !== 's3') return null;
  return { backing, prefix };
};

export const validateProductionBackupConfig = (envText, rcloneText) => {
  const parsed = parseStrictEnvDocument(envText);
  const env = parsed.values;
  const rclone = parseRcloneConfig(rcloneText);
  const missing = [...parsed.errors, ...PRODUCTION_FIELDS.filter((field) => !env.get(field))];

  validateSupabaseIdentity(env, {
    ref: 'SUPABASE_PROJECT_REF', db: 'PRODUCTION_DB_URL', api: 'PRODUCTION_SUPABASE_URL',
    storage: 'SUPABASE_STORAGE_S3_ENDPOINT',
  }, 'PRODUCTION', missing);
  if (env.get('BACKUP_OFFSITE_CONFIRMED') !== 'true') missing.push('BACKUP_OFFSITE_CONFIRMED_TRUE');

  const remoteName = env.get('BACKUP_RCLONE_REMOTE');
  const backing = encryptedBacking(remoteName, rclone);
  if (!backing) {
    if (remoteName) missing.push('BACKUP_RCLONE_REMOTE_ENCRYPTED_OFF_HOST');
  } else {
    if (!isPublicHttpsEndpoint(backing.backing.get('endpoint'), env.get('BACKUP_OFFSITE_HOST'))) {
      missing.push('BACKUP_RCLONE_BACKING_PUBLIC_HTTPS');
    }
    const onHost = (env.get('BACKUP_ON_HOST_IDENTITIES') || '').split(',')
      .map((value) => canonicalRef(value).replace(/\.$/, '')).filter(Boolean);
    if (onHost.includes(canonicalRef(env.get('BACKUP_OFFSITE_HOST')).replace(/\.$/, ''))) {
      missing.push('BACKUP_RCLONE_BACKING_NOT_ON_HOST');
    }
    const expectedPrefix = `${env.get('BACKUP_OFFSITE_BUCKET') || ''}/${env.get('BACKUP_NAMESPACE_ID') || ''}`;
    if (backing.prefix !== expectedPrefix) missing.push('BACKUP_RCLONE_PREFIX_ALLOWLISTED');
  }

  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.get('BACKUP_OFFSITE_BUCKET') || '')) {
    missing.push('BACKUP_OFFSITE_BUCKET_VALID');
  }
  if (!(env.get('BACKUP_ON_HOST_IDENTITIES') || '').split(',').every((value) => /^[A-Za-z0-9.:_-]+$/.test(value))) {
    missing.push('BACKUP_ON_HOST_IDENTITIES_VALID');
  }
  if (!/^nugacore-production-[a-f0-9]{16,64}$/.test(env.get('BACKUP_NAMESPACE_ID') || '')) {
    missing.push('BACKUP_NAMESPACE_ID_VALID');
  }
  const hmacPath = env.get('BACKUP_MARKER_HMAC_KEY_FILE') || '';
  if (!/^\/root\/[A-Za-z0-9._-]+$/.test(hmacPath)) missing.push('BACKUP_MARKER_HMAC_KEY_FILE_UNDER_ROOT');

  const retention = env.get('BACKUP_RETENTION_DAYS');
  if (retention && (!/^\d+$/.test(retention) || Number(retention) < 7 || Number(retention) > 365)) {
    missing.push('BACKUP_RETENTION_DAYS_7_TO_365');
  }
  const image = env.get('RESTORE_POSTGRES_IMAGE');
  if (image && !/^[^\s]+@sha256:[0-9a-f]{64}$/.test(image)) missing.push('RESTORE_POSTGRES_IMAGE_PINNED_DIGEST');
  const tmpfs = /^(\d+)([mMgG])$/.exec(env.get('RESTORE_TMPFS_SIZE') || '');
  const mib = tmpfs ? Number(tmpfs[1]) * (tmpfs[2].toLowerCase() === 'g' ? 1024 : 1) : 0;
  if (env.get('RESTORE_TMPFS_SIZE') && (mib < 256 || mib > 64 * 1024)) missing.push('RESTORE_TMPFS_SIZE_BOUNDED');
  const tables = env.get('RESTORE_REQUIRED_TABLES');
  if (tables && !/^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$/.test(tables)) missing.push('RESTORE_REQUIRED_TABLES_CSV');

  const normalized = unique(missing);
  return { ok: normalized.length === 0, missing: normalized };
};

export const validateRouterOsLabConfig = (envText) => {
  const parsed = parseStrictEnvDocument(envText, new Set(ROUTEROS_FIELDS));
  const env = parsed.values;
  const missing = [...parsed.errors];
  for (const field of ['ROUTEROS_LAB_HOST', 'ROUTEROS_LAB_PORT', 'ROUTEROS_LAB_USER', 'ROUTEROS_LAB_EXPECTED_IDENTITY']) {
    if (!env.get(field)) missing.push(field);
  }
  if (env.get('ROUTEROS_LAB_CONFIRMED') !== 'true') missing.unshift('ROUTEROS_LAB_CONFIRMED_TRUE');
  const port = env.get('ROUTEROS_LAB_PORT');
  if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) missing.push('ROUTEROS_LAB_PORT_VALID');
  const password = env.get('ROUTEROS_LAB_PASSWORD');
  const keyPath = env.get('ROUTEROS_LAB_SSH_KEY_PATH');
  if (!password && !keyPath) missing.push('ROUTEROS_LAB_CREDENTIAL');
  if (password && keyPath) missing.push('ROUTEROS_LAB_CREDENTIAL_EXCLUSIVE');
  if (keyPath && !keyPath.startsWith('/root/')) missing.push('ROUTEROS_LAB_SSH_KEY_UNDER_ROOT');
  const normalized = unique(missing);
  return { ok: normalized.length === 0, missing: normalized };
};

export const validateHostedRestoreConfig = (envText) => {
  const parsed = parseStrictEnvDocument(envText);
  const env = parsed.values;
  const missing = [...parsed.errors, ...HOSTED_RESTORE_FIELDS.filter((field) => !env.get(field))];
  if (env.get('RESTORE_TARGET_CONFIRMED_ISOLATED') !== 'true') missing.unshift('RESTORE_TARGET_CONFIRMED_ISOLATED_TRUE');
  const sourceRef = validateSupabaseIdentity(env, {
    ref: 'SUPABASE_PROJECT_REF', db: 'PRODUCTION_DB_URL', api: 'PRODUCTION_SUPABASE_URL',
    storage: 'SUPABASE_STORAGE_S3_ENDPOINT',
  }, 'PRODUCTION', missing);
  const targetRef = validateSupabaseIdentity(env, {
    ref: 'RESTORE_TARGET_PROJECT_REF', db: 'RESTORE_TARGET_DB_URL', api: 'RESTORE_TARGET_SUPABASE_URL',
    storage: 'RESTORE_TARGET_STORAGE_S3_ENDPOINT',
  }, 'RESTORE_TARGET', missing);
  if (sourceRef && targetRef && sourceRef === targetRef) missing.push('RESTORE_TARGET_DISTINCT_FROM_PRODUCTION');
  const normalized = unique(missing);
  return { ok: normalized.length === 0, missing: normalized };
};

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

export const createSignedMarker = (payload, key) => {
  const body = { ...payload };
  delete body.hmac;
  return { ...body, hmac: createHmac('sha256', key).update(canonicalJson(body)).digest('hex') };
};

export const verifySignedMarker = (marker, key) => {
  if (!marker || typeof marker !== 'object' || typeof marker.hmac !== 'string' || !/^[a-f0-9]{64}$/.test(marker.hmac)) return false;
  const expected = createSignedMarker(marker, key).hmac;
  return timingSafeEqual(Buffer.from(marker.hmac, 'hex'), Buffer.from(expected, 'hex'));
};

export const validateRestoreEvidence = (evidence, key) => {
  const missing = [];
  if (!evidence || typeof evidence !== 'object') return { ok: false, missing: ['EVIDENCE_DOCUMENT_VALID'] };
  if (evidence.version !== 1) missing.push('EVIDENCE_VERSION_1');
  if (evidence.kind !== 'RESTORE_EVIDENCE') missing.push('EVIDENCE_KIND_RESTORE_EVIDENCE');
  if (!key || !verifySignedMarker(evidence, key)) missing.push('EVIDENCE_HMAC_VERIFIED');
  if (evidence.status !== 'verified') missing.push('EVIDENCE_STATUS_VERIFIED');
  if (!isBackupId(evidence.backupId)) missing.push('EVIDENCE_BACKUP_ID_VALID');
  for (const field of ['sourceProjectRefHash', 'targetProjectRefHash']) {
    if (!/^[a-f0-9]{64}$/.test(evidence[field] || '')) missing.push(`EVIDENCE_${field.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}_VALID`);
  }
  if (evidence.sourceProjectRefHash === evidence.targetProjectRefHash) missing.push('EVIDENCE_PROJECT_HASHES_DISTINCT');
  const flags = {
    sourceTargetDistinct: 'SOURCE_TARGET_DISTINCT', completeMarkerVerified: 'COMPLETE_MARKER_VERIFIED',
    manifestVerified: 'MANIFEST_VERIFIED', databaseRestored: 'DATABASE_RESTORED', storageRestored: 'STORAGE_RESTORED',
    rolesVerified: 'ROLES_VERIFIED', coolifyVerified: 'COOLIFY_VERIFIED', controlPlaneVerified: 'CONTROL_PLANE_VERIFIED',
    routerOsLabRollbackVerified: 'ROUTEROS_LAB_ROLLBACK_VERIFIED',
  };
  for (const [field, label] of Object.entries(flags)) if (evidence[field] !== true) missing.push(`EVIDENCE_${label}_TRUE`);
  if (!(Number.isFinite(evidence.rpoHours) && evidence.rpoHours > 0)) missing.push('EVIDENCE_RPO_HOURS_POSITIVE');
  if (!(Number.isFinite(evidence.rtoHours) && evidence.rtoHours > 0)) missing.push('EVIDENCE_RTO_HOURS_POSITIVE');
  return { ok: missing.length === 0, missing };
};

export const formatMissingFields = (scope, missing) => {
  const names = unique(missing).map((name) => `- ${name}`).join('\n');
  return `${scope}: BLOCKED\nmissing fields:\n${names}`;
};

export const isBackupId = (value) => {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(value));
  if (!match) return false;
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
  const parsed = new Date(iso);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().replace(/[-:]/g, '').replace('.000', '') === value;
};

const backupIdDate = (value) => {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
};
export const expiredBackupIds = (entries, retentionDays, now = new Date()) => {
  const cutoff = now.valueOf() - retentionDays * 86400000;
  return entries.filter(isBackupId).filter((id) => backupIdDate(id).valueOf() < cutoff).sort();
};
export const isSafeRestoreTempPath = (value) => /^\/(?:var\/tmp|dev\/shm)\/nugacore-gl02-restore\.[A-Za-z0-9_-]+$/.test(String(value));
