/* ============================================================================
   PROJECT NEXUS — static game data.
   Buildings, tech tree, event pool, governments, parties, nation names.
   Pure data + pure functions only — nothing here is saved directly; save
   files reference these by id and re-attach definitions on load.
   ========================================================================== */
window.NexusData = (() => {
'use strict';

/* ------------------------------------------------------------------ */
/* Buildings                                                           */
/* ------------------------------------------------------------------ */
/* effects keys: popCap, jobs, power, water, education, healthcare,
   research, happiness, gdp, pollution, defense, crimeReduction */
const BUILDINGS = [
  { id: 'road', name: 'Road', cat: 'infra', icon: '🛣️', cost: 120, upkeep: 2, buildTicks: 1,
    desc: 'Connects tiles and boosts trade efficiency for nearby buildings.',
    effects: {} },
  { id: 'house', name: 'Housing Block', cat: 'residential', icon: '🏘️', cost: 900, upkeep: 10, buildTicks: 5,
    desc: 'Homes for your citizens. More housing, more population.',
    effects: { popCap: 80 } },
  { id: 'apartment', name: 'Apartment Tower', cat: 'residential', icon: '🏢', cost: 2600, upkeep: 24, buildTicks: 9,
    needsTech: 'highrise', desc: 'Dense high-rise housing for a growing city.',
    effects: { popCap: 260 } },
  { id: 'commercial', name: 'Commercial District', cat: 'commercial', icon: '🏬', cost: 1400, upkeep: 16, buildTicks: 6,
    desc: 'Shops and offices. Jobs, sales tax revenue, happiness.',
    effects: { jobs: 70, gdp: 340, happiness: 1 } },
  { id: 'industrial', name: 'Industrial Zone', cat: 'industrial', icon: '🏭', cost: 1800, upkeep: 20, buildTicks: 7,
    desc: 'Factories and manufacturing. Strong GDP, but pollutes.',
    effects: { jobs: 90, gdp: 520, pollution: 4, happiness: -1 } },
  { id: 'farm', name: 'Farm', cat: 'agriculture', icon: '🌾', cost: 500, upkeep: 6, buildTicks: 3,
    needsTerrain: ['plains', 'wetland'], desc: 'Grows food for your population. Best on fertile plains.',
    effects: { jobs: 30, gdp: 160, happiness: 1 } },
  { id: 'coal_plant', name: 'Coal Power Plant', cat: 'energy', icon: '🏗️', cost: 2200, upkeep: 30, buildTicks: 8,
    desc: 'Reliable but dirty power generation.',
    effects: { power: 400, pollution: 10, happiness: -2 } },
  { id: 'renewable_plant', name: 'Renewable Power Farm', cat: 'energy', icon: '🌬️', cost: 2800, upkeep: 18, buildTicks: 8,
    needsTech: 'renewable_energy', desc: 'Wind and solar power. Clean and efficient.',
    effects: { power: 340, pollution: 0, happiness: 2 } },
  { id: 'water', name: 'Water Treatment Plant', cat: 'infra', icon: '💧', cost: 1300, upkeep: 14, buildTicks: 5,
    desc: 'Clean water supply for your citizens.',
    effects: { water: 500 } },
  { id: 'school', name: 'School', cat: 'civic', icon: '🏫', cost: 900, upkeep: 12, buildTicks: 4,
    desc: 'Primary and secondary education, raising workforce skill over time.',
    effects: { education: 300, happiness: 1 } },
  { id: 'university', name: 'University', cat: 'research', icon: '🎓', cost: 2600, upkeep: 26, buildTicks: 9,
    needsTech: 'basic_computing', desc: 'Higher education and a steady stream of research points.',
    effects: { education: 200, research: 12, happiness: 1 } },
  { id: 'hospital', name: 'Hospital', cat: 'civic', icon: '🏥', cost: 2000, upkeep: 22, buildTicks: 7,
    desc: 'Healthcare capacity. Reduces the severity of disease outbreaks.',
    effects: { healthcare: 400, happiness: 2 } },
  { id: 'police', name: 'Police Station', cat: 'civic', icon: '🚓', cost: 1100, upkeep: 15, buildTicks: 4,
    desc: 'Keeps crime and corruption in check.',
    effects: { crimeReduction: 3, happiness: 1 } },
  { id: 'fire', name: 'Fire Station', cat: 'civic', icon: '🚒', cost: 1000, upkeep: 13, buildTicks: 4,
    desc: 'Reduces damage from disasters and accidents.',
    effects: { happiness: 1 } },
  { id: 'townhall', name: 'Town Hall', cat: 'government', icon: '🏛️', cost: 1600, upkeep: 10, buildTicks: 6,
    desc: 'Seat of local government. Required to pass laws.',
    effects: { happiness: 2 } },
  { id: 'park', name: 'Park', cat: 'civic', icon: '🌳', cost: 400, upkeep: 5, buildTicks: 2,
    desc: 'Green space that keeps citizens happy.',
    effects: { happiness: 3, pollution: -1 } },
  { id: 'research_lab', name: 'Research Lab', cat: 'research', icon: '🔬', cost: 1900, upkeep: 20, buildTicks: 6,
    desc: 'Dedicated research facility.',
    effects: { research: 10 } },
  { id: 'port', name: 'Seaport', cat: 'infra', icon: '⚓', cost: 2400, upkeep: 24, buildTicks: 8,
    needsTerrain: ['coast'], desc: 'Enables maritime trade. Must be built on the coast.',
    effects: { gdp: 300, jobs: 40 } },
  { id: 'airport', name: 'Airport', cat: 'infra', icon: '✈️', cost: 3600, upkeep: 34, buildTicks: 10,
    needsTech: 'internet', desc: 'Air trade and travel — a major GDP and diplomacy boost.',
    effects: { gdp: 460, jobs: 60, happiness: 1 } },
  { id: 'military_base', name: 'Military Base', cat: 'military', icon: '🪖', cost: 3000, upkeep: 40, buildTicks: 9,
    desc: 'Trains and houses your armed forces.',
    effects: { defense: 25, jobs: 30 } },
  { id: 'landmark', name: 'National Landmark', cat: 'civic', icon: '🗽', cost: 5000, upkeep: 20, buildTicks: 12,
    desc: 'A monument to your nation’s greatness. Tourists and pride.',
    effects: { happiness: 6, gdp: 250 } },
];
const BUILDINGS_BY_ID = Object.fromEntries(BUILDINGS.map(b => [b.id, b]));

/* ------------------------------------------------------------------ */
/* Technology tree                                                     */
/* ------------------------------------------------------------------ */
const TECHS = [
  // Energy
  { id: 'coal_power', name: 'Coal Power', cat: 'Energy', cost: 80, prereq: [], desc: 'Unlocks coal power plants.' },
  { id: 'renewable_energy', name: 'Renewable Energy', cat: 'Energy', cost: 220, prereq: ['coal_power'], desc: 'Unlocks clean wind & solar power farms.' },
  { id: 'smart_grid', name: 'Smart Grid', cat: 'Energy', cost: 380, prereq: ['renewable_energy'], desc: '+15% power output nationwide.', bonus: { powerMult: 1.15 } },
  { id: 'fusion_research', name: 'Fusion Research', cat: 'Energy', cost: 700, prereq: ['smart_grid'], desc: 'Cutting-edge energy research. Major happiness & GDP boost.', bonus: { gdpMult: 1.08 } },
  // Construction
  { id: 'steel_framing', name: 'Steel Framing', cat: 'Construction', cost: 100, prereq: [], desc: '-10% building costs.', bonus: { buildCostMult: 0.9 } },
  { id: 'highrise', name: 'High-Rise Housing', cat: 'Construction', cost: 260, prereq: ['steel_framing'], desc: 'Unlocks Apartment Towers.' },
  { id: 'modular_construction', name: 'Modular Construction', cat: 'Construction', cost: 420, prereq: ['highrise'], desc: '-20% construction time.', bonus: { buildTimeMult: 0.8 } },
  { id: 'mega_projects', name: 'Megaprojects', cat: 'Construction', cost: 650, prereq: ['modular_construction'], desc: 'Unlocks the National Landmark.' },
  // Agriculture
  { id: 'irrigation', name: 'Irrigation', cat: 'Agriculture', cost: 90, prereq: [], desc: '+20% farm output.', bonus: { farmMult: 1.2 } },
  { id: 'mechanized_farming', name: 'Mechanized Farming', cat: 'Agriculture', cost: 240, prereq: ['irrigation'], desc: '+30% farm output, fewer jobs needed.', bonus: { farmMult: 1.3 } },
  { id: 'gmo_crops', name: 'GMO Crops', cat: 'Agriculture', cost: 400, prereq: ['mechanized_farming'], desc: 'Reduces famine & drought event severity.' },
  { id: 'vertical_farms', name: 'Vertical Farms', cat: 'Agriculture', cost: 600, prereq: ['gmo_crops'], desc: 'Farms can now be built anywhere.' },
  // Medicine
  { id: 'vaccination', name: 'Vaccination Programs', cat: 'Medicine', cost: 100, prereq: [], desc: 'Reduces pandemic severity significantly.' },
  { id: 'modern_hospitals', name: 'Modern Hospitals', cat: 'Medicine', cost: 260, prereq: ['vaccination'], desc: '+25% hospital capacity.', bonus: { healthcareMult: 1.25 } },
  { id: 'advanced_medicine', name: 'Advanced Medicine', cat: 'Medicine', cost: 440, prereq: ['modern_hospitals'], desc: '+happiness nationwide.', bonus: { happinessFlat: 3 } },
  { id: 'gene_therapy', name: 'Gene Therapy', cat: 'Medicine', cost: 680, prereq: ['advanced_medicine'], desc: 'Population growth rate increases.', bonus: { growthMult: 1.15 } },
  // Manufacturing
  { id: 'assembly_lines', name: 'Assembly Lines', cat: 'Manufacturing', cost: 110, prereq: [], desc: '+15% industrial output.', bonus: { industrialMult: 1.15 } },
  { id: 'automation', name: 'Automation', cat: 'Manufacturing', cost: 280, prereq: ['assembly_lines'], desc: '+25% industrial output, -10% jobs.', bonus: { industrialMult: 1.25 } },
  { id: 'robotics', name: 'Robotics', cat: 'Manufacturing', cost: 460, prereq: ['automation'], desc: '+15% GDP from industry.', bonus: { industrialMult: 1.15 } },
  { id: 'ai_manufacturing', name: 'AI Manufacturing', cat: 'Manufacturing', cost: 720, prereq: ['robotics'], desc: 'State-of-the-art automated industry.', bonus: { industrialMult: 1.2 } },
  // Computing
  { id: 'basic_computing', name: 'Basic Computing', cat: 'Computing', cost: 130, prereq: [], desc: 'Unlocks universities.' },
  { id: 'internet', name: 'Internet Infrastructure', cat: 'Computing', cost: 300, prereq: ['basic_computing'], desc: 'Unlocks airports. +research nationwide.', bonus: { researchFlat: 5 } },
  { id: 'big_data', name: 'Big Data', cat: 'Computing', cost: 480, prereq: ['internet'], desc: '+corruption detection, -corruption growth.' },
  { id: 'artificial_intelligence', name: 'Artificial Intelligence', cat: 'Computing', cost: 780, prereq: ['big_data'], desc: 'The pinnacle of research. Major research + GDP boost.', bonus: { researchFlat: 10, gdpMult: 1.06 } },
];
const TECHS_BY_ID = Object.fromEntries(TECHS.map(t => [t.id, t]));
const TECH_CATEGORIES = ['Energy', 'Construction', 'Agriculture', 'Medicine', 'Manufacturing', 'Computing'];

/* ------------------------------------------------------------------ */
/* Governments                                                         */
/* ------------------------------------------------------------------ */
const GOVERNMENTS = [
  { id: 'democracy', name: 'Democracy', desc: 'Regular elections. Approval directly decides who governs.',
    elections: true, corruptionGrowth: 1.0, researchMult: 1.0, happinessBaseline: 0, taxTolerance: 1.0 },
  { id: 'republic', name: 'Republic', desc: 'Elected representatives govern on the people’s behalf.',
    elections: true, corruptionGrowth: 1.1, researchMult: 1.0, happinessBaseline: 0, taxTolerance: 1.05 },
  { id: 'monarchy', name: 'Constitutional Monarchy', desc: 'A ceremonial crown, an elected parliament.',
    elections: true, corruptionGrowth: 0.9, researchMult: 1.0, happinessBaseline: 2, taxTolerance: 1.0 },
  { id: 'technocracy', name: 'Technocracy', desc: 'Experts and scientists govern. Research thrives.',
    elections: false, corruptionGrowth: 0.8, researchMult: 1.3, happinessBaseline: -1, taxTolerance: 1.1 },
  { id: 'socialist', name: 'Socialist State', desc: 'Central planning and strong social programs.',
    elections: false, corruptionGrowth: 1.2, researchMult: 0.95, happinessBaseline: 3, taxTolerance: 1.3 },
  { id: 'authoritarian', name: 'Authoritarian State', desc: 'One leader, absolute control. No elections.',
    elections: false, corruptionGrowth: 1.4, researchMult: 0.9, happinessBaseline: -3, taxTolerance: 1.4 },
];
const GOVERNMENTS_BY_ID = Object.fromEntries(GOVERNMENTS.map(g => [g.id, g]));

/* ------------------------------------------------------------------ */
/* Political parties (used when the current government holds elections) */
/* ------------------------------------------------------------------ */
/* econ: -1 (fully left/interventionist) .. +1 (fully right/free-market) —
   drives how a party's legislators vote on bills against each bill's own
   ideology score. */
const PARTIES = [
  { id: 'progressive', name: 'Progressive Alliance', ideology: 'left-green', econ: -0.7, color: '#22c55e' },
  { id: 'liberty', name: 'Liberty Union', ideology: 'right-market', econ: 0.8, color: '#38bdf8' },
  { id: 'labor', name: 'Labor Front', ideology: 'left-labor', econ: -0.6, color: '#ef4444' },
  { id: 'unity', name: 'National Unity', ideology: 'center-nationalist', econ: 0.3, color: '#f2b03d' },
  { id: 'green', name: 'Green Future', ideology: 'environment', econ: -0.5, color: '#4ade80' },
];

/* ------------------------------------------------------------------ */
/* Bills — the legislative catalog. Once enacted, effects apply every    */
/* tick until repealed or struck down by the courts. `ideology` is on    */
/* the same -1..1 axis as a party's `econ` value, used for vote alignment.*/
/* ------------------------------------------------------------------ */
const BILLS = [
  // Economy
  { id: 'income_tax_relief', name: 'Income Tax Relief Act', cat: 'Economy', ideology: 0.6,
    desc: 'Eases the political cost of high tax rates.', effects: { taxHappinessRelief: 6 } },
  { id: 'minimum_wage_law', name: 'Minimum Wage Law', cat: 'Economy', ideology: -0.6,
    desc: '+happiness; a small drag on GDP.', effects: { happinessFlat: 3, gdpMult: 0.98 } },
  { id: 'banking_regulation', name: 'Banking Regulation Act', cat: 'Economy', ideology: -0.4,
    desc: 'Reduces inflation growth; a small GDP drag.', effects: { inflationDamp: 0.3, gdpMult: 0.99 } },
  { id: 'trade_liberalization', name: 'Trade Liberalization Act', cat: 'Economy', ideology: 0.5,
    desc: '+GDP and +happiness from open markets.', effects: { gdpMult: 1.04, happinessFlat: 1 } },
  // Infrastructure
  { id: 'national_highways_act', name: 'National Highways Act', cat: 'Infrastructure', ideology: 0.1,
    desc: '+GDP from better-connected infrastructure.', effects: { gdpMult: 1.03 } },
  { id: 'broadband_initiative', name: 'Broadband Initiative', cat: 'Infrastructure', ideology: -0.2,
    desc: '+happiness and +research nationwide.', effects: { happinessFlat: 1, researchFlat: 4 } },
  // Healthcare
  { id: 'universal_healthcare', name: 'Universal Healthcare Act', cat: 'Healthcare', ideology: -0.7,
    desc: '+healthcare capacity and +happiness; higher upkeep.', effects: { healthcareMult: 1.3, happinessFlat: 3, upkeepMult: 1.05 } },
  { id: 'private_healthcare_incentives', name: 'Private Healthcare Incentives', cat: 'Healthcare', ideology: 0.6,
    desc: 'Saves public money; slightly lower healthcare capacity.', effects: { treasuryPerTick: 40, healthcareMult: 0.92 } },
  // Education
  { id: 'school_funding_boost', name: 'School Funding Boost', cat: 'Education', ideology: -0.3,
    desc: '+education capacity nationwide.', effects: { educationMult: 1.2 } },
  { id: 'student_loan_reform', name: 'Student Loan Reform', cat: 'Education', ideology: -0.4,
    desc: '+happiness among young voters.', effects: { happinessFlat: 2 } },
  // Housing
  { id: 'affordable_housing_act', name: 'Affordable Housing Act', cat: 'Housing', ideology: -0.5,
    desc: '+housing capacity nationwide.', effects: { popCapMult: 1.15 } },
  { id: 'zoning_deregulation', name: 'Zoning Deregulation Act', cat: 'Housing', ideology: 0.4,
    desc: '-20% construction time nationwide.', effects: { buildTimeMult: 0.8 } },
  // Environment
  { id: 'environmental_regulations', name: 'Environmental Regulations Act', cat: 'Environment', ideology: -0.8,
    desc: '-pollution; a small drag on industrial output.', effects: { pollutionMult: 0.6, gdpMult: 0.98 } },
  { id: 'carbon_pricing', name: 'Carbon Pricing Act', cat: 'Environment', ideology: -0.6,
    desc: '-pollution and +treasury from carbon revenue; a GDP drag.', effects: { pollutionMult: 0.75, treasuryPerTick: 30, gdpMult: 0.99 } },
  { id: 'conservation_act', name: 'National Conservation Act', cat: 'Environment', ideology: -0.5,
    desc: '+happiness; a small GDP cost.', effects: { happinessFlat: 2, gdpMult: 0.99 } },
  // Justice
  { id: 'criminal_code_reform', name: 'Criminal Code Reform', cat: 'Justice', ideology: -0.2,
    desc: '+crime reduction nationwide.', effects: { crimeReductionFlat: 3 } },
  { id: 'police_funding_increase', name: 'Police Funding Increase', cat: 'Justice', ideology: 0.5,
    desc: '+crime reduction; higher upkeep.', effects: { crimeReductionFlat: 4, upkeepMult: 1.03 } },
  { id: 'civil_rights_act', name: 'Civil Rights Act', cat: 'Justice', ideology: -0.6,
    desc: '+happiness nationwide.', effects: { happinessFlat: 3 } },
  // Defence
  { id: 'military_recruitment_drive', name: 'Military Recruitment Drive', cat: 'Defence', ideology: 0.6,
    desc: '+defense rating; higher upkeep.', effects: { defenseFlat: 15, upkeepMult: 1.02 } },
  { id: 'national_security_act', name: 'National Security Act', cat: 'Defence', ideology: 0.7,
    desc: '+defense rating; a small happiness cost.', effects: { defenseFlat: 20, happinessFlat: -2 } },
  // Immigration
  { id: 'open_immigration_policy', name: 'Open Immigration Policy', cat: 'Immigration', ideology: -0.5,
    desc: 'Faster population growth.', effects: { growthMult: 1.15 } },
  { id: 'border_security_act', name: 'Border Security Act', cat: 'Immigration', ideology: 0.7,
    desc: '+happiness among security-minded voters; slower growth.', effects: { happinessFlat: 2, growthMult: 0.92 } },
  // Government
  { id: 'anti_corruption_act', name: 'Anti-Corruption Act', cat: 'Government', ideology: -0.1,
    desc: '-corruption growth nationwide.', effects: { corruptionGrowthMult: 0.6 } },
  { id: 'transparency_act', name: 'Transparency in Government Act', cat: 'Government', ideology: -0.3,
    desc: '-corruption growth; +happiness.', effects: { corruptionGrowthMult: 0.75, happinessFlat: 1 } },
  { id: 'campaign_finance_reform', name: 'Campaign Finance Reform', cat: 'Government', ideology: -0.4,
    desc: '-corruption growth nationwide.', effects: { corruptionGrowthMult: 0.7 } },
];
const BILLS_BY_ID = Object.fromEntries(BILLS.map(b => [b.id, b]));
const BILL_CATEGORIES = ['Economy', 'Infrastructure', 'Healthcare', 'Education', 'Housing', 'Environment', 'Justice', 'Defence', 'Immigration', 'Government'];

/* ------------------------------------------------------------------ */
/* Cabinet portfolios — each maps to a concrete effectiveness bonus     */
/* driven by the appointed minister's competence stat.                  */
/* ------------------------------------------------------------------ */
const PORTFOLIOS = [
  { id: 'treasurer', name: 'Treasurer', icon: '💰', desc: 'Competence reduces debt interest and stabilizes inflation.' },
  { id: 'foreign_affairs', name: 'Foreign Affairs', icon: '🌍', desc: 'Competence speeds up diplomatic relationship gains.' },
  { id: 'education', name: 'Education Minister', icon: '🎓', desc: 'Competence boosts education capacity.' },
  { id: 'health', name: 'Health Minister', icon: '⚕️', desc: 'Competence boosts healthcare capacity.' },
  { id: 'defence', name: 'Defence Minister', icon: '🪖', desc: 'Competence boosts defense rating.' },
  { id: 'transport', name: 'Transport Minister', icon: '🚄', desc: 'Competence boosts GDP from infrastructure.' },
  { id: 'justice', name: 'Justice Minister', icon: '⚖️', desc: 'Competence reduces corruption growth.' },
  { id: 'industry', name: 'Industry Minister', icon: '🏭', desc: 'Competence boosts industrial GDP.' },
  { id: 'science', name: 'Science Minister', icon: '🔬', desc: 'Competence boosts research generation.' },
  { id: 'environment', name: 'Environment Minister', icon: '🌳', desc: 'Competence reduces pollution.' },
  { id: 'agriculture', name: 'Agriculture Minister', icon: '🌾', desc: 'Competence boosts farm output.' },
  { id: 'energy', name: 'Energy Minister', icon: '⚡', desc: 'Competence boosts power output.' },
  { id: 'housing', name: 'Housing Minister', icon: '🏘️', desc: 'Competence boosts housing capacity.' },
];
const PORTFOLIOS_BY_ID = Object.fromEntries(PORTFOLIOS.map(p => [p.id, p]));

const LEGISLATOR_FIRST = ['Aiden', 'Mara', 'Tobias', 'Elena', 'Rurik', 'Sana', 'Cassius', 'Ingrid', 'Milo', 'Petra',
  'Dorian', 'Freya', 'Callum', 'Nadia', 'Silas', 'Rosalind', 'Bram', 'Talia', 'Edric', 'Wren',
  'Osric', 'Livia', 'Ansel', 'Corinne', 'Jarek', 'Thea', 'Baxter', 'Yolanda', 'Fenwick', 'Marisol'];
const LEGISLATOR_LAST = ['Hollis', 'Vantor', 'Dresden', 'Marlowe', 'Okonkwo', 'Voss', 'Calloway', 'Reyes', 'Sinclair', 'Bracken',
  'Thorne', 'Adair', 'Kwon', 'Whitlock', 'Marchetti', 'Solberg', 'Ashcombe', 'Devereux', 'Nakamura', 'Ferro'];
const CONSTITUENCIES = ['North District', 'Riverside', 'Old Town', 'Harborview', 'Uplands', 'Southgate', 'Millbrook',
  'Eastfield', 'Westmoor', 'Central', 'Lakeside', 'Greenway', 'Highcross', 'Fernvale', 'Ironside'];

/* ------------------------------------------------------------------ */
/* Random event pool                                                    */
/* Each: id, title, desc, base weight, an optional condition(state)=>mult,
   and 2-3 choices with label + apply(state) mutating deltas + flavor.   */
/* ------------------------------------------------------------------ */
const EVENTS = [
  { id: 'earthquake', title: 'Earthquake!', icon: '🌋', weight: 3,
    desc: 'A moderate earthquake has struck your nation, damaging infrastructure.',
    choices: [
      { label: 'Emergency repairs (costly)', apply: s => ({ treasury: -Math.round(s.stats.gdp * 0.05), happiness: 1 }) },
      { label: 'Let communities rebuild themselves', apply: s => ({ happiness: -4 }) },
    ] },
  { id: 'flood', title: 'Flooding', icon: '🌊', weight: 3,
    desc: 'Heavy rains have caused flooding in low-lying districts.',
    choices: [
      { label: 'Fund flood defenses', apply: s => ({ treasury: -1200, happiness: 2 }) },
      { label: 'Do nothing', apply: s => ({ happiness: -3, gdp: -200 }) },
    ] },
  { id: 'drought', title: 'Drought', icon: '☀️', weight: 3,
    desc: 'A prolonged dry spell is hurting farm output.',
    choices: [
      { label: 'Subsidize water for farms', apply: s => ({ treasury: -800, happiness: 1 }) },
      { label: 'Let the market adjust', apply: s => ({ happiness: -2, gdp: -150 }) },
    ] },
  { id: 'pandemic', title: 'Disease Outbreak', icon: '🦠', weight: 2,
    desc: 'A contagious illness is spreading through your population.',
    condition: s => s.stats.healthcareRatio < 0.8 ? 1.6 : 0.6,
    choices: [
      { label: 'Lockdown & fund healthcare', apply: s => ({ treasury: -1500, gdp: -400, happiness: -2 }) },
      { label: 'Let it run its course', apply: s => ({ happiness: -6, population: -Math.round(s.stats.population * 0.01) }) },
    ] },
  { id: 'breakthrough', title: 'Scientific Breakthrough', icon: '💡', weight: 2,
    desc: 'Your researchers have made an unexpected discovery!',
    choices: [
      { label: 'Publish openly (reputation)', apply: s => ({ research: 60, happiness: 2 }) },
      { label: 'Patent it (revenue)', apply: s => ({ research: 20, treasury: 2000 }) },
    ] },
  { id: 'corruption_scandal', title: 'Corruption Scandal', icon: '💰', weight: 2,
    condition: s => s.stats.corruption > 40 ? 1.8 : 0.5,
    desc: 'Investigators have uncovered corruption in a government department.',
    choices: [
      { label: 'Full investigation', apply: s => ({ corruption: -15, happiness: -1, treasury: -600 }) },
      { label: 'Quiet cover-up', apply: s => ({ corruption: 8, happiness: -5 }) },
    ] },
  { id: 'housing_crisis', title: 'Housing Crisis', icon: '🏚️', weight: 2,
    condition: s => s.stats.housingRatio < 0.9 ? 1.8 : 0.4,
    desc: 'Demand for housing far outstrips supply. Rent is soaring.',
    choices: [
      { label: 'Emergency housing subsidies', apply: s => ({ treasury: -1000, happiness: 2 }) },
      { label: 'Let the market sort it out', apply: s => ({ happiness: -4 }) },
    ] },
  { id: 'power_shortage', title: 'Power Shortage', icon: '🔌', weight: 2,
    condition: s => s.stats.powerRatio < 0.9 ? 1.8 : 0.3,
    desc: 'Demand for electricity has outpaced your power grid.',
    choices: [
      { label: 'Ration power to industry', apply: s => ({ gdp: -300, happiness: -1 }) },
      { label: 'Emergency imports (costly)', apply: s => ({ treasury: -900, happiness: 1 }) },
    ] },
  { id: 'recession', title: 'Recession Warning', icon: '📉', weight: 2,
    desc: 'Economists warn of a coming economic downturn.',
    choices: [
      { label: 'Stimulus spending', apply: s => ({ treasury: -1500, gdp: 200 }) },
      { label: 'Tighten the budget', apply: s => ({ treasury: 500, happiness: -2 }) },
    ] },
  { id: 'immigration_wave', title: 'Immigration Wave', icon: '🧳', weight: 2,
    desc: 'A wave of migrants is seeking to settle in your nation.',
    choices: [
      { label: 'Welcome them', apply: s => ({ population: 400, happiness: -1 }) },
      { label: 'Restrict entry', apply: s => ({ happiness: 1 }) },
    ] },
  { id: 'resource_discovery', title: 'Resource Discovery', icon: '⛏️', weight: 2,
    desc: 'Surveyors have discovered a valuable resource deposit.',
    choices: [
      { label: 'State-run extraction', apply: s => ({ treasury: 2200 }) },
      { label: 'Auction the rights', apply: s => ({ treasury: 3400, happiness: -1 }) },
    ] },
  { id: 'cyberattack', title: 'Cyber Attack', icon: '🖥️', weight: 2,
    condition: s => s.tech.unlocked.includes('internet') ? 1.4 : 0.2,
    desc: 'Hackers have targeted your national infrastructure.',
    choices: [
      { label: 'Emergency cybersecurity spend', apply: s => ({ treasury: -1100 }) },
      { label: 'Absorb the damage', apply: s => ({ gdp: -350, happiness: -2 }) },
    ] },
  { id: 'financial_crash', title: 'Financial Crash', icon: '💥', weight: 1,
    condition: s => s.stats.inflation > 8 ? 1.8 : 0.5,
    desc: 'Markets are in turmoil. Your currency is under pressure.',
    choices: [
      { label: 'Bail out the banks', apply: s => ({ treasury: -2500, debt: 2500 }) },
      { label: 'Let markets correct', apply: s => ({ gdp: -600, happiness: -4 }) },
    ] },
  { id: 'heatwave', title: 'Heatwave', icon: '🥵', weight: 2,
    desc: 'Extreme heat is straining the power grid and public health.',
    choices: [
      { label: 'Open cooling centers', apply: s => ({ treasury: -500, happiness: 1 }) },
      { label: 'Advise citizens to cope', apply: s => ({ happiness: -2 }) },
    ] },
  { id: 'cold_snap', title: 'Cold Snap', icon: '🥶', weight: 2,
    desc: 'A sudden cold snap has increased energy demand sharply.',
    choices: [
      { label: 'Subsidize heating', apply: s => ({ treasury: -600, happiness: 1 }) },
      { label: 'No action', apply: s => ({ happiness: -2 }) },
    ] },
  { id: 'labor_strike', title: 'Labor Strike', icon: '✊', weight: 2,
    condition: s => s.stats.happiness < 45 ? 1.6 : 0.5,
    desc: 'Workers are striking over pay and conditions.',
    choices: [
      { label: 'Negotiate higher wages', apply: s => ({ treasury: -1000, happiness: 3 }) },
      { label: 'Stand firm', apply: s => ({ gdp: -300, happiness: -3 }) },
    ] },
  { id: 'foreign_investment', title: 'Foreign Investment Offer', icon: '🌍', weight: 2,
    desc: 'A foreign conglomerate wants to invest in your industry.',
    choices: [
      { label: 'Accept the investment', apply: s => ({ treasury: 1800, gdp: 250 }) },
      { label: 'Decline (protect local industry)', apply: s => ({ happiness: 1 }) },
    ] },
  { id: 'trade_dispute', title: 'Trade Dispute', icon: '⚖️', weight: 2,
    desc: 'A trading partner has raised tariffs on your exports.',
    choices: [
      { label: 'Retaliate with tariffs', apply: s => ({ gdp: -200 }) },
      { label: 'Negotiate a resolution', apply: s => ({ treasury: -400 }) },
    ] },
  { id: 'diplomatic_gift', title: 'Diplomatic Gift', icon: '🎁', weight: 2,
    desc: 'A foreign nation has sent a goodwill gift.',
    choices: [
      { label: 'Accept graciously', apply: s => ({ happiness: 1 }) },
      { label: 'Politely decline', apply: s => ({ happiness: 0 }) },
    ] },
  { id: 'festival', title: 'National Festival', icon: '🎉', weight: 2,
    desc: 'Citizens are celebrating a national festival.',
    choices: [
      { label: 'Fund a grand celebration', apply: s => ({ treasury: -400, happiness: 4 }) },
      { label: 'Keep it modest', apply: s => ({ happiness: 1 }) },
    ] },
  { id: 'tech_conference', title: 'International Tech Conference', icon: '🎤', weight: 2,
    desc: 'Your nation has been invited to host a tech conference.',
    choices: [
      { label: 'Host it (costly but boosts research)', apply: s => ({ treasury: -900, research: 40 }) },
      { label: 'Decline the invitation', apply: s => ({}) },
    ] },
  { id: 'oil_discovery', title: 'Oil Discovery', icon: '🛢️', weight: 1,
    desc: 'Oil has been discovered within your territory.',
    choices: [
      { label: 'Develop it (GDP, pollution)', apply: s => ({ treasury: 2600, gdp: 300, happiness: -1 }) },
      { label: 'Leave it untouched', apply: s => ({ happiness: 2 }) },
    ] },
  { id: 'refugee_crisis', title: 'Refugee Crisis', icon: '⛺', weight: 1,
    desc: 'A neighboring crisis has produced a wave of refugees at your border.',
    choices: [
      { label: 'Open the border', apply: s => ({ population: 300, treasury: -700, happiness: 2 }) },
      { label: 'Close the border', apply: s => ({ happiness: -2 }) },
    ] },
  { id: 'coalition_collapse', title: 'Coalition Collapse', icon: '🏛️', weight: 1,
    condition: s => (GOVERNMENTS_BY_ID[s.meta.government] || {}).elections ? 1 : 0,
    desc: 'Your governing coalition is fracturing.',
    choices: [
      { label: 'Call an early election', apply: s => ({ forceElection: true }) },
      { label: 'Reshuffle the cabinet', apply: s => ({ happiness: -1, corruption: 3 }) },
    ] },
  { id: 'public_protest', title: 'Public Protest', icon: '📢', weight: 2,
    condition: s => s.stats.happiness < 40 ? 1.7 : 0.4,
    desc: 'Citizens are protesting in the streets over living conditions.',
    choices: [
      { label: 'Address their concerns', apply: s => ({ treasury: -800, happiness: 3 }) },
      { label: 'Ignore the protests', apply: s => ({ happiness: -3, corruption: 2 }) },
    ] },
  { id: 'charity_telethon', title: 'Charity Telethon', icon: '📺', weight: 1,
    desc: 'Citizens have organized a nationwide charity telethon.',
    choices: [
      { label: 'Match donations from the treasury', apply: s => ({ treasury: -500, happiness: 2 }) },
      { label: 'Let citizens give on their own', apply: s => ({ happiness: 1 }) },
    ] },
  { id: 'infrastructure_grant', title: 'International Infrastructure Grant', icon: '🌉', weight: 1,
    desc: 'An international body is offering a grant for infrastructure.',
    choices: [
      { label: 'Accept the grant', apply: s => ({ treasury: 1600 }) },
      { label: 'Decline (avoid strings attached)', apply: s => ({ happiness: 1 }) },
    ] },
  { id: 'global_summit', title: 'Global Summit Invitation', icon: '🕊️', weight: 1,
    desc: 'Your nation has been invited to a global diplomatic summit.',
    choices: [
      { label: 'Attend and engage', apply: s => ({ happiness: 1, relationsAll: 4 }) },
      { label: 'Send a low-level delegation', apply: s => ({ relationsAll: 1 }) },
    ] },
  { id: 'wildlife_reserve', title: 'Conservation Proposal', icon: '🦉', weight: 1,
    desc: 'Environmentalists are calling for a new nature reserve.',
    choices: [
      { label: 'Establish the reserve', apply: s => ({ happiness: 3, gdp: -150 }) },
      { label: 'Prioritize development', apply: s => ({ gdp: 150, happiness: -2 }) },
    ] },
];

/* ------------------------------------------------------------------ */
/* Terrain / biome palette (used by worldgen + renderer)                */
/* ------------------------------------------------------------------ */
const TERRAIN = {
  ocean: { color: '#1a4a7a', movable: false },
  coast: { color: '#2f7ba6', movable: true },
  plains: { color: '#5c9c4a', movable: true },
  forest: { color: '#356b34', movable: true },
  hills: { color: '#8a7b4e', movable: true },
  mountains: { color: '#6b6b73', movable: false },
  desert: { color: '#d2b163', movable: true },
  tundra: { color: '#c7d3d6', movable: true },
  wetland: { color: '#3e7d5e', movable: true },
};

/* ------------------------------------------------------------------ */
/* Achievements — concrete, checkable short-term goals across every     */
/* system, so an open-ended sandbox still has things to strive for.     */
/* check(state) is a pure predicate; ids are permanent, never renamed.  */
/* ------------------------------------------------------------------ */
const ACHIEVEMENTS = [
  { id: 'first_steps', name: 'First Steps', icon: '🌱', desc: 'Reach a population of 500.', check: s => s.stats.population >= 500 },
  { id: 'boomtown', name: 'Boomtown', icon: '🏙️', desc: 'Reach a population of 5,000.', check: s => s.stats.population >= 5000 },
  { id: 'metropolis', name: 'Metropolis', icon: '🌆', desc: 'Reach a population of 20,000.', check: s => s.stats.population >= 20000 },
  { id: 'economic_powerhouse', name: 'Economic Powerhouse', icon: '💰', desc: 'Reach a GDP of 50,000.', check: s => s.stats.gdp >= 50000 },
  { id: 'debt_free', name: 'Debt Free', icon: '📈', desc: 'Carry zero debt with treasury to spare.', check: s => s.debt === 0 && s.treasury > 5000 && s.meta.tick > 20 },
  { id: 'tech_pioneer', name: 'Tech Pioneer', icon: '🔬', desc: 'Unlock every technology.', check: (s, D) => s.tech.unlocked.length >= D.TECHS.length },
  { id: 'lawmaker', name: 'Lawmaker', icon: '📜', desc: 'Get 5 bills through Parliament.', check: s => s.legislature.lawCode.filter(b => b.status !== 'in_committee' && b.status !== 'failed').length >= 5 },
  { id: 'legislative_machine', name: 'Legislative Machine', icon: '🏛️', desc: 'Get 15 bills through Parliament.', check: s => s.legislature.lawCode.filter(b => b.status !== 'in_committee' && b.status !== 'failed').length >= 15 },
  { id: 'full_cabinet', name: 'Full Cabinet', icon: '🧑‍💼', desc: 'Fill every cabinet portfolio.', check: (s, D) => Object.keys(s.legislature.cabinet).length >= D.PORTFOLIOS.length },
  { id: 'executive_power', name: 'Executive Power', icon: '⚡', desc: 'Issue 3 executive orders.', check: s => s.legislature.lawCode.filter(b => b.origin === 'executive').length >= 3 },
  { id: 'judicial_override', name: 'Judicial Override', icon: '⚖️', desc: 'Have a law struck down by the courts.', check: s => s.legislature.lawCode.some(b => b.status === 'struck_down') },
  { id: 'world_diplomat', name: 'World Diplomat', icon: '🤝', desc: 'Form an alliance with every nation.', check: s => s.nations.length > 0 && s.nations.every(n => n.alliance) },
  { id: 'happy_nation', name: 'Happy Nation', icon: '😊', desc: 'Reach 90 happiness.', check: s => s.stats.happiness >= 90 },
  { id: 'fortress_nation', name: 'Fortress Nation', icon: '🛡️', desc: 'Reach a defense rating of 100.', check: s => s.stats.defense >= 100 },
  { id: 'long_reign', name: 'Long Reign', icon: '👑', desc: 'Survive 10 years in power.', check: s => s.meta.tick >= 520 },
];

const NATION_NAMES = [
  'Valtoria', 'Kessland', 'Norvengard', 'Astrelia', 'Duvenrike', 'Merisova',
  'Kaldrun', 'Solantis', 'Brennmark', 'Isaveth', 'Thornwick', 'Elmspire',
  'Draskovia', 'Windermoor', 'Calathria',
];
const NATION_COLORS = ['#ef4444', '#38bdf8', '#a855f7', '#f2b03d', '#4ade80', '#f973d1', '#94a3b8'];

return {
  BUILDINGS, BUILDINGS_BY_ID, TECHS, TECHS_BY_ID, TECH_CATEGORIES,
  GOVERNMENTS, GOVERNMENTS_BY_ID, PARTIES, EVENTS, TERRAIN,
  NATION_NAMES, NATION_COLORS,
  BILLS, BILLS_BY_ID, BILL_CATEGORIES, PORTFOLIOS, PORTFOLIOS_BY_ID,
  LEGISLATOR_FIRST, LEGISLATOR_LAST, CONSTITUENCIES, ACHIEVEMENTS,
};
})();
