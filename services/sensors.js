let sensorData = {
  aqi: 347,
  floodLevel: 3.8,
  seismic: 4.5,
  network: 94
};

function simulateSensors() {
  // AQI drift ± 2
  sensorData.aqi = Math.max(0, Math.min(500, sensorData.aqi + Math.floor((Math.random() - 0.5) * 5)));

  // Flood level drift ± 0.05
  sensorData.floodLevel = Math.max(0, sensorData.floodLevel + (Math.random() - 0.5) * 0.1);

  // Seismic drift ± 0.2
  sensorData.seismic = Math.max(0, Math.min(10, sensorData.seismic + (Math.random() - 0.5) * 0.4));

  // Network drift (rarely drops, mostly stable)
  if (Math.random() > 0.95) {
    sensorData.network = Math.max(0, sensorData.network - Math.floor(Math.random() * 5));
  } else if (sensorData.network < 100 && Math.random() > 0.8) {
    sensorData.network = Math.min(100, sensorData.network + 1);
  }

  return sensorData;
}

module.exports = {
  getSensors: () => sensorData,
  simulateSensors
};
