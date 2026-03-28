const droneData = {
  'ALPHA-1': { lat: 12.8236, lon: 80.0420, alt: 120, spd: 8.4, hdg: 214, bat: 87, sig: -62, name: 'ALPHA-1', mode: 'AUTO' },
  'BRAVO-2': { lat: 12.8225, lon: 80.0440, alt: 85, spd: 6.1, hdg: 178, bat: 54, sig: -70, name: 'BRAVO-2', mode: 'AUTO' },
  'ECHO-3': { lat: 12.8200, lon: 80.0380, alt: 200, spd: 9.8, hdg: 310, bat: 22, sig: -76, name: 'ECHO-3', mode: 'RTL' },
  'DELTA-4': { lat: 12.8250, lon: 80.0460, alt: 150, spd: 7.3, hdg: 90, bat: 91, sig: -58, name: 'DELTA-4', mode: 'AUTO' },
};

function simulateTelemetry() {
  for (const droneId in droneData) {
    const d = droneData[droneId];
    // Gentle drift
    d.lat += (Math.random() - 0.5) * 0.00008;
    d.lon += (Math.random() - 0.5) * 0.00008;
    d.alt += (Math.random() - 0.48) * 0.6;
    d.alt = Math.max(30, Math.min(250, d.alt));
    d.spd += (Math.random() - 0.5) * 0.3;
    d.spd = Math.max(0, Math.min(20, d.spd));
    d.hdg += (Math.random() - 0.5) * 2;
    d.hdg = ((d.hdg % 360) + 360) % 360;
    d.sig += (Math.random() - 0.5) * 2;
    d.sig = Math.max(-90, Math.min(-40, d.sig));

    // Decrease battery slowly
    if (d.bat > 0 && Math.random() > 0.9) {
      d.bat = Math.max(0, d.bat - 1);
    }
  }
  return droneData;
}

module.exports = {
  getTelemetry: () => droneData,
  simulateTelemetry
};
