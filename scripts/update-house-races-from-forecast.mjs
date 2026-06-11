import fs from 'fs';

// Read house forecast
const houseForecast = JSON.parse(fs.readFileSync('data/house-forecast.json', 'utf8'));
const electionNightRaces = JSON.parse(fs.readFileSync('data/election-night-races.json', 'utf8'));

// Create a map of existing house races
const houseRaceMap = new Map();
electionNightRaces.races.forEach(race => {
  if (race.type === 'house') {
    houseRaceMap.set(race.id, race);
  }
});

// Update house races with forecast data
houseForecast.districts.forEach(district => {
  const raceId = `house-${district.id}`;
  const existingRace = houseRaceMap.get(raceId);
  
  if (existingRace) {
    // Update existing race with forecast data
    existingRace.candidates = [];
    
    // Add Democratic candidate
    if (district.demCandidate && district.demCandidate !== 'Democrat' && district.demCandidate !== 'Democratic') {
      existingRace.candidates.push({
        name: district.demCandidate,
        party: 'D',
        isIncumbent: district.incumbent === district.demCandidate,
        isWinner: district.winnerParty === 'D',
        votes: 0,
        percent: district.demProbability * 100
      });
    }
    
    // Add Republican candidate
    if (district.repCandidate && district.repCandidate !== 'Republican' && district.repCandidate !== 'Republican') {
      existingRace.candidates.push({
        name: district.repCandidate,
        party: 'R',
        isIncumbent: district.incumbent === district.repCandidate,
        isWinner: district.winnerParty === 'R',
        votes: 0,
        percent: district.repProbability * 100
      });
    }
    
    // If no candidates found, add placeholder
    if (existingRace.candidates.length === 0) {
      existingRace.candidates.push({
        name: district.demCandidate || 'Democrat',
        party: 'D',
        isIncumbent: false,
        isWinner: district.winnerParty === 'D',
        votes: 0,
        percent: district.demProbability * 100
      });
      existingRace.candidates.push({
        name: district.repCandidate || 'Republican',
        party: 'R',
        isIncumbent: false,
        isWinner: district.winnerParty === 'R',
        votes: 0,
        percent: district.repProbability * 100
      });
    }
  }
});

// Write updated races back
fs.writeFileSync('data/election-night-races.json', JSON.stringify(electionNightRaces, null, 2));
console.log('Updated house races from forecast');
