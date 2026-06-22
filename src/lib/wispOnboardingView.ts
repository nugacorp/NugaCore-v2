export const isValidLatitudeInput = (value: string | number): boolean => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= -90 && parsed <= 90;
};

export const isValidLongitudeInput = (value: string | number): boolean => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= -180 && parsed <= 180;
};

export const areValidCoordinates = (
  latitude: string | number,
  longitude: string | number,
): boolean => isValidLatitudeInput(latitude) && isValidLongitudeInput(longitude);

export const capacityTone = (utilizationPercent: number): 'green' | 'yellow' | 'red' => {
  if (utilizationPercent < 70) return 'green';
  if (utilizationPercent <= 85) return 'yellow';
  return 'red';
};

export const capacityToneClasses = (utilizationPercent: number): string => {
  const tone = capacityTone(utilizationPercent);
  if (tone === 'green') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (tone === 'yellow') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
};
