// Haversine great-circle distance. Shared by ShelterLocatorScreen (sorting
// shelters by distance) and useActiveSosLocationUpdates (deciding whether
// an SOS alert's position moved enough to be worth writing to the DB).
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return distanceKm(lat1, lon1, lat2, lon2) * 1000;
}
