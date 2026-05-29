import { readFileSync, writeFileSync } from "node:fs";

const FORECAST_URL = new URL("../data/governor-forecast.json", import.meta.url);
const previousForecast = readPreviousForecast();

const SETTINGS = {
  simulations: 50000,
  electionDate: "2026-11-03",
  currentDemGovernors: 24,
  currentRepGovernors: 26,
  demNotUp: 6,
  repNotUp: 8,
  dataSources: [
    "Manual 2026 gubernatorial race ledger with candidates, incumbency, PVI, and last gubernatorial margin",
    "Cook Political Report, Inside Elections, Sabato's Crystal Ball, WH, VoteHub, and RCP rating references",
    "Current Senate model generic ballot signal as a broad midterm environment input"
  ]
};

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IA: "Iowa", KS: "Kansas", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NM: "New Mexico", NY: "New York", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", VT: "Vermont", WI: "Wisconsin", WY: "Wyoming"
};

const RATING_TO_MARGIN = {
  "Safe D": 18, "Likely D": 10.5, "Lean D": 5, "Tilt D": 2.1, "Toss-up": 0,
  "Tilt R": -2.1, "Lean R": -5, "Likely R": -10.5, "Safe R": -18
};

const RATING_TO_ERROR = {
  "Safe D": 7.5, "Likely D": 8.5, "Lean D": 9.5, "Tilt D": 10.5, "Toss-up": 11,
  "Tilt R": 10.5, "Lean R": 9.5, "Likely R": 8.5, "Safe R": 7.5
};

const GOVERNOR_RACES = [
  { state: "AL", incumbentParty: "R", incumbent: "Kay Ivey", status: "Term-limited", pvi: -15, lastMargin: -33.8, rating: "Safe R", demCandidate: "Doug Jones", repCandidate: "Tommy Tuberville", candidateEdge: 1.2 },
  { state: "AK", incumbentParty: "R", incumbent: "Mike Dunleavy", status: "Term-limited", pvi: -6, lastMargin: -5.7, rating: "Lean R", demCandidate: "Tom Begich / Matt Claman", repCandidate: "Republican field", candidateEdge: .4 },
  { state: "AZ", incumbentParty: "D", incumbent: "Katie Hobbs", status: "Incumbent running", pvi: -2, lastMargin: .6, rating: "Toss-up", demCandidate: "Katie Hobbs", repCandidate: "Andy Biggs / David Schweikert", candidateEdge: -.4 },
  { state: "AR", incumbentParty: "R", incumbent: "Sarah Huckabee Sanders", status: "Incumbent renominated", pvi: -15, lastMargin: -26, rating: "Safe R", demCandidate: "Fredrick Love", repCandidate: "Sarah Huckabee Sanders", candidateEdge: -1 },
  { state: "CA", incumbentParty: "D", incumbent: "Gavin Newsom", status: "Term-limited", pvi: 12, lastMargin: 18.4, rating: "Safe D", demCandidate: "Democratic field", repCandidate: "Steve Hilton / Chad Bianco", candidateEdge: .3 },
  { state: "CO", incumbentParty: "D", incumbent: "Jared Polis", status: "Term-limited", pvi: 6, lastMargin: 19.3, rating: "Safe D", demCandidate: "Michael Bennet / Phil Weiser", repCandidate: "Barbara Kirkmeyer / GOP field", candidateEdge: 1.3 },
  { state: "CT", incumbentParty: "D", incumbent: "Ned Lamont", status: "Incumbent running", pvi: 8, lastMargin: 12, rating: "Safe D", demCandidate: "Ned Lamont", repCandidate: "Ryan Fazio", candidateEdge: .6 },
  { state: "FL", incumbentParty: "R", incumbent: "Ron DeSantis", status: "Term-limited", pvi: -5, lastMargin: -19.4, rating: "Likely R", demCandidate: "Jerry Demings / David Jolly", repCandidate: "Byron Donalds / GOP field", candidateEdge: -.2 },
  { state: "GA", incumbentParty: "R", incumbent: "Brian Kemp", status: "Term-limited", pvi: -1, lastMargin: -7.5, rating: "Toss-up", demCandidate: "Keisha Lance Bottoms", repCandidate: "Burt Jones / Rick Jackson", candidateEdge: .5 },
  { state: "HI", incumbentParty: "D", incumbent: "Josh Green", status: "Incumbent running", pvi: 13, lastMargin: 26.4, rating: "Safe D", demCandidate: "Josh Green", repCandidate: "Gary Cordery", candidateEdge: 1 },
  { state: "ID", incumbentParty: "R", incumbent: "Brad Little", status: "Incumbent renominated", pvi: -18, lastMargin: -20.6, rating: "Safe R", demCandidate: "Terri Pickens", repCandidate: "Brad Little", candidateEdge: -1 },
  { state: "IL", incumbentParty: "D", incumbent: "JB Pritzker", status: "Incumbent renominated", pvi: 6, lastMargin: 12.5, rating: "Safe D", demCandidate: "JB Pritzker", repCandidate: "Darren Bailey", candidateEdge: 1.1 },
  { state: "IA", incumbentParty: "R", incumbent: "Kim Reynolds", status: "Incumbent retiring", pvi: -6, lastMargin: -18.6, rating: "Toss-up", demCandidate: "Rob Sand", repCandidate: "Randy Feenstra / GOP field", candidateEdge: 2.4 },
  { state: "KS", incumbentParty: "D", incumbent: "Laura Kelly", status: "Term-limited", pvi: -8, lastMargin: 2.2, rating: "Lean R", demCandidate: "Ethan Corson / Cindy Holscher", repCandidate: "Jeff Colyer / Vicki Schmidt / Scott Schwab", candidateEdge: .5 },
  { state: "ME", incumbentParty: "D", incumbent: "Janet Mills", status: "Term-limited", pvi: 4, lastMargin: 12.8, rating: "Likely D", demCandidate: "Shenna Bellows / Troy Jackson / Angus King III", repCandidate: "Garrett Mason / GOP field", candidateEdge: .4 },
  { state: "MD", incumbentParty: "D", incumbent: "Wes Moore", status: "Incumbent running", pvi: 15, lastMargin: 29.9, rating: "Safe D", demCandidate: "Wes Moore", repCandidate: "Republican field", candidateEdge: 1.5 },
  { state: "MA", incumbentParty: "D", incumbent: "Maura Healey", status: "Incumbent running", pvi: 14, lastMargin: 29.2, rating: "Safe D", demCandidate: "Maura Healey", repCandidate: "Republican field", candidateEdge: 1.2 },
  { state: "MI", incumbentParty: "D", incumbent: "Gretchen Whitmer", status: "Term-limited", pvi: 0, lastMargin: 10.6, rating: "Lean D", demCandidate: "Jocelyn Benson / Democratic field", repCandidate: "Republican field", candidateEdge: .8 },
  { state: "MN", incumbentParty: "D", incumbent: "Tim Walz", status: "Incumbent retiring", pvi: 3, lastMargin: 7.7, rating: "Safe D", demCandidate: "DFL field", repCandidate: "Republican field", candidateEdge: .4 },
  { state: "NE", incumbentParty: "R", incumbent: "Jim Pillen", status: "Incumbent running", pvi: -10, lastMargin: -23.8, rating: "Safe R", demCandidate: "Democratic field", repCandidate: "Jim Pillen", candidateEdge: -1 },
  { state: "NV", incumbentParty: "R", incumbent: "Joe Lombardo", status: "Incumbent running", pvi: -1, lastMargin: -1.5, rating: "Toss-up", demCandidate: "Democratic field", repCandidate: "Joe Lombardo", candidateEdge: -1.6 },
  { state: "NH", incumbentParty: "R", incumbent: "Kelly Ayotte", status: "Incumbent running", pvi: 2, lastMargin: -9.2, rating: "Likely R", demCandidate: "Democratic field", repCandidate: "Kelly Ayotte", candidateEdge: -1.6 },
  { state: "NM", incumbentParty: "D", incumbent: "Michelle Lujan Grisham", status: "Term-limited", pvi: 4, lastMargin: 6.4, rating: "Likely D", demCandidate: "Democratic field", repCandidate: "Republican field", candidateEdge: .2 },
  { state: "NY", incumbentParty: "D", incumbent: "Kathy Hochul", status: "Incumbent running", pvi: 8, lastMargin: 6.4, rating: "Likely D", demCandidate: "Kathy Hochul", repCandidate: "Republican field", candidateEdge: .3 },
  { state: "OH", incumbentParty: "R", incumbent: "Mike DeWine", status: "Term-limited", pvi: -5, lastMargin: -25.4, rating: "Lean R", demCandidate: "Democratic field", repCandidate: "Vivek Ramaswamy / GOP field", candidateEdge: -.6 },
  { state: "OK", incumbentParty: "R", incumbent: "Kevin Stitt", status: "Term-limited", pvi: -17, lastMargin: -13.7, rating: "Safe R", demCandidate: "Democratic field", repCandidate: "Republican field", candidateEdge: -.4 },
  { state: "OR", incumbentParty: "D", incumbent: "Tina Kotek", status: "Incumbent running", pvi: 8, lastMargin: 3.4, rating: "Likely D", demCandidate: "Tina Kotek", repCandidate: "Republican field", candidateEdge: .2 },
  { state: "PA", incumbentParty: "D", incumbent: "Josh Shapiro", status: "Incumbent running", pvi: -1, lastMargin: 14.8, rating: "Safe D", demCandidate: "Josh Shapiro", repCandidate: "Republican field", candidateEdge: 3.8 },
  { state: "RI", incumbentParty: "D", incumbent: "Dan McKee", status: "Incumbent running", pvi: 8, lastMargin: 19.3, rating: "Safe D", demCandidate: "Dan McKee", repCandidate: "Republican field", candidateEdge: .5 },
  { state: "SC", incumbentParty: "R", incumbent: "Henry McMaster", status: "Term-limited", pvi: -8, lastMargin: -17.8, rating: "Likely R", demCandidate: "Democratic field", repCandidate: "Pamela Evette / Nancy Mace / Alan Wilson", candidateEdge: -.5 },
  { state: "SD", incumbentParty: "R", incumbent: "Larry Rhoden", status: "Incumbent running", pvi: -15, lastMargin: -24, rating: "Safe R", demCandidate: "Dan Ahlers", repCandidate: "Larry Rhoden / GOP field", candidateEdge: -.8 },
  { state: "TN", incumbentParty: "R", incumbent: "Bill Lee", status: "Term-limited", pvi: -14, lastMargin: -32.7, rating: "Safe R", demCandidate: "Democratic field", repCandidate: "Marsha Blackburn / John Rose / GOP field", candidateEdge: -.8 },
  { state: "TX", incumbentParty: "R", incumbent: "Greg Abbott", status: "Incumbent renominated", pvi: -6, lastMargin: -10.9, rating: "Safe R", demCandidate: "Gina Hinojosa", repCandidate: "Greg Abbott", candidateEdge: -1.7 },
  { state: "VT", incumbentParty: "R", incumbent: "Phil Scott", status: "Incumbent running", pvi: 17, lastMargin: -46.9, rating: "Safe R", demCandidate: "Amanda Janoo / Aly Richards", repCandidate: "Phil Scott", candidateEdge: -6.5 },
  { state: "WI", incumbentParty: "D", incumbent: "Tony Evers", status: "Incumbent retiring", pvi: 0, lastMargin: 3.4, rating: "Toss-up", demCandidate: "Mandela Barnes / Democratic field", repCandidate: "Tom Tiffany", candidateEdge: .4 },
  { state: "WY", incumbentParty: "R", incumbent: "Mark Gordon", status: "Term-limited", pvi: -23, lastMargin: -53.8, rating: "Safe R", demCandidate: "Gabriel Green", repCandidate: "Megan Degenfelder / Eric Barlow", candidateEdge: -.8 }
];

const GOVERNOR_CANDIDATE_STATUS = {
  AL: { dem: "Doug Jones", rep: "Tommy Tuberville", demStatus: "presumptive", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-05-19", primarySummary: "Alabama's governor field is treated as unsettled until the state primary is complete; Jones and Tuberville are modeled as the major-party front-runners." },
  AK: { dem: "Tom Begich / Matt Claman", rep: "Republican field", demStatus: "unresolved", repStatus: "unresolved", primary: "top-four", primaryDate: "2026-08-18", extraCandidates: [{ name: "Gregg Brelsford", party: "I", note: "Independent listed in the candidate field" }, { name: "Meda DeWitt", party: "I", note: "Independent listed in the candidate field" }], primarySummary: "Alaska uses a nonpartisan top-four primary. Multiple Democrats, Republicans, and independents remain possible general-election options." },
  AZ: { dem: "Katie Hobbs", rep: "Andy Biggs / David Schweikert", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-04", primarySummary: "Hobbs is the Democratic incumbent and treated as presumptive; the Republican primary remains open." },
  AR: { dem: "Fredrick Love", rep: "Sarah Huckabee Sanders", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-03-03", primarySummary: "Sanders and Love are treated as nominated after Arkansas' March primary." },
  CA: { dem: "Democratic field", rep: "Steve Hilton / Chad Bianco", demStatus: "unresolved", repStatus: "unresolved", primary: "top-two", primaryDate: "2026-06-02", extraCandidates: [{ name: "Katie Porter", party: "D", note: "Major Democratic option" }, { name: "Xavier Becerra", party: "D", note: "Major Democratic option" }, { name: "Chad Bianco", party: "R", note: "Major Republican option" }, { name: "Steve Hilton", party: "R", note: "Major Republican option" }], primarySummary: "California's top-two primary has a large field; the model treats both parties as unresolved." },
  CO: { dem: "Michael Bennet / Phil Weiser", rep: "Barbara Kirkmeyer / GOP field", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-30", primarySummary: "Colorado's open-seat primaries remain unresolved; Bennet and Weiser are the leading Democratic names in the ledger." },
  CT: { dem: "Ned Lamont", rep: "Ryan Fazio", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-11", primarySummary: "Lamont is the Democratic incumbent and treated as presumptive while the Republican side remains unsettled." },
  FL: { dem: "Jerry Demings / David Jolly", rep: "Byron Donalds / GOP field", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-18", extraCandidates: [{ name: "Jason Pizzo", party: "I", note: "Independent option in the field" }], primarySummary: "Florida is an open seat with both major-party primaries unresolved and one notable independent option tracked separately." },
  GA: { dem: "Keisha Lance Bottoms", rep: "Burt Jones / Rick Jackson", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-05-19", primarySummary: "Bottoms is treated as the Democratic front-runner; the Republican primary remains open." },
  HI: { dem: "Josh Green", rep: "Gary Cordery", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-08", primarySummary: "Green is the Democratic incumbent and treated as presumptive." },
  ID: { dem: "Terri Pickens", rep: "Brad Little", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-05-19", primarySummary: "Little and Pickens are treated as nominated after Idaho's May primary." },
  IL: { dem: "JB Pritzker", rep: "Darren Bailey", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-03-17", primarySummary: "Pritzker and Bailey are treated as nominated after Illinois' March primary." },
  IA: { dem: "Rob Sand", rep: "Randy Feenstra / GOP field", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-02", primarySummary: "Sand is treated as the Democratic front-runner in the open-seat race; the Republican primary remains unresolved." },
  KS: { dem: "Ethan Corson / Cindy Holscher", rep: "Jeff Colyer / Vicki Schmidt / Scott Schwab", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-04", primarySummary: "Both Kansas primaries remain unresolved in the manual ledger." },
  ME: { dem: "Shenna Bellows / Troy Jackson / Angus King III", rep: "Garrett Mason / GOP field", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-09", extraCandidates: [{ name: "Rick Bennett", party: "I", note: "Independent listed in the candidate field" }, { name: "Ed Crockett", party: "I", note: "Independent listed in the candidate field" }], primarySummary: "Maine's open-seat field is unsettled and includes independent candidates." },
  MD: { dem: "Wes Moore", rep: "Republican field", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-23", primarySummary: "Moore is the Democratic incumbent and treated as presumptive." },
  MA: { dem: "Maura Healey", rep: "Republican field", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-09-01", primarySummary: "Healey is the Democratic incumbent and treated as presumptive." },
  MI: { dem: "Jocelyn Benson / Democratic field", rep: "Republican field", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-04", primarySummary: "Michigan is an open seat with both primaries unresolved." },
  MN: { dem: "DFL field", rep: "Republican field", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-11", primarySummary: "Minnesota is an open seat and both primaries remain unresolved." },
  NE: { dem: "Democratic field", rep: "Jim Pillen", demStatus: "unresolved", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-05-12", primarySummary: "Pillen is the Republican incumbent and treated as presumptive." },
  NV: { dem: "Democratic field", rep: "Joe Lombardo", demStatus: "unresolved", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-06-09", primarySummary: "Lombardo is the Republican incumbent and treated as presumptive." },
  NH: { dem: "Democratic field", rep: "Kelly Ayotte", demStatus: "unresolved", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-09-08", primarySummary: "Ayotte is the Republican incumbent and treated as presumptive." },
  NM: { dem: "Democratic field", rep: "Republican field", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-02", primarySummary: "New Mexico is an open seat and both primaries remain unresolved." },
  NY: { dem: "Kathy Hochul", rep: "Republican field", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-23", primarySummary: "Hochul is the Democratic incumbent and treated as presumptive." },
  OH: { dem: "Democratic field", rep: "Vivek Ramaswamy / GOP field", demStatus: "unresolved", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-05-05", primarySummary: "Ohio is an open seat; Ramaswamy is treated as the Republican front-runner while the Democratic field remains unresolved." },
  OK: { dem: "Democratic field", rep: "Republican field", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-16", primarySummary: "Oklahoma is an open seat and both primaries remain unresolved." },
  OR: { dem: "Tina Kotek", rep: "Republican field", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-05-19", primarySummary: "Kotek is the Democratic incumbent and treated as presumptive." },
  PA: { dem: "Josh Shapiro", rep: "Republican field", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-05-19", primarySummary: "Shapiro is the Democratic incumbent and treated as presumptive." },
  RI: { dem: "Dan McKee", rep: "Republican field", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-09-09", primarySummary: "McKee is the Democratic incumbent and treated as presumptive." },
  SC: { dem: "Democratic field", rep: "Pamela Evette / Nancy Mace / Alan Wilson", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-09", primarySummary: "South Carolina is an open seat and both primaries remain unresolved." },
  SD: { dem: "Dan Ahlers", rep: "Larry Rhoden / GOP field", demStatus: "unresolved", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-06-02", primarySummary: "Rhoden is the Republican incumbent and treated as presumptive, though the GOP field is tracked as contested." },
  TN: { dem: "Democratic field", rep: "Marsha Blackburn / John Rose / GOP field", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-06", extraCandidates: [{ name: "Misam Abidi", party: "I", note: "Independent listed in the candidate field" }], primarySummary: "Tennessee is an open seat with crowded major-party and independent candidate fields." },
  TX: { dem: "Gina Hinojosa", rep: "Greg Abbott", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-03-03", primarySummary: "Abbott and Hinojosa are treated as nominated after the Texas primary." },
  VT: { dem: "Amanda Janoo / Aly Richards", rep: "Phil Scott", demStatus: "unresolved", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-08-11", primarySummary: "Scott is the Republican incumbent and treated as presumptive; Democrats have multiple declared candidates." },
  WI: { dem: "Mandela Barnes / Democratic field", rep: "Tom Tiffany", demStatus: "unresolved", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-08-11", primarySummary: "Wisconsin is an open seat. Tiffany is treated as the Republican front-runner; the Democratic primary remains unresolved." },
  WY: { dem: "Gabriel Green", rep: "Megan Degenfelder / Eric Barlow", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-18", primarySummary: "Wyoming is an open seat and both primaries remain unresolved." }
};

const GOVERNOR_DEMOGRAPHIC_PROFILES = {
  incumbentDemocrat: { white_college: .12, white_noncollege: -.06, black: .08, latino: .05, asian_other: .05, youth: .02, senior: .04 },
  incumbentRepublican: { white_college: -.02, white_noncollege: .12, black: -.07, latino: -.03, asian_other: -.02, youth: -.05, senior: .08 },
  statewideDemocrat: { white_college: .1, white_noncollege: -.02, black: .08, latino: .05, asian_other: .04, youth: .03, senior: .01 },
  statewideRepublican: { white_college: -.03, white_noncollege: .11, black: -.07, latino: -.03, asian_other: -.02, youth: -.05, senior: .06 },
  standardDemocrat: { white_college: .06, white_noncollege: -.05, black: .07, latino: .04, asian_other: .03, youth: .03, senior: -.01 },
  standardRepublican: { white_college: -.06, white_noncollege: .1, black: -.07, latino: -.04, asian_other: -.03, youth: -.04, senior: .05 },
  independent: { white_college: .04, white_noncollege: .12, black: .01, latino: .02, asian_other: .02, youth: .05, senior: .01 }
};

const GOVERNOR_CANDIDATE_DEMOGRAPHIC_PROFILES = {
  "phil scott": { profile: "popular Vermont Republican incumbent", scores: { white_college: .18, white_noncollege: .3, black: -.02, latino: .01, asian_other: .02, youth: .02, senior: .22 }, strengths: ["White college", "White non-college", "65+"], weaknesses: [] },
  "josh shapiro": { profile: "high-approval Pennsylvania Democratic incumbent", scores: { white_college: .18, white_noncollege: .08, black: .1, latino: .04, asian_other: .05, youth: .03, senior: .12 }, strengths: ["White college", "White non-college", "65+"], weaknesses: [] },
  "rob sand": { profile: "Iowa statewide Democratic auditor", scores: { white_college: .08, white_noncollege: .18, black: .04, latino: .03, asian_other: .02, youth: .04, senior: .06 }, strengths: ["White non-college", "White college"], weaknesses: [] },
  "joe lombardo": { profile: "Nevada Republican incumbent", scores: { white_college: -.02, white_noncollege: .12, black: -.06, latino: .02, asian_other: -.01, youth: -.04, senior: .08 }, strengths: ["White non-college", "65+", "Latino"], weaknesses: ["18-29"] },
  "kelly ayotte": { profile: "New Hampshire Republican incumbent", scores: { white_college: .02, white_noncollege: .1, black: -.05, latino: -.02, asian_other: -.01, youth: -.05, senior: .08 }, strengths: ["White college", "65+"], weaknesses: ["18-29"] },
  "katie hobbs": { profile: "Arizona Democratic incumbent", scores: { white_college: .12, white_noncollege: -.05, black: .06, latino: .08, asian_other: .04, youth: .03, senior: -.01 }, strengths: ["White college", "Latino"], weaknesses: ["White non-college"] },
  "greg abbott": { profile: "Texas Republican incumbent", scores: { white_college: -.08, white_noncollege: .2, black: -.09, latino: .02, asian_other: -.04, youth: -.08, senior: .12 }, strengths: ["White non-college", "65+", "Latino"], weaknesses: ["White college", "18-29"] },
  "vivek ramaswamy / gop field": { profile: "Ohio Republican entrepreneur front-runner", scores: { white_college: -.09, white_noncollege: .17, black: -.09, latino: -.02, asian_other: .01, youth: -.02, senior: .03 }, strengths: ["White non-college"], weaknesses: ["White college", "Black"] },
  "jocelyn benson / democratic field": { profile: "Michigan Democratic statewide-office field", scores: { white_college: .13, white_noncollege: -.01, black: .08, latino: .03, asian_other: .04, youth: .04, senior: .02 }, strengths: ["White college", "Black"], weaknesses: [] },
  "tom tiffany": { profile: "Wisconsin Republican congressional profile", scores: { white_college: -.08, white_noncollege: .18, black: -.08, latino: -.03, asian_other: -.03, youth: -.06, senior: .06 }, strengths: ["White non-college"], weaknesses: ["White college", "18-29"] }
};

function readPreviousForecast() {
  try {
    return JSON.parse(readFileSync(FORECAST_URL, "utf8"));
  } catch {
    return null;
  }
}

function readSenateSignals() {
  try {
    const senate = JSON.parse(readFileSync(new URL("../data/forecast.json", import.meta.url), "utf8"));
    const generic = Number(senate?.sourceSummary?.genericPolling?.genericBallotMargin);
    const approval = Number(senate?.sourceSummary?.trumpApproval?.netApproximation);
    return {
      genericBallotMargin: Number.isFinite(generic) ? generic : 0,
      approvalNet: Number.isFinite(approval) ? approval : null
    };
  } catch {
    return { genericBallotMargin: 0, approvalNet: null };
  }
}

function erf(value) {
  const sign = Math.sign(value);
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(value, mean, sd) {
  return 0.5 * (1 + erf((value - mean) / (sd * Math.sqrt(2))));
}

function sampleNormal(mean, sd) {
  const u1 = Math.max(Math.random(), Number.EPSILON);
  const u2 = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function candidateProfileKey(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function governorProfileKey(race, party) {
  const status = party === "D" ? race.demStatus : race.repStatus;
  const displayParty = party === "D" ? race.demDisplayParty : race.repDisplayParty;
  if (displayParty === "I") return "independent";
  if (party === "D" && race.incumbentParty === "D" && status === "presumptive") return "incumbentDemocrat";
  if (party === "R" && race.incumbentParty === "R" && status === "presumptive") return "incumbentRepublican";
  if (party === "D" && /(governor|auditor|secretary|attorney|senator|mayor|representative|statewide)/i.test(race.dem || "")) return "statewideDemocrat";
  if (party === "R" && /(governor|auditor|secretary|attorney|senator|mayor|representative|statewide)/i.test(race.rep || "")) return "statewideRepublican";
  return party === "D" ? "standardDemocrat" : "standardRepublican";
}

function governorCandidateProfile(race, party) {
  const name = party === "D" ? race.dem : race.rep;
  const specific = GOVERNOR_CANDIDATE_DEMOGRAPHIC_PROFILES[candidateProfileKey(name)];
  if (specific) {
    return { key: candidateProfileKey(name), label: name, source: "candidate", ...specific };
  }
  const genericKey = governorProfileKey(race, party);
  return {
    key: genericKey,
    label: genericKey.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()),
    source: "generic",
    scores: GOVERNOR_DEMOGRAPHIC_PROFILES[genericKey] || {},
    strengths: [],
    weaknesses: []
  };
}

function governorElectorateWeights(state) {
  const pvi = GOVERNOR_RACES.find((race) => race.state === state)?.pvi || 0;
  const sunbelt = ["AZ", "CA", "FL", "GA", "NV", "NM", "TX"].includes(state);
  const blackBelt = ["AL", "AR", "FL", "GA", "MD", "SC"].includes(state);
  const college = ["CA", "CO", "CT", "MA", "MD", "MN", "NY", "OR", "PA", "VT", "WI"].includes(state);
  const rural = Math.abs(pvi) >= 8 || ["AK", "IA", "KS", "ME", "NE", "NH", "SD", "WY"].includes(state);
  const weights = {
    white_college: college ? .3 : rural ? .17 : .23,
    white_noncollege: rural ? .42 : college ? .22 : .31,
    black: blackBelt ? .2 : .08,
    latino: sunbelt ? .18 : .06,
    asian_other: ["CA", "HI", "MA", "MD", "NY", "VA", "WA"].includes(state) ? .1 : .04,
    youth: college || sunbelt ? .12 : .09,
    senior: rural ? .18 : .13
  };
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Number((value / total).toFixed(4))]));
}

function demographicPullAdjustment(race) {
  const weights = governorElectorateWeights(race.state);
  const demProfile = governorCandidateProfile(race, "D");
  const repProfile = governorCandidateProfile(race, "R");
  const groups = Object.keys(weights).map((group) => {
    const effect = weights[group] * ((demProfile.scores[group] || 0) - (repProfile.scores[group] || 0)) * 1.35;
    return { group, weight: weights[group], effect: Number(effect.toFixed(2)) };
  });
  const raw = groups.reduce((sum, group) => sum + group.effect, 0);
  const saturation = Math.abs(race.pvi) > 15 ? .5 : Math.abs(race.pvi) > 8 ? .75 : 1;
  return {
    adjustment: Number(clamp(raw * saturation, -1, 1).toFixed(2)),
    demProfile,
    repProfile,
    topGroups: groups.filter((group) => Math.abs(group.effect) >= .02).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)).slice(0, 5)
  };
}

function ratingFromProbability(probability, margin) {
  const side = probability >= 0.5 ? "D" : "R";
  const winnerProbability = Math.max(probability, 1 - probability);
  const absMargin = Math.abs(margin);
  if (winnerProbability >= 0.97 || absMargin >= 15) return `Safe ${side}`;
  if (winnerProbability >= 0.84 || absMargin >= 8) return `Likely ${side}`;
  if (winnerProbability >= 0.68 || absMargin >= 4) return `Lean ${side}`;
  if (winnerProbability >= 0.56 || absMargin >= 1.5) return `Tilt ${side}`;
  return "Toss-up";
}

function statusEffect(race) {
  if (race.status.includes("Incumbent")) return race.incumbentParty === "D" ? 2.4 : -2.4;
  if (race.status.includes("Term-limited") || race.status.includes("retiring")) return race.incumbentParty === "D" ? -.8 : .8;
  return 0;
}

function buildRace(baseRace, nationalShift) {
  const candidateInfo = GOVERNOR_CANDIDATE_STATUS[baseRace.state] || {};
  const race = {
    ...baseRace,
    ...candidateInfo,
    dem: candidateInfo.dem || baseRace.demCandidate || "Democratic field",
    rep: candidateInfo.rep || baseRace.repCandidate || "Republican field",
    demStatus: candidateInfo.demStatus || "unresolved",
    repStatus: candidateInfo.repStatus || "unresolved",
    independent: candidateInfo.extraCandidates?.some((candidate) => candidate.party === "I") ? "tracked independent candidate" : "none",
    caucusTarget: "none"
  };
  const ratingMargin = RATING_TO_MARGIN[race.rating] ?? 0;
  const fundamentals = (race.pvi * .38) + (race.lastMargin * .24) + statusEffect(race);
  const candidateAndLocal = race.candidateEdge || 0;
  const demographicPull = demographicPullAdjustment(race);
  const margin = (ratingMargin * .58) + (fundamentals * .34) + candidateAndLocal + nationalShift + demographicPull.adjustment;
  const error = clamp((RATING_TO_ERROR[race.rating] ?? 9.5) + (race.status.includes("Term-limited") || race.status.includes("retiring") ? 1.2 : 0), 6.5, 13.5);
  const demProbability = clamp(normalCdf(margin, 0, error), 0.01, 0.99);
  const winnerParty = demProbability >= .5 ? "D" : "R";
  return {
    ...race,
    displayName: `${STATE_NAMES[race.state]} Governor`,
    demCandidate: race.dem,
    repCandidate: race.rep,
    margin: Number(margin.toFixed(2)),
    fundamentalsMargin: Number(fundamentals.toFixed(2)),
    ratingMargin: Number(ratingMargin.toFixed(2)),
    candidateAndLocal: Number(candidateAndLocal.toFixed(2)),
    demographicPull,
    modelRating: ratingFromProbability(demProbability, margin),
    demProbability: Number(demProbability.toFixed(5)),
    repProbability: Number((1 - demProbability).toFixed(5)),
    winnerParty,
    winnerProbability: Number(Math.max(demProbability, 1 - demProbability).toFixed(5)),
    competitive: demProbability > 0.25 && demProbability < 0.75
  };
}

function appendHistory(forecast) {
  const key = forecast.modelDate;
  const point = { date: key, demGovernors: forecast.medianDemGovernors, repGovernors: forecast.medianRepGovernors };
  const history = Array.isArray(previousForecast?.governorCountHistory) ? previousForecast.governorCountHistory.filter((item) => item.date !== key) : [];
  history.push(point);
  return history.slice(-365);
}

function buildForecast() {
  const senateSignals = readSenateSignals();
  const nationalShift = clamp(senateSignals.genericBallotMargin * 0.18, -1.8, 1.8);
  const modeledRaces = GOVERNOR_RACES.map((race) => buildRace(race, nationalShift));
  const distribution = {};
  const decisive = Object.fromEntries(modeledRaces.map((race) => [race.state, 0]));
  const demCounts = [];
  let demWinningRaceTotal = 0;
  let repWinningRaceTotal = 0;
  let demCountTotal = 0;
  let repCountTotal = 0;

  for (let simulation = 0; simulation < SETTINGS.simulations; simulation += 1) {
    let demGovernors = SETTINGS.demNotUp;
    const sampled = [];
    for (const race of modeledRaces) {
      const error = clamp((RATING_TO_ERROR[race.rating] ?? 9.5) + (race.status.includes("Term-limited") || race.status.includes("retiring") ? 1.2 : 0), 6.5, 13.5);
      const sampledMargin = sampleNormal(race.margin, error);
      const demWin = sampledMargin > 0;
      if (demWin) demGovernors += 1;
      sampled.push({ state: race.state, demWin, distance: Math.abs(sampledMargin) });
    }
    demCounts.push(demGovernors);
    distribution[demGovernors] = (distribution[demGovernors] || 0) + 1;
    const closest = sampled.sort((a, b) => a.distance - b.distance)[0];
    if (closest) decisive[closest.state] += 1;
  }

  demCounts.sort((a, b) => a - b);
  for (const race of modeledRaces) {
    if (race.demProbability >= .5) demWinningRaceTotal += 1;
    else repWinningRaceTotal += 1;
    race.tippingPower = Number((decisive[race.state] / SETTINGS.simulations).toFixed(5));
  }
  for (const [count, simulations] of Object.entries(distribution)) {
    demCountTotal += Number(count) * simulations;
    repCountTotal += (50 - Number(count)) * simulations;
  }

  const medianDemGovernors = demCounts[Math.floor(demCounts.length / 2)];
  const forecast = {
    model: "2026 gubernatorial forecast",
    modelDate: localDateKey(),
    runDate: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    settings: SETTINGS,
    sourceSummary: {
      genericBallotMargin: senateSignals.genericBallotMargin,
      gubernatorialNationalShift: Number(nationalShift.toFixed(2)),
      approvalNet: senateSignals.approvalNet
    },
    projectedDemRaceWins: demWinningRaceTotal,
    projectedRepRaceWins: repWinningRaceTotal,
    averageDemGovernors: Number((demCountTotal / SETTINGS.simulations).toFixed(2)),
    averageRepGovernors: Number((repCountTotal / SETTINGS.simulations).toFixed(2)),
    medianDemGovernors,
    medianRepGovernors: 50 - medianDemGovernors,
    distribution,
    races: modeledRaces.sort((a, b) => STATE_NAMES[a.state].localeCompare(STATE_NAMES[b.state]))
  };
  forecast.governorCountHistory = appendHistory(forecast);
  return forecast;
}

const forecast = buildForecast();
writeFileSync(FORECAST_URL, JSON.stringify(forecast, null, 2));
console.log(`Wrote gubernatorial forecast for ${forecast.races.length} races`);
