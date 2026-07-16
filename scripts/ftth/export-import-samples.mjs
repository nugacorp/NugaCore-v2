#!/usr/bin/env node
/**
 * Exporta CSV/GeoJSON reales de NAPs y tramos desde una API NugaCore.
 *
 * Uso:
 *   BASE_URL="https://...sslip.io" AUTH_BEARER="<jwt>" node scripts/ftth/export-import-samples.mjs
 *
 * Variables opcionales:
 *   OUTPUT_DIR=artifacts/ftth-import
 *   ROLE_HEADER="super admin" USER_ID_HEADER="cloud-agent"
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '');
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'artifacts/ftth-import';
const AUTH_BEARER = process.env.AUTH_BEARER || '';
const ROLE_HEADER = process.env.ROLE_HEADER || 'super admin';
const USER_ID_HEADER = process.env.USER_ID_HEADER || 'cloud-agent';

if (!BASE_URL) {
  console.error('Missing BASE_URL. Example: BASE_URL="https://nugacore-staging....sslip.io"');
  process.exit(1);
}

const headers = {
  Accept: 'application/json',
  ...(AUTH_BEARER ? { Authorization: `Bearer ${AUTH_BEARER}` } : {}),
  // fallback útil en entornos dev/staging con trusted headers
  'x-user-role': ROLE_HEADER,
  'x-user-id': USER_ID_HEADER,
};

const getJson = async (pathname) => {
  const res = await fetch(`${BASE_URL}${pathname}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${pathname} failed: ${res.status} ${body}`);
  }
  return res.json();
};

const csvEscape = (value) => {
  const s = String(value ?? '');
  if (/[,"\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
};

const napsToCsv = (naps) => {
  const header = ['id', 'name', 'lat', 'lng', 'pon_port', 'split_ratio', 'fibers_total', 'coverage_m'];
  const rows = naps.map((n) => [
    n.id,
    n.name,
    n.lat,
    n.lng,
    n.ponPort || '',
    n.splitRatio || '',
    n.fibersTotal ?? (Array.isArray(n.ports) ? n.ports.length : ''),
    n.coverageMeters ?? '',
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
};

const segmentsToCsv = (segments) => {
  const header = ['id', 'name', 'from_id', 'to_id', 'type', 'thread_count', 'coordinates'];
  const rows = segments.map((s) => [
    s.id,
    s.name,
    s.fromRef || '',
    s.toRef || '',
    s.segmentType || 'feeder',
    s.threadCount ?? 12,
    JSON.stringify(s.coordinates || []),
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
};

const toGeoJson = (naps, segments) => ({
  type: 'FeatureCollection',
  features: [
    ...naps
      .filter((n) => Number.isFinite(n.lat) && Number.isFinite(n.lng))
      .map((n) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(n.lng), Number(n.lat)] },
        properties: {
          id: n.id,
          name: n.name,
          pon_port: n.ponPort || '',
          split_ratio: n.splitRatio || '',
          fibers_total: n.fibersTotal ?? (Array.isArray(n.ports) ? n.ports.length : undefined),
          coverage_m: n.coverageMeters ?? undefined,
        },
      })),
    ...segments
      .filter((s) => Array.isArray(s.coordinates) && s.coordinates.length >= 2)
      .map((s) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: s.coordinates.map(([lat, lng]) => [Number(lng), Number(lat)]),
        },
        properties: {
          id: s.id,
          name: s.name,
          from_id: s.fromRef || '',
          to_id: s.toRef || '',
          type: s.segmentType || 'feeder',
          thread_count: s.threadCount ?? 12,
          nap_id: s.napId || '',
          pon_port: s.ponPort || '',
        },
      })),
  ],
});

const main = async () => {
  const [naps, segments] = await Promise.all([
    getJson('/api/naps'),
    getJson('/api/ftth/segments').catch(() => []),
  ]);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUTPUT_DIR, 'naps.csv'), `${napsToCsv(naps)}\n`, 'utf8');
  await fs.writeFile(path.join(OUTPUT_DIR, 'segments.csv'), `${segmentsToCsv(segments)}\n`, 'utf8');
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'ftth.geojson'),
    `${JSON.stringify(toGeoJson(naps, segments), null, 2)}\n`,
    'utf8',
  );

  console.log(`Export complete in ${OUTPUT_DIR}`);
  console.log(`- naps.csv (${naps.length} naps)`);
  console.log(`- segments.csv (${segments.length} segments)`);
  console.log('- ftth.geojson');
};

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
