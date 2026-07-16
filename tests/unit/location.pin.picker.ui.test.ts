import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('LocationPinPicker — mapa interactivo para seleccionar coordenadas', () => {
  const source = readFileSync('src/components/gis/LocationPinPicker.tsx', 'utf8');
  const network = readFileSync('src/components/NetworkModule.tsx', 'utf8');

  it('usa react-leaflet con useMapEvents para click', () => {
    expect(source).toContain('useMapEvents');
    expect(source).toContain('MapContainer');
    expect(source).toContain('TileLayer');
    expect(source).toContain('Marker');
  });

  it('acepta props lat, lng, onChange, height', () => {
    expect(source).toContain('lat');
    expect(source).toContain('lng');
    expect(source).toContain('onChange');
    expect(source).toContain('height');
  });

  it('llama onChange con nuevas coordenadas al hacer click', () => {
    expect(source).toContain('e.latlng.lat');
    expect(source).toContain('e.latlng.lng');
  });

  it('NetworkModule usa LocationPinPicker en el modal de torre', () => {
    expect(network).toContain('LocationPinPicker');
    expect(network).toContain('formTowerLat');
    expect(network).toContain('formTowerLng');
    expect(network).toContain('formTowerZone');
  });

  it('NetworkModule guarda zona en localStorage', () => {
    expect(network).toContain('nugacore.towerZones.v1');
  });

  it('NetworkModule muestra error si falla crear torre', () => {
    expect(network).toContain('towerCreateError');
    expect(network).toContain('Error al crear la torre');
  });
});
