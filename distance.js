export const haversineMeters = ([lng1, lat1], [lng2, lat2]) => {
  const toRad = d => d * Math.PI / 180;
  const R = 6371008.8; // mean Earth radius (m) used as common approximation
  const phi1 = toRad(lat1), phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lng2 - lng1);
  
  const a = Math.sin(deltaPhi/2)**2 + Math.cos(phi1)*Math.cos(phi2)*Math.sin(deltaLambda/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return R * c;
};

const M_PER_YD = 1 / 0.9144; // NIST exact yard definition

export const metersToYardsRounded = (m) => {
  return Math.round(m * M_PER_YD);
};
