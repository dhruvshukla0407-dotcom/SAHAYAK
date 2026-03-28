let sensorData = {
  aqi: 347,
  floodLevel: 3.8,
  seismic: 4.5,
  network: 94,
  rainfall: 120,    // mm/day
  temp: 34,        // Celsius
  windSpeed: 45,   // km/h
  humidity: 78     // %
};

// Historical thresholds based on India 2014-2024
const HISTORICAL_PATTERNS = {
  KERALA_FLOODS_2018: { rainfall: [300, 600], floodLevel: [5.0, 9.0] },
  CYCLONE_FANI_2019: { windSpeed: [150, 250], rainfall: [100, 300] },
  HEATWAVE_2024: { temp: [45, 52], humidity: [10, 30] },
  SIKKIM_GLOF_2023: { floodLevel: [4.0, 10.0], seismic: [2.0, 5.0] }
};

function simulateSensors() {
  // Base drifts
  sensorData.aqi = Math.max(0, Math.min(500, sensorData.aqi + Math.floor((Math.random() - 0.5) * 5)));
  sensorData.floodLevel = Math.max(0, sensorData.floodLevel + (Math.random() - 0.5) * 0.1);
  sensorData.seismic = Math.max(0, Math.min(10, sensorData.seismic + (Math.random() - 0.5) * 0.4));

  // New drifts for AI prediction
  sensorData.rainfall = Math.max(0, sensorData.rainfall + (Math.random() - 0.5) * 20);
  sensorData.temp = Math.max(15, Math.min(55, sensorData.temp + (Math.random() - 0.5) * 2));
  sensorData.windSpeed = Math.max(0, sensorData.windSpeed + (Math.random() - 0.5) * 15);
  sensorData.humidity = Math.max(10, Math.min(100, sensorData.humidity + (Math.random() - 0.5) * 5));

  // Network drift
  if (Math.random() > 0.95) {
    sensorData.network = Math.max(0, sensorData.network - Math.floor(Math.random() * 5));
  } else if (sensorData.network < 100 && Math.random() > 0.8) {
    sensorData.network = Math.min(100, sensorData.network + 1);
  }

  // Check for historical matches (simplified)
  let activeAnomalies = [];
  if (sensorData.rainfall > 350) activeAnomalies.push('KERALA_2018_PROFILE');
  if (sensorData.windSpeed > 180) activeAnomalies.push('FANI_2019_PROFILE');
  if (sensorData.temp > 48) activeAnomalies.push('HEATWAVE_2024_PROFILE');

  sensorData.anomalies = activeAnomalies;

  return sensorData;
}

module.exports = {
  getSensors: () => sensorData,
  simulateSensors
};
